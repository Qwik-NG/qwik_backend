"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const validation_1 = require("../../utils/validation");
const notifications_1 = require("../../utils/notifications");
const realtime_1 = require("../../lib/realtime");
const router = (0, express_1.Router)();
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
};
async function countUnreadMessages(userId) {
    return prisma_1.prisma.message.count({
        where: {
            senderId: { not: userId },
            readAt: null,
            conversation: {
                participants: {
                    some: { userId },
                },
            },
        },
    });
}
router.post("/", auth_1.requireAuth, auth_1.requireActiveUser, auth_1.requireVerifiedEmail, async (req, res, next) => {
    try {
        const currentUserId = req.auth.userId;
        const body = (0, validation_1.parseOrThrow)(zod_1.z.object({
            conversationId: zod_1.z.string().min(1),
            text: zod_1.z.string().min(1),
            clientId: zod_1.z.string().min(1).max(100).optional(),
            messageType: zod_1.z.enum(["text", "offer"]).optional(),
            offerAmount: zod_1.z.number().positive().optional(),
        }), req.body);
        if (body.messageType === "offer" && !body.offerAmount) {
            return res.status(400).json({ success: false, message: "Offer amount is required" });
        }
        const conversation = await prisma_1.prisma.conversation.findFirst({
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
        const message = await prisma_1.prisma.message.create({
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
        void prisma_1.prisma.conversation
            .update({
            where: { id: body.conversationId },
            data: { updatedAt: new Date() },
        })
            .catch((updateError) => {
            console.error("Failed to update conversation timestamp", updateError);
        });
        void Promise.all(recipientIds.map(async (recipientId) => {
            try {
                const notification = body.messageType === "offer" && body.offerAmount
                    ? await (0, notifications_1.createOfferNotification)({
                        recipientId,
                        senderName: message.sender.fullName,
                        conversationId: body.conversationId,
                        adTitle: conversation.ad?.title,
                        amount: body.offerAmount,
                    })
                    : await (0, notifications_1.createMessageNotification)({
                        recipientId,
                        senderName: message.sender.fullName,
                        conversationId: body.conversationId,
                        adTitle: conversation.ad?.title,
                    });
                if (notification)
                    (0, realtime_1.emitNotificationNew)(recipientId, notification);
            }
            catch (notificationError) {
                console.error("Failed to create message notification", notificationError);
            }
        }));
        (0, realtime_1.emitMessageNew)(body.conversationId, responseMessage, recipientIds);
        (0, realtime_1.emitConversationUpdated)(body.conversationId, {
            lastMessage: responseMessage,
            lastMessageAt: message.createdAt,
        }, participantIds);
        await Promise.all(recipientIds.map(async (recipientId) => {
            (0, realtime_1.emitUnreadMessageCount)(recipientId, await countUnreadMessages(recipientId));
        }));
        res.status(201).json({ success: true, data: responseMessage });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
