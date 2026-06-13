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
const messageInclude = {
    sender: {
        select: userSelect,
    },
};
const conversationInclude = {
    ad: {
        select: {
            id: true,
            title: true,
            images: {
                take: 1,
                select: {
                    id: true,
                    url: true,
                },
            },
        },
    },
    participants: {
        include: {
            user: {
                select: userSelect,
            },
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
function serializeConversation(record, currentUserId) {
    const participants = record.participants.map((participant) => participant.user);
    const lastMessage = record.messages?.[record.messages.length - 1];
    const unreadCount = record.messages
        ? record.messages.filter((message) => message.senderId !== currentUserId && !message.readAt).length
        : 0;
    return {
        id: record.id,
        participants,
        lastMessage,
        lastMessageAt: lastMessage?.createdAt ?? record.updatedAt,
        unreadCount,
        messages: record.messages,
        ad: record.ad,
    };
}
async function loadConversationForUser(conversationId, userId) {
    return prisma_1.prisma.conversation.findFirst({
        where: {
            id: conversationId,
            participants: {
                some: {
                    userId,
                },
            },
        },
        include: {
            ...conversationInclude,
            messages: {
                orderBy: {
                    createdAt: "asc",
                },
                include: messageInclude,
            },
        },
    });
}
router.get("/", auth_1.requireAuth, async (req, res, next) => {
    try {
        const currentUserId = req.auth.userId;
        const conversations = await prisma_1.prisma.conversation.findMany({
            where: {
                participants: {
                    some: {
                        userId: currentUserId,
                    },
                },
            },
            orderBy: {
                updatedAt: "desc",
            },
            include: {
                ...conversationInclude,
                _count: {
                    select: {
                        messages: {
                            where: {
                                senderId: { not: currentUserId },
                                readAt: null,
                            },
                        },
                    },
                },
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    include: messageInclude,
                },
            },
        });
        res.json({
            success: true,
            data: conversations.map((conversation) => ({
                ...serializeConversation({
                    ...conversation,
                    messages: [...conversation.messages].reverse(),
                }, currentUserId),
                unreadCount: conversation._count.messages,
            })),
        });
    }
    catch (e) {
        next(e);
    }
});
router.get("/unread-count", auth_1.requireAuth, async (req, res, next) => {
    try {
        const count = await countUnreadMessages(req.auth.userId);
        res.json({ success: true, data: { count } });
    }
    catch (e) {
        next(e);
    }
});
router.get("/:id", auth_1.requireAuth, async (req, res, next) => {
    try {
        const currentUserId = req.auth.userId;
        const conversationId = String(req.params.id);
        const participant = await prisma_1.prisma.conversationParticipant.findUnique({
            where: {
                conversationId_userId: {
                    conversationId,
                    userId: currentUserId,
                },
            },
            select: { id: true },
        });
        if (!participant) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        const readResult = await prisma_1.prisma.message.updateMany({
            where: {
                conversationId,
                senderId: {
                    not: currentUserId,
                },
                readAt: null,
            },
            data: {
                readAt: new Date(),
            },
        });
        const conversation = await loadConversationForUser(conversationId, currentUserId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        if (readResult.count > 0) {
            (0, realtime_1.emitUnreadMessageCount)(currentUserId, await countUnreadMessages(currentUserId));
        }
        res.json({ success: true, data: serializeConversation(conversation, currentUserId) });
    }
    catch (e) {
        next(e);
    }
});
router.post("/", auth_1.requireAuth, async (req, res, next) => {
    try {
        const currentUserId = req.auth.userId;
        const body = (0, validation_1.parseOrThrow)(zod_1.z.object({
            recipientId: zod_1.z.string().min(1),
            message: zod_1.z.string().min(1),
            adId: zod_1.z.string().min(1).optional(),
            clientId: zod_1.z.string().min(1).max(100).optional(),
            messageType: zod_1.z.enum(["text", "offer"]).optional(),
            offerAmount: zod_1.z.number().positive().optional(),
        }), req.body);
        if (body.messageType === "offer" && !body.offerAmount) {
            return res.status(400).json({ success: false, message: "Offer amount is required" });
        }
        if (body.recipientId === currentUserId) {
            return res.status(400).json({ success: false, message: "You cannot message yourself" });
        }
        const recipient = await prisma_1.prisma.user.findUnique({ where: { id: body.recipientId } });
        if (!recipient) {
            return res.status(404).json({ success: false, message: "Recipient not found" });
        }
        if (body.adId) {
            const ad = await prisma_1.prisma.ad.findUnique({ where: { id: body.adId } });
            if (!ad) {
                return res.status(404).json({ success: false, message: "Ad not found" });
            }
        }
        const existingCandidates = await prisma_1.prisma.conversation.findMany({
            where: {
                adId: body.adId,
                participants: {
                    some: {
                        userId: currentUserId,
                    },
                },
                AND: {
                    participants: {
                        some: {
                            userId: body.recipientId,
                        },
                    },
                },
            },
            include: {
                participants: true,
            },
        });
        const existingConversation = existingCandidates.find((conversation) => {
            const participantIds = conversation.participants.map((participant) => participant.userId).sort();
            return participantIds.length === 2 && participantIds[0] !== participantIds[1];
        });
        const conversationId = existingConversation?.id ?? (await prisma_1.prisma.conversation.create({
            data: {
                adId: body.adId,
                participants: {
                    create: [{ userId: currentUserId }, { userId: body.recipientId }],
                },
            },
        })).id;
        const message = await prisma_1.prisma.message.create({
            data: {
                conversationId,
                senderId: currentUserId,
                text: body.message.trim(),
            },
            include: messageInclude,
        });
        const updatedConversation = await prisma_1.prisma.conversation.update({
            where: { id: conversationId },
            include: {
                ad: { select: { title: true } },
                participants: { select: { userId: true } },
            },
            data: { updatedAt: new Date() },
        });
        const responseMessage = body.clientId ? { ...message, clientId: body.clientId } : message;
        const notificationRequest = body.messageType === "offer" && body.offerAmount
            ? (0, notifications_1.createOfferNotification)({
                recipientId: body.recipientId,
                senderName: message.sender.fullName,
                conversationId,
                adTitle: updatedConversation.ad?.title,
                amount: body.offerAmount,
            })
            : (0, notifications_1.createMessageNotification)({
                recipientId: body.recipientId,
                senderName: message.sender.fullName,
                conversationId,
                adTitle: updatedConversation.ad?.title,
            });
        void notificationRequest
            .then((notification) => {
            if (notification)
                (0, realtime_1.emitNotificationNew)(body.recipientId, notification);
        })
            .catch((notificationError) => {
            console.error("Failed to create message notification", notificationError);
        });
        const participantIds = updatedConversation.participants.map((participant) => participant.userId);
        (0, realtime_1.emitMessageNew)(conversationId, responseMessage, [body.recipientId]);
        (0, realtime_1.emitConversationUpdated)(conversationId, {
            lastMessage: responseMessage,
            lastMessageAt: message.createdAt,
        }, participantIds);
        (0, realtime_1.emitUnreadMessageCount)(body.recipientId, await countUnreadMessages(body.recipientId));
        const conversation = await loadConversationForUser(conversationId, currentUserId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        res.status(201).json({ success: true, data: serializeConversation(conversation, currentUserId) });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
