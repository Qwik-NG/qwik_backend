"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRealtime = initRealtime;
exports.emitMessageNew = emitMessageNew;
exports.emitConversationUpdated = emitConversationUpdated;
exports.emitUnreadMessageCount = emitUnreadMessageCount;
exports.emitNotificationNew = emitNotificationNew;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const socket_io_1 = require("socket.io");
const env_1 = require("../config/env");
const prisma_1 = require("./prisma");
let io = null;
function isLocalOrigin(origin) {
    return !origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}
function allowedFrontendOrigins() {
    return env_1.env.socketOrigins
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);
}
function isAllowedOrigin(origin) {
    return isLocalOrigin(origin) || allowedFrontendOrigins().includes(origin?.replace(/\/$/, "") ?? "");
}
function initRealtime(server) {
    io = new socket_io_1.Server(server, {
        cors: {
            origin: (origin, callback) => {
                if (isAllowedOrigin(origin)) {
                    callback(null, true);
                    return;
                }
                callback(new Error("Not allowed by CORS"));
            },
            methods: ["GET", "POST"],
            credentials: false,
        },
    });
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (typeof token !== "string") {
            next(new Error("Unauthorized"));
            return;
        }
        try {
            const auth = jsonwebtoken_1.default.verify(token, env_1.env.jwtSecret);
            socket.data.userId = auth.userId;
            socket.data.email = auth.email;
            next();
        }
        catch {
            if (process.env.NODE_ENV !== "production") {
                console.warn("Socket authentication failed");
            }
            next(new Error("Unauthorized"));
        }
    });
    io.on("connection", (socket) => {
        const userId = socket.data.userId;
        if (!userId)
            return;
        void socket.join(userRoom(userId));
        if (process.env.NODE_ENV !== "production") {
            console.log(`Socket connected for user ${userId}`);
        }
        socket.on("conversation:join", async (conversationId, ack) => {
            try {
                if (!conversationId) {
                    ack?.({ success: false, message: "Conversation is required" });
                    return;
                }
                const participant = await prisma_1.prisma.conversationParticipant.findUnique({
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
            }
            catch (error) {
                if (process.env.NODE_ENV !== "production") {
                    console.warn("Socket conversation join failed", error);
                }
                ack?.({ success: false, message: "Unable to join conversation" });
            }
        });
    });
    return io;
}
function userRoom(userId) {
    return `user:${userId}`;
}
function conversationRoom(conversationId) {
    return `conversation:${conversationId}`;
}
function emitMessageNew(conversationId, message, recipientIds) {
    if (!io)
        return;
    const rooms = [conversationRoom(conversationId), ...recipientIds.map(userRoom)];
    io.to(rooms).emit("message:new", { conversationId, message });
}
function emitConversationUpdated(conversationId, payload, participantIds) {
    if (!io)
        return;
    participantIds.forEach((participantId) => {
        io?.to(userRoom(participantId)).emit("conversation:updated", { conversationId, ...payload });
    });
}
function emitUnreadMessageCount(userId, count) {
    if (!io)
        return;
    io.to(userRoom(userId)).emit("messages:unread-count", { count });
}
function emitNotificationNew(recipientId, notification) {
    if (!io)
        return;
    io.to(userRoom(recipientId)).emit("notification:new", { notification });
}
