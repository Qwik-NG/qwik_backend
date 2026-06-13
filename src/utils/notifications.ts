import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";

type NotificationClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type MessageNotificationInput = {
  recipientId: string;
  senderName: string;
  conversationId: string;
  adTitle?: string | null;
};

type OfferNotificationInput = MessageNotificationInput & {
  amount: number;
};

function formatNaira(value: number) {
  return `₦${value.toLocaleString()}`;
}

export async function createMessageNotification(
  input: MessageNotificationInput,
  client: NotificationClient = prisma,
) {
  const settings = await client.notificationSettings.findUnique({
    where: { userId: input.recipientId },
    select: { messageNotifications: true },
  });

  if (settings && !settings.messageNotifications) return null;

  const subject = input.adTitle ? ` about ${input.adTitle}` : "";
  return client.notification.create({
    data: {
      userId: input.recipientId,
      type: "message",
      title: "New message",
      body: `${input.senderName} sent you a new message${subject}.`,
      actionUrl: `/messages?conversation=${input.conversationId}`,
      data: {
        conversationId: input.conversationId,
      },
    },
  });
}

export async function createOfferNotification(
  input: OfferNotificationInput,
  client: NotificationClient = prisma,
) {
  const settings = await client.notificationSettings.findUnique({
    where: { userId: input.recipientId },
    select: { offerNotifications: true },
  });

  if (settings && !settings.offerNotifications) return null;

  const subject = input.adTitle ? ` for ${input.adTitle}` : "";
  return client.notification.create({
    data: {
      userId: input.recipientId,
      type: "offer",
      title: "New offer",
      body: `${input.senderName} sent an offer of ${formatNaira(input.amount)}${subject}.`,
      actionUrl: `/messages?conversation=${input.conversationId}`,
      data: {
        conversationId: input.conversationId,
        amount: input.amount,
      },
    },
  });
}
