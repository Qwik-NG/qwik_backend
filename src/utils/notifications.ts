import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { queueNewMessageEmail } from "../lib/engagementOutbox";

type NotificationClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

type MessageNotificationInput = {
  recipientId: string;
  senderName: string;
  conversationId: string;
  adTitle?: string | null;
};

type MessageEmailOutboxInput = MessageNotificationInput & {
  recipientEmail: string;
  messageId: string;
  messageText: string;
  messageType?: string | null;
};

type OfferNotificationInput = MessageNotificationInput & {
  amount: number;
};

type SellerNewAdNotificationInput = {
  sellerId: string;
  sellerName: string;
  adId: string;
  adTitle: string;
};

function formatNaira(value: number) {
  return `₦${value.toLocaleString()}`;
}

function sanitizeMessagePreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 140) return normalized;
  return `${normalized.slice(0, 137)}...`;
}

function frontendBaseUrl() {
  const primaryOrigin = env.frontendUrl.split(",")[0]?.trim().replace(/\/$/, "");
  if (!primaryOrigin || !/^https?:\/\//.test(primaryOrigin)) return "";
  return primaryOrigin;
}

function messageLinks(conversationId: string) {
  const conversationPath = `/messages?conversation=${encodeURIComponent(conversationId)}`;
  const fallbackPath = "/messages";
  const baseUrl = frontendBaseUrl();

  if (!baseUrl) {
    return {
      conversationPath,
      fallbackPath,
      conversationUrl: conversationPath,
      fallbackUrl: fallbackPath,
    };
  }

  return {
    conversationPath,
    fallbackPath,
    conversationUrl: `${baseUrl}${conversationPath}`,
    fallbackUrl: `${baseUrl}${fallbackPath}`,
  };
}

export async function queueMessageEmailNotification(
  input: MessageEmailOutboxInput,
  client: NotificationClient = prisma,
) {
  // TODO(Phase 1.1): add per-conversation cooldown window to reduce burst email volume.
  if (input.messageType === "offer") {
    return { queued: false as const, duplicate: false, reason: "offer-message" as const };
  }

  if (!input.recipientEmail) {
    return { queued: false as const, duplicate: false, reason: "missing-recipient-email" as const };
  }

  const settings = await client.notificationSettings.findUnique({
    where: { userId: input.recipientId },
    select: { emailNotifications: true, messageNotifications: true },
  });

  if (settings && (!settings.emailNotifications || !settings.messageNotifications)) {
    return { queued: false as const, duplicate: false, reason: "notifications-disabled" as const };
  }

  const preview = sanitizeMessagePreview(input.messageText);
  const links = messageLinks(input.conversationId);
  const listSuffix = input.adTitle ? ` about ${input.adTitle}` : "";
  const subject = input.adTitle
    ? `New message on Qwik about ${input.adTitle}`
    : "New message on Qwik";

  const htmlBody = `<p>Hi there,</p>
<p><strong>${input.senderName}</strong> sent you a new message${listSuffix}.</p>
<p><em>"${preview}"</em></p>
<p><a href="${links.conversationUrl}">Open messages</a></p>
<p>If the button does not work, use this link: <a href="${links.fallbackUrl}">${links.fallbackUrl}</a></p>
<p>You can manage your notification preferences in your account settings.</p>`;

  const textBody = [
    `Hi there,`,
    "",
    `${input.senderName} sent you a new message${listSuffix}.`,
    `"${preview}"`,
    "",
    `Open messages: ${links.conversationUrl}`,
    `Fallback: ${links.fallbackUrl}`,
    "",
    "You can manage your notification preferences in your account settings.",
  ].join("\n");

  const { job, duplicate } = await queueNewMessageEmail(
    {
      recipientId: input.recipientId,
      recipientEmail: input.recipientEmail,
      idempotencyKey: input.messageId,
      subject,
      htmlBody,
      textBody,
      actionUrl: links.conversationPath,
      payload: {
        kind: "new-message-email",
        conversationId: input.conversationId,
        messageId: input.messageId,
        senderName: input.senderName,
      },
    },
    client,
  );

  return { queued: true as const, duplicate, jobId: job.id };
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

export async function createSellerNewAdNotifications(
  input: SellerNewAdNotificationInput,
  client: NotificationClient = prisma,
) {
  const followers = await client.follow.findMany({
    where: {
      followingId: input.sellerId,
      followerId: { not: input.sellerId },
    },
    select: { followerId: true },
  });

  if (followers.length === 0) return [];

  const followerIds = Array.from(new Set(followers.map((item) => item.followerId)));
  const settings = await client.notificationSettings.findMany({
    where: { userId: { in: followerIds } },
    select: { userId: true, systemNotifications: true },
  });
  const mutedRecipients = new Set(
    settings
      .filter((setting) => !setting.systemNotifications)
      .map((setting) => setting.userId),
  );
  const recipients = followerIds.filter((id) => !mutedRecipients.has(id));

  if (recipients.length === 0) return [];

  const actionUrl = `/product-details/${input.adId}`;
  const results = await Promise.allSettled(
    recipients.map((recipientId) =>
      client.notification.create({
        data: {
          userId: recipientId,
          type: "SELLER_NEW_AD",
          title: `New ad from ${input.sellerName}`,
          body: `${input.sellerName} posted "${input.adTitle}"`,
          actionUrl,
          data: {
            adId: input.adId,
            sellerId: input.sellerId,
            sellerName: input.sellerName,
            adTitle: input.adTitle,
          },
        },
      }),
    ),
  );

  const createdNotifications = results
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<NotificationClient["notification"]["create"]>>> => result.status === "fulfilled")
    .map((result) => result.value);

  results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .forEach((result) => {
      console.error("Failed to create seller new-ad notification", result.reason);
    });

  return createdNotifications;
}
