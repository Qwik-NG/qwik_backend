import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { getPromotionPaymentAmountKobo, isPromotionPlan, VERIFICATION_PAYMENT_AMOUNT_KOBO } from "../../utils/paymentPricing";
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

function getCheckoutAmount(purpose: "VERIFICATION" | "AD_PROMOTION", plan?: string) {
  if (purpose === "VERIFICATION") return VERIFICATION_PAYMENT_AMOUNT_KOBO;
  if (isPromotionPlan(plan)) return getPromotionPaymentAmountKobo(plan);
  return null;
}

function paymentResponse(payment: {
  id: string;
  amount: number;
  currency: string;
  status: string;
  checkoutUrl: string | null;
}) {
  return {
    paymentId: payment.id,
    checkoutUrl: payment.checkoutUrl,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    providerReady: Boolean(payment.checkoutUrl),
  };
}

router.post("/checkout", requireAuth, async (req, res, next) => {
  try {
    const body = parseOrThrow(checkoutSchema, req.body);
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
        provider: "manual",
        metadata: { plan: body.plan ?? null },
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
      data: paymentResponse(payment),
      message: "Payment record created. Provider checkout is not configured yet.",
    });
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
    const body = parseOrThrow(webhookSchema, req.body);
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
  } catch (e) {
    next(e);
  }
});

export default router;
