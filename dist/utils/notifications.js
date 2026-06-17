"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessageNotification = createMessageNotification;
exports.createOfferNotification = createOfferNotification;
exports.createSellerNewAdNotifications = createSellerNewAdNotifications;
const prisma_1 = require("../lib/prisma");
function formatNaira(value) {
    return `₦${value.toLocaleString()}`;
}
async function createMessageNotification(input, client = prisma_1.prisma) {
    const settings = await client.notificationSettings.findUnique({
        where: { userId: input.recipientId },
        select: { messageNotifications: true },
    });
    if (settings && !settings.messageNotifications)
        return null;
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
async function createOfferNotification(input, client = prisma_1.prisma) {
    const settings = await client.notificationSettings.findUnique({
        where: { userId: input.recipientId },
        select: { offerNotifications: true },
    });
    if (settings && !settings.offerNotifications)
        return null;
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
async function createSellerNewAdNotifications(input, client = prisma_1.prisma) {
    const followers = await client.follow.findMany({
        where: {
            followingId: input.sellerId,
            followerId: { not: input.sellerId },
        },
        select: { followerId: true },
    });
    if (followers.length === 0)
        return [];
    const followerIds = Array.from(new Set(followers.map((item) => item.followerId)));
    const settings = await client.notificationSettings.findMany({
        where: { userId: { in: followerIds } },
        select: { userId: true, systemNotifications: true },
    });
    const mutedRecipients = new Set(settings
        .filter((setting) => !setting.systemNotifications)
        .map((setting) => setting.userId));
    const recipients = followerIds.filter((id) => !mutedRecipients.has(id));
    if (recipients.length === 0)
        return [];
    const actionUrl = `/product-details/${input.adId}`;
    const results = await Promise.allSettled(recipients.map((recipientId) => client.notification.create({
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
    })));
    const createdNotifications = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
    results
        .filter((result) => result.status === "rejected")
        .forEach((result) => {
        console.error("Failed to create seller new-ad notification", result.reason);
    });
    return createdNotifications;
}
