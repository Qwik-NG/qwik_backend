"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMessageNotification = createMessageNotification;
exports.createOfferNotification = createOfferNotification;
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
