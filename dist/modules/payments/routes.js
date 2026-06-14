"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const env_1 = require("../../config/env");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const paymentPricing_1 = require("../../utils/paymentPricing");
const validation_1 = require("../../utils/validation");
const router = (0, express_1.Router)();
const checkoutSchema = zod_1.z.object({
    purpose: zod_1.z.enum(["VERIFICATION", "AD_PROMOTION"]),
    verificationId: zod_1.z.string().optional(),
    adId: zod_1.z.string().optional(),
    plan: zod_1.z.string().optional(),
});
const webhookSchema = zod_1.z.object({
    provider: zod_1.z.string().min(1).default("manual"),
    eventId: zod_1.z.string().min(1),
    paymentId: zod_1.z.string().min(1),
    status: zod_1.z.enum(["PENDING", "PAID", "FAILED", "CANCELLED"]),
    payload: zod_1.z.unknown().optional(),
});
function getCheckoutAmount(purpose, plan) {
    if (purpose === "VERIFICATION")
        return paymentPricing_1.VERIFICATION_PAYMENT_AMOUNT_KOBO;
    if ((0, paymentPricing_1.isPromotionPlan)(plan))
        return (0, paymentPricing_1.getPromotionPaymentAmountKobo)(plan);
    return null;
}
function paymentResponse(payment) {
    return {
        paymentId: payment.id,
        checkoutUrl: payment.checkoutUrl,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        providerReady: Boolean(payment.checkoutUrl),
    };
}
router.post("/checkout", auth_1.requireAuth, async (req, res, next) => {
    try {
        const body = (0, validation_1.parseOrThrow)(checkoutSchema, req.body);
        if (body.purpose === "VERIFICATION" && !body.verificationId) {
            return res.status(400).json({ success: false, message: "verificationId is required" });
        }
        if (body.purpose === "AD_PROMOTION" && !body.adId) {
            return res.status(400).json({ success: false, message: "adId is required" });
        }
        const amount = getCheckoutAmount(body.purpose, body.plan);
        if (amount === null) {
            return res.status(400).json({ success: false, message: "A valid promotion plan is required" });
        }
        if (body.verificationId) {
            const verification = await prisma_1.prisma.verificationApplication.findFirst({
                where: { id: body.verificationId, userId: req.auth.userId },
                select: { id: true },
            });
            if (!verification)
                return res.status(404).json({ success: false, message: "Verification not found" });
        }
        if (body.adId) {
            const ad = await prisma_1.prisma.ad.findFirst({
                where: { id: body.adId, userId: req.auth.userId },
                select: { id: true },
            });
            if (!ad)
                return res.status(404).json({ success: false, message: "Ad not found" });
        }
        const payment = await prisma_1.prisma.paymentTransaction.create({
            data: {
                userId: req.auth.userId,
                verificationId: body.verificationId,
                adId: body.adId,
                purpose: body.purpose,
                amount,
                currency: "NGN",
                status: "PENDING",
                provider: "manual",
                metadata: { plan: body.plan ?? null },
            },
        });
        if (body.verificationId) {
            await prisma_1.prisma.verificationApplication.update({
                where: { id: body.verificationId },
                data: { paymentStatus: "PENDING" },
            });
        }
        res.status(201).json({
            success: true,
            data: paymentResponse(payment),
            message: "Payment record created. Provider checkout is not configured yet.",
        });
    }
    catch (e) {
        next(e);
    }
});
router.get("/:id", auth_1.requireAuth, async (req, res, next) => {
    try {
        const payment = await prisma_1.prisma.paymentTransaction.findFirst({
            where: { id: String(req.params.id), userId: req.auth.userId },
        });
        if (!payment)
            return res.status(404).json({ success: false, message: "Payment not found" });
        res.json({ success: true, data: payment });
    }
    catch (e) {
        next(e);
    }
});
router.post("/webhook", async (req, res, next) => {
    try {
        const expectedToken = `Bearer ${env_1.env.webhookSecret}`;
        if (req.headers.authorization !== expectedToken) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const body = (0, validation_1.parseOrThrow)(webhookSchema, req.body);
        const existingEvent = await prisma_1.prisma.paymentWebhookEvent.findUnique({
            where: { providerEventId: body.eventId },
        });
        if (existingEvent) {
            return res.json({ success: true, data: { processed: false, duplicate: true }, message: "Webhook already processed" });
        }
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            await tx.paymentWebhookEvent.create({
                data: {
                    provider: body.provider,
                    providerEventId: body.eventId,
                    payload: (body.payload ?? req.body),
                },
            });
            const payment = await tx.paymentTransaction.update({
                where: { id: body.paymentId },
                data: { status: body.status, provider: body.provider },
            });
            if (payment.verificationId) {
                await tx.verificationApplication.update({
                    where: { id: payment.verificationId },
                    data: { paymentStatus: body.status === "PAID" ? "PAID" : body.status === "FAILED" ? "FAILED" : "PENDING" },
                });
            }
            if (payment.adId && payment.purpose === "AD_PROMOTION" && body.status === "PAID") {
                await tx.ad.update({ where: { id: payment.adId }, data: { isPromoted: true } });
            }
            return payment;
        });
        res.json({ success: true, data: result, message: "Webhook processed" });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
