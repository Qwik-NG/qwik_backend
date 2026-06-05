import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { parseOrThrow } from "../../utils/validation";

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

const messageInclude = {
  sender: {
    select: userSelect,
  },
} as const;

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
} as const;

type ConversationRecord = Awaited<ReturnType<typeof loadConversationForUser>>;

function serializeConversation(record: NonNullable<ConversationRecord>, currentUserId: string) {
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

async function loadConversationForUser(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({
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

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const currentUserId = req.auth!.userId;
    const conversations = await prisma.conversation.findMany({
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
        messages: {
          orderBy: {
            createdAt: "asc",
          },
          include: messageInclude,
        },
      },
    });

    res.json({
      success: true,
      data: conversations.map((conversation) => serializeConversation(conversation, currentUserId)),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const currentUserId = req.auth!.userId;
    const conversationId = String(req.params.id);

    await prisma.message.updateMany({
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

    res.json({ success: true, data: serializeConversation(conversation, currentUserId) });
  } catch (e) {
    next(e);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const currentUserId = req.auth!.userId;
    const body = parseOrThrow(
      z.object({
        recipientId: z.string().min(1),
        message: z.string().min(1),
        adId: z.string().min(1).optional(),
      }),
      req.body,
    );

    if (body.recipientId === currentUserId) {
      return res.status(400).json({ success: false, message: "You cannot message yourself" });
    }

    const recipient = await prisma.user.findUnique({ where: { id: body.recipientId } });
    if (!recipient) {
      return res.status(404).json({ success: false, message: "Recipient not found" });
    }

    if (body.adId) {
      const ad = await prisma.ad.findUnique({ where: { id: body.adId } });
      if (!ad) {
        return res.status(404).json({ success: false, message: "Ad not found" });
      }
    }

    const existingCandidates = await prisma.conversation.findMany({
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

    const conversationId = existingConversation?.id ?? (
      await prisma.conversation.create({
        data: {
          adId: body.adId,
          participants: {
            create: [{ userId: currentUserId }, { userId: body.recipientId }],
          },
        },
      })
    ).id;

    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId,
          senderId: currentUserId,
          text: body.message.trim(),
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const conversation = await loadConversationForUser(conversationId, currentUserId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    res.status(201).json({ success: true, data: serializeConversation(conversation, currentUserId) });
  } catch (e) {
    next(e);
  }
});

export default router;