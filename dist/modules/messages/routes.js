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
                messageType: body.messageType || "text",
                offerAmount: body.messageType === "offer" ? body.offerAmount : null,
                offerStatus: body.messageType === "offer" ? "pending" : null,
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
// PATCH /messages/:messageId/offer-status
// Update the status of an offer message (accept/reject)
router.patch("/:messageId/offer-status", auth_1.requireAuth, async (req, res, next) => {
    try {
        const currentUserId = req.auth.userId;
        const messageId = String(req.params.messageId);
        const body = (0, validation_1.parseOrThrow)(zod_1.z.object({
            status: zod_1.z.enum(["accepted", "rejected"]),
        }), req.body);
        // Find the message
        const message = await prisma_1.prisma.message.findUnique({
            where: { id: messageId },
            include: {
                conversation: {
                    include: {
                        participants: {
                            select: { userId: true },
                        },
                    },
                },
                sender: {
                    select: userSelect,
                },
            },
        });
        if (!message) {
            return res.status(404).json({ success: false, message: "Message not found" });
        }
        // Verify user is a participant in the conversation
        const isParticipant = message.conversation.participants.some((p) => p.userId === currentUserId);
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }
        // Only offer messages can be updated
        if (message.messageType !== "offer") {
            return res.status(400).json({ success: false, message: "Only offer messages can be updated" });
        }
        // Only pending offers can be accepted/rejected
        if (message.offerStatus !== "pending") {
            return res.status(400).json({ success: false, message: "Only pending offers can be updated" });
        }
        // Only the receiver (not the sender) can accept/reject
        if (message.senderId === currentUserId) {
            return res.status(400).json({ success: false, message: "You cannot accept/reject your own offer" });
        }
        // Update the message status
        const updatedMessage = await prisma_1.prisma.message.update({
            where: { id: messageId },
            data: {
                offerStatus: body.status,
            },
            include: {
                sender: {
                    select: userSelect,
                },
            },
        });
        // Get conversation details for realtime emission
        const conversation = await prisma_1.prisma.conversation.findUnique({
            where: { id: message.conversationId },
            include: {
                participants: {
                    select: { userId: true },
                },
            },
        });
        // Emit realtime update to all participants
        if (conversation) {
            const participantIds = conversation.participants.map((p) => p.userId);
            (0, realtime_1.emitMessageNew)(message.conversationId, updatedMessage, participantIds);
        }
        res.json({ success: true, data: updatedMessage });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
