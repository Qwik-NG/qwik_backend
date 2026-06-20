"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const env_1 = require("../../config/env");
const paystack_1 = require("../../lib/paystack");
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
const verifySchema = zod_1.z.object({
    reference: zod_1.z.string().min(1),
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
        reference: payment.providerRef ?? null,
        purpose: payment.purpose ?? null,
        adId: payment.adId ?? null,
        verificationId: payment.verificationId ?? null,
        checkoutUrl: payment.checkoutUrl,
        authorization_url: payment.checkoutUrl,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        providerReady: Boolean(payment.checkoutUrl),
    };
}
function paystackCallbackUrl(reference) {
    const baseUrl = env_1.env.paystackCallbackUrl || `${env_1.env.frontendUrl.split(",")[0].trim().replace(/\/$/, "")}/payment/callback`;
    const url = new URL(baseUrl);
    url.searchParams.set("reference", reference);
    return url.toString();
}
function frontendPaymentCallbackUrl(reference) {
    const frontendBase = env_1.env.frontendUrl.split(",")[0].trim().replace(/\/$/, "");
    const url = new URL(`${frontendBase}/payment/callback`);
    url.searchParams.set("reference", reference);
    return url.toString();
}
async function applyPaymentStatus(tx, input) {
    const payment = await tx.paymentTransaction.findUnique({ where: { id: input.paymentId } });
    if (!payment)
        throw Object.assign(new Error("Payment not found"), { status: 404 });
    if (input.expectedAmount !== undefined && payment.amount !== input.expectedAmount) {
        throw Object.assign(new Error("Payment amount mismatch"), { status: 400 });
    }
    // Preserve confirmed successful payments from late/duplicate failure events.
    if (payment.status === "PAID" && input.status !== "PAID") {
        return payment;
    }
    if (payment.status === input.status) {
        return payment;
    }
    const updatedPayment = await tx.paymentTransaction.update({
        where: { id: input.paymentId },
        data: {
            status: input.status,
            provider: input.provider,
            ...(input.providerRef ? { providerRef: input.providerRef } : {}),
        },
    });
    if (updatedPayment.verificationId) {
        await tx.verificationApplication.update({
            where: { id: updatedPayment.verificationId },
            data: {
                paymentStatus: input.status === "PAID" ? "PAID" : input.status === "FAILED" ? "FAILED" : input.status === "CANCELLED" ? "FAILED" : "PENDING",
                ...(input.status === "PAID" ? { status: "SUBMITTED", submittedAt: new Date(), rejectionReason: null } : {}),
            },
        });
    }
    if (updatedPayment.adId
        && updatedPayment.purpose === "AD_PROMOTION"
        && input.status === "PAID"
        && payment.status !== "PAID") {
        await tx.ad.updateMany({ where: { id: updatedPayment.adId, isPromoted: false }, data: { isPromoted: true } });
    }
    return updatedPayment;
}
router.post("/checkout", auth_1.requireAuth, async (req, res, next) => {
    try {
        const body = (0, validation_1.parseOrThrow)(checkoutSchema, req.body);
        const currentUser = await prisma_1.prisma.user.findUnique({ where: { id: req.auth.userId }, select: { id: true, email: true } });
        if (!currentUser)
            return res.status(404).json({ success: false, message: "User not found" });
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
                provider: "paystack",
                metadata: { plan: body.plan ?? null },
            },
        });
        const reference = (0, paystack_1.createPaystackReference)(payment.id);
        const initialized = await (0, paystack_1.initializePaystackTransaction)({
            email: currentUser.email,
            amount: payment.amount,
            reference,
            callbackUrl: paystackCallbackUrl(reference),
            metadata: {
                paymentId: payment.id,
                userId: currentUser.id,
                purpose: payment.purpose,
                verificationId: payment.verificationId,
                adId: payment.adId,
                plan: body.plan ?? null,
            },
        });
        const updatedPayment = await prisma_1.prisma.paymentTransaction.update({
            where: { id: payment.id },
            data: {
                providerRef: initialized.reference,
                checkoutUrl: initialized.authorizationUrl,
                metadata: { plan: body.plan ?? null, paystackAccessCode: initialized.accessCode },
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
            data: paymentResponse(updatedPayment),
            message: "Paystack checkout initialized.",
        });
    }
    catch (e) {
        next(e);
    }
});
router.post("/verify", auth_1.requireAuth, async (req, res, next) => {
    try {
        const { reference } = (0, validation_1.parseOrThrow)(verifySchema, req.body);
        const payment = await prisma_1.prisma.paymentTransaction.findFirst({
            where: { providerRef: reference, userId: req.auth.userId },
        });
        if (!payment)
            return res.status(404).json({ success: false, message: "Payment not found" });
        const paystackPayment = await (0, paystack_1.verifyPaystackTransaction)(reference);
        if (paystackPayment.reference !== reference) {
            return res.status(400).json({ success: false, message: "Payment reference mismatch" });
        }
        const status = (0, paystack_1.mapPaystackStatus)(paystackPayment.status);
        const result = await prisma_1.prisma.$transaction((tx) => applyPaymentStatus(tx, {
            paymentId: payment.id,
            status,
            provider: "paystack",
            providerRef: reference,
            expectedAmount: paystackPayment.amount,
        }));
        res.json({ success: true, data: paymentResponse(result), message: status === "PAID" ? "Payment verified" : "Payment is not complete" });
    }
    catch (e) {
        next(e);
    }
});
router.get("/callback", async (req, res, next) => {
    try {
        const { reference } = (0, validation_1.parseOrThrow)(verifySchema, req.query);
        const payment = await prisma_1.prisma.paymentTransaction.findUnique({ where: { providerRef: reference } });
        if (!payment)
            return res.status(404).json({ success: false, message: "Payment not found" });
        // Public callback endpoint only redirects user back to frontend.
        // Payment state mutation must happen through authenticated /verify.
        res.redirect(303, frontendPaymentCallbackUrl(payment.providerRef ?? reference));
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
        const paystackSignature = req.headers["x-paystack-signature"];
        if (paystackSignature) {
            const rawBody = req.rawBody;
            if (!(0, paystack_1.verifyPaystackSignature)(rawBody, paystackSignature)) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }
            const event = String(req.body.event ?? "");
            const data = req.body.data ?? {};
            const reference = typeof data.reference === "string" ? data.reference : "";
            const providerEventId = String(data.id ?? `${event}:${reference}`);
            const amount = typeof data.amount === "number" ? data.amount : undefined;
            if (!event || !reference)
                return res.status(400).json({ success: false, message: "Invalid Paystack webhook payload" });
            const existingEvent = await prisma_1.prisma.paymentWebhookEvent.findUnique({ where: { providerEventId } });
            if (existingEvent) {
                return res.json({ success: true, data: { processed: false, duplicate: true }, message: "Webhook already processed" });
            }
            const payment = await prisma_1.prisma.paymentTransaction.findUnique({ where: { providerRef: reference } });
            if (!payment)
                return res.status(404).json({ success: false, message: "Payment not found" });
            const verifiedPayment = await (0, paystack_1.verifyPaystackTransaction)(reference);
            if (verifiedPayment.reference !== reference) {
                return res.status(400).json({ success: false, message: "Payment reference mismatch" });
            }
            const status = (0, paystack_1.mapPaystackStatus)(verifiedPayment.status);
            const result = await prisma_1.prisma.$transaction(async (tx) => {
                await tx.paymentWebhookEvent.create({
                    data: { provider: "paystack", providerEventId, payload: req.body },
                });
                return applyPaymentStatus(tx, {
                    paymentId: payment.id,
                    status,
                    provider: "paystack",
                    providerRef: reference,
                    expectedAmount: verifiedPayment.amount,
                });
            });
            return res.json({ success: true, data: result, message: "Webhook processed" });
        }
        const expectedToken = `Bearer ${env_1.env.webhookSecret}`;
        if (req.headers.authorization !== expectedToken) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }
        const body = (0, validation_1.parseOrThrow)(webhookSchema, req.body);
        if (body.provider.toLowerCase() === "paystack") {
            return res.status(400).json({ success: false, message: "Paystack updates must use signed Paystack webhook events" });
        }
        const targetPayment = await prisma_1.prisma.paymentTransaction.findUnique({
            where: { id: body.paymentId },
            select: { id: true, provider: true },
        });
        if (!targetPayment) {
            return res.status(404).json({ success: false, message: "Payment not found" });
        }
        if (targetPayment.provider.toLowerCase() === "paystack") {
            return res.status(400).json({ success: false, message: "Paystack payments can only be updated via verify or signed Paystack webhooks" });
        }
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
            return applyPaymentStatus(tx, { paymentId: body.paymentId, status: body.status, provider: body.provider });
        });
        res.json({ success: true, data: result, message: "Webhook processed" });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
