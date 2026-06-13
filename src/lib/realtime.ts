import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { env } from "../config/env";
import { prisma } from "./prisma";
import type { AuthPayload } from "../middleware/auth";

let io: Server | null = null;

function isLocalOrigin(origin?: string) {
  return !origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

function allowedFrontendOrigins() {
  return env.frontendUrl
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function isAllowedOrigin(origin?: string) {
  return isLocalOrigin(origin) || allowedFrontendOrigins().includes(origin?.replace(/\/$/, "") ?? "");
}

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (typeof token !== "string") {
      next(new Error("Unauthorized"));
      return;
    }

    try {
      const auth = jwt.verify(token, env.jwtSecret) as AuthPayload;
      socket.data.userId = auth.userId;
      socket.data.email = auth.email;
      next();
    } catch {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Socket authentication failed");
      }
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;

    void socket.join(userRoom(userId));
    if (process.env.NODE_ENV !== "production") {
      console.log(`Socket connected for user ${userId}`);
    }

    socket.on("conversation:join", async (conversationId: string, ack?: (response: { success: boolean; message?: string }) => void) => {
      try {
        if (!conversationId) {
          ack?.({ success: false, message: "Conversation is required" });
          return;
        }

        const participant = await prisma.conversationParticipant.findUnique({
          where: {
            conversationId_userId: {
              conversationId,
              userId,
            },
          },
          select: { id: true },
        });

        if (!participant) {
          ack?.({ success: false, message: "Forbidden" });
          return;
        }

        await socket.join(conversationRoom(conversationId));
        ack?.({ success: true });
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Socket conversation join failed", error);
        }
        ack?.({ success: false, message: "Unable to join conversation" });
      }
    });
  });

  return io;
}

function userRoom(userId: string) {
  return `user:${userId}`;
}

function conversationRoom(conversationId: string) {
  return `conversation:${conversationId}`;
}

export function emitMessageNew(conversationId: string, message: unknown, recipientIds: string[]) {
  if (!io) return;
  const rooms = [conversationRoom(conversationId), ...recipientIds.map(userRoom)];
  io.to(rooms).emit("message:new", { conversationId, message });
}

type ConversationUpdatedPayload = {
  lastMessage?: unknown;
  lastMessageAt?: Date | string;
};

export function emitConversationUpdated(conversationId: string, payload: ConversationUpdatedPayload, participantIds: string[]) {
  if (!io) return;
  participantIds.forEach((participantId) => {
    io?.to(userRoom(participantId)).emit("conversation:updated", { conversationId, ...payload });
  });
}

export function emitUnreadMessageCount(userId: string, count: number) {
  if (!io) return;
  io.to(userRoom(userId)).emit("messages:unread-count", { count });
}

export function emitNotificationNew(recipientId: string, notification: unknown) {
  if (!io) return;
  io.to(userRoom(recipientId)).emit("notification:new", { notification });
}
