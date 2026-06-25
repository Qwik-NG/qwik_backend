import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { createPaystackReference, initializePaystackTransaction, mapPaystackStatus, verifyPaystackSignature, verifyPaystackTransaction } from "../../lib/paystack";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { getPromotionDurationDays, getPromotionPaymentAmountKobo, isPromotionPlan, VERIFICATION_PAYMENT_AMOUNT_KOBO } from "../../utils/paymentPricing";
import { parseOrThrow } from "../../utils/validation";

const router = Router();

const checkoutSchema = z.object({
  purpose: z.enum(["VERIFICATION", "AD_PROMOTION"]),
  verificationId: z.string().optional(),
  adId: z.string().optional(),
  plan: z.string().optional(),
});

const webhookSchema = z.object({
  provider: z.string().min(1).default("manual"),
  eventId: z.string().min(1),
  paymentId: z.string().min(1),
  status: z.enum(["PENDING", "PAID", "FAILED", "CANCELLED"]),
  payload: z.unknown().optional(),
});

const verifySchema = z.object({
  reference: z.string().min(1),
});

type PaymentStatusValue = "PENDING" | "PAID" | "FAILED" | "CANCELLED";

function getCheckoutAmount(purpose: "VERIFICATION" | "AD_PROMOTION", plan?: string) {
  if (purpose === "VERIFICATION") return VERIFICATION_PAYMENT_AMOUNT_KOBO;
  if (isPromotionPlan(plan)) return getPromotionPaymentAmountKobo(plan);
  return null;
}

function paymentResponse(payment: {
  id: string;
  providerRef?: string | null;
  purpose?: string;
  adId?: string | null;
  verificationId?: string | null;
  amount: number;
  currency: string;
  status: string;
  checkoutUrl: string | null;
}) {
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

function paystackCallbackUrl(reference: string) {
  const baseUrl = env.paystackCallbackUrl || `${env.frontendUrl.split(",")[0].trim().replace(/\/$/, "")}/payment/callback`;
  const url = new URL(baseUrl);
  url.searchParams.set("reference", reference);
  return url.toString();
}

function frontendPaymentCallbackUrl(reference: string) {
  const frontendBase = env.frontendUrl.split(",")[0].trim().replace(/\/$/, "");
  const url = new URL(`${frontendBase}/payment/callback`);
  url.searchParams.set("reference", reference);
  return url.toString();
}

async function applyPaymentStatus(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], input: {
  paymentId: string;
  status: PaymentStatusValue;
  provider: string;
  providerRef?: string | null;
  expectedAmount?: number;
}) {
  const payment = await tx.paymentTransaction.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw Object.assign(new Error("Payment not found"), { status: 404 });
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

  if (
    updatedPayment.adId
    && updatedPayment.purpose === "AD_PROMOTION"
    && input.status === "PAID"
    && payment.status !== "PAID"
  ) {
    const promotionPlan = (updatedPayment.metadata as { plan?: string } | null)?.plan;
    const durationDays = promotionPlan && isPromotionPlan(promotionPlan) ? getPromotionDurationDays(promotionPlan) : 30;
    const now = new Date();
    const promotedUntil = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
    await tx.ad.updateMany({
      where: { id: updatedPayment.adId, isPromoted: false },
      data: { isPromoted: true, promotedAt: now, promotedUntil },
    });
  }

  return updatedPayment;
}

router.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    const body = parseOrThrow(checkoutSchema, req.body);
    const currentUser = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, email: true } });
    if (!currentUser) return res.status(404).json({ success: false, message: "User not found" });

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
      const verification = await prisma.verificationApplication.findFirst({
        where: { id: body.verificationId, userId: req.auth!.userId },
        select: { id: true },
      });
      if (!verification) return res.status(404).json({ success: false, message: "Verification not found" });
    }

    if (body.adId) {
      const ad = await prisma.ad.findFirst({
        where: { id: body.adId, userId: req.auth!.userId },
        select: { id: true },
      });
      if (!ad) return res.status(404).json({ success: false, message: "Ad not found" });
    }

    const payment = await prisma.paymentTransaction.create({
      data: {
        userId: req.auth!.userId,
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

    const reference = createPaystackReference(payment.id);
    const initialized = await initializePaystackTransaction({
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

    const updatedPayment = await prisma.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        providerRef: initialized.reference,
        checkoutUrl: initialized.authorizationUrl,
        metadata: { plan: body.plan ?? null, paystackAccessCode: initialized.accessCode },
      },
    });

    if (body.verificationId) {
      await prisma.verificationApplication.update({
        where: { id: body.verificationId },
        data: { paymentStatus: "PENDING" },
      });
    }

    res.status(201).json({
      success: true,
      data: paymentResponse(updatedPayment),
      message: "Paystack checkout initialized.",
    });
  } catch (e) {
    next(e);
  }
});

router.post("/verify", requireAuth, async (req, res, next) => {
  try {
    const { reference } = parseOrThrow(verifySchema, req.body);
    const payment = await prisma.paymentTransaction.findFirst({
      where: { providerRef: reference, userId: req.auth!.userId },
    });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

    const paystackPayment = await verifyPaystackTransaction(reference);
    if (paystackPayment.reference !== reference) {
      return res.status(400).json({ success: false, message: "Payment reference mismatch" });
    }

    const status = mapPaystackStatus(paystackPayment.status);
    const result = await prisma.$transaction((tx) => applyPaymentStatus(tx, {
      paymentId: payment.id,
      status,
      provider: "paystack",
      providerRef: reference,
      expectedAmount: paystackPayment.amount,
    }));

    res.json({ success: true, data: paymentResponse(result), message: status === "PAID" ? "Payment verified" : "Payment is not complete" });
  } catch (e) {
    next(e);
  }
});

router.get("/callback", async (req, res, next) => {
  try {
    const { reference } = parseOrThrow(verifySchema, req.query);
    const payment = await prisma.paymentTransaction.findUnique({ where: { providerRef: reference } });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

    // Public callback endpoint only redirects user back to frontend.
    // Payment state mutation must happen through authenticated /verify.
    res.redirect(303, frontendPaymentCallbackUrl(payment.providerRef ?? reference));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const payment = await prisma.paymentTransaction.findFirst({
      where: { id: String(req.params.id), userId: req.auth!.userId },
    });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });
    res.json({ success: true, data: payment });
  } catch (e) {
    next(e);
  }
});

router.post("/webhook", async (req, res, next) => {
  try {
    const paystackSignature = req.headers["x-paystack-signature"];
    if (paystackSignature) {
      const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
      if (!verifyPaystackSignature(rawBody, paystackSignature)) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const event = String((req.body as { event?: unknown }).event ?? "");
      const data = (req.body as { data?: Record<string, unknown> }).data ?? {};
      const reference = typeof data.reference === "string" ? data.reference : "";
      const providerEventId = String(data.id ?? `${event}:${reference}`);
      const amount = typeof data.amount === "number" ? data.amount : undefined;
      if (!event || !reference) return res.status(400).json({ success: false, message: "Invalid Paystack webhook payload" });

      const existingEvent = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId } });
      if (existingEvent) {
        return res.json({ success: true, data: { processed: false, duplicate: true }, message: "Webhook already processed" });
      }

      const payment = await prisma.paymentTransaction.findUnique({ where: { providerRef: reference } });
      if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

      const verifiedPayment = await verifyPaystackTransaction(reference);
      if (verifiedPayment.reference !== reference) {
        return res.status(400).json({ success: false, message: "Payment reference mismatch" });
      }
      const status = mapPaystackStatus(verifiedPayment.status);

      const result = await prisma.$transaction(async (tx) => {
        await tx.paymentWebhookEvent.create({
          data: { provider: "paystack", providerEventId, payload: req.body as any },
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

    const expectedToken = `Bearer ${env.webhookSecret}`;
    if (req.headers.authorization !== expectedToken) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = parseOrThrow(webhookSchema, req.body);
    if (body.provider.toLowerCase() === "paystack") {
      return res.status(400).json({ success: false, message: "Paystack updates must use signed Paystack webhook events" });
    }

    const targetPayment = await prisma.paymentTransaction.findUnique({
      where: { id: body.paymentId },
      select: { id: true, provider: true },
    });
    if (!targetPayment) {
      return res.status(404).json({ success: false, message: "Payment not found" });
    }
    if (targetPayment.provider.toLowerCase() === "paystack") {
      return res.status(400).json({ success: false, message: "Paystack payments can only be updated via verify or signed Paystack webhooks" });
    }

    const existingEvent = await prisma.paymentWebhookEvent.findUnique({
      where: { providerEventId: body.eventId },
    });
    if (existingEvent) {
      return res.json({ success: true, data: { processed: false, duplicate: true }, message: "Webhook already processed" });
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.paymentWebhookEvent.create({
        data: {
          provider: body.provider,
          providerEventId: body.eventId,
          payload: (body.payload ?? req.body) as any,
        },
      });

      return applyPaymentStatus(tx, { paymentId: body.paymentId, status: body.status, provider: body.provider });
    });

    res.json({ success: true, data: result, message: "Webhook processed" });
  } catch (e) {
    next(e);
  }
});

export default router;
