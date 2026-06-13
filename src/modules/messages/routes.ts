import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { parseOrThrow } from "../../utils/validation";
import { createMessageNotification, createOfferNotification } from "../../utils/notifications";
import { emitConversationUpdated, emitMessageNew, emitNotificationNew } from "../../lib/realtime";

const router = Router();

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  location: true,
  createdAt: true,
  updatedAt: true,
  profile: {
    select: {
      bio: true,
      avatarUrl: true,
      preferences: true,
    },
  },
} as const;

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const currentUserId = req.auth!.userId;
    const body = parseOrThrow(
      z.object({
        conversationId: z.string().min(1),
        text: z.string().min(1),
        clientId: z.string().min(1).max(100).optional(),
        messageType: z.enum(["text", "offer"]).optional(),
        offerAmount: z.number().positive().optional(),
      }),
      req.body,
    );

    if (body.messageType === "offer" && !body.offerAmount) {
      return res.status(400).json({ success: false, message: "Offer amount is required" });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: body.conversationId,
        participants: {
          some: {
            userId: currentUserId,
          },
        },
      },
      select: {
        ad: { select: { title: true } },
        participants: { select: { userId: true } },
      },
    });

    if (!conversation) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: body.conversationId,
        senderId: currentUserId,
        text: body.text.trim(),
      },
      include: {
        sender: {
          select: userSelect,
        },
      },
    });

    const participantIds = conversation.participants.map((participant) => participant.userId);
    const recipientIds = participantIds.filter((userId) => userId !== currentUserId);
    const responseMessage = body.clientId ? { ...message, clientId: body.clientId } : message;

    void prisma.conversation
      .update({
        where: { id: body.conversationId },
        data: { updatedAt: new Date() },
      })
      .catch((updateError) => {
        console.error("Failed to update conversation timestamp", updateError);
      });

    void Promise.all(
      recipientIds.map(async (recipientId) => {
        try {
          const notification = body.messageType === "offer" && body.offerAmount
            ? await createOfferNotification({
                recipientId,
                senderName: message.sender.fullName,
                conversationId: body.conversationId,
                adTitle: conversation.ad?.title,
                amount: body.offerAmount,
              })
            : await createMessageNotification({
                recipientId,
                senderName: message.sender.fullName,
                conversationId: body.conversationId,
                adTitle: conversation.ad?.title,
              });
          if (notification) emitNotificationNew(recipientId, notification);
        } catch (notificationError) {
          console.error("Failed to create message notification", notificationError);
        }
      }),
    );

    emitMessageNew(body.conversationId, responseMessage, recipientIds);
    emitConversationUpdated(
      body.conversationId,
      {
        lastMessage: responseMessage,
        lastMessageAt: message.createdAt,
      },
      participantIds,
    );

    res.status(201).json({ success: true, data: responseMessage });
  } catch (e) {
    next(e);
  }
});

export default router;
