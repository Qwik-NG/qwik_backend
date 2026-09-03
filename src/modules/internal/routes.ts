import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { processPendingEmailOutboxJobs } from "../../lib/engagementWorker";
import { enqueueAdPerformanceReports } from "../../lib/adPerformanceReports";
import { runMonthlySettlement } from "../referrals/settlement";
import { parseOrThrow } from "../../utils/validation";

const router = Router();

const processOutboxSchema = z.object({
  batchSize: z.number().int().min(1).max(200).optional(),
});

const enqueueAdPerformanceReportsSchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  sellerIds: z.array(z.string().min(1)).max(500).optional(),
}).refine((value) => Boolean(value.periodStart) === Boolean(value.periodEnd), {
  message: "periodStart and periodEnd must be provided together",
  path: ["periodEnd"],
});

const runMonthlySettlementSchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
}).refine((value) => Boolean(value.periodStart) === Boolean(value.periodEnd), {
  message: "periodStart and periodEnd must be provided together",
  path: ["periodEnd"],
});

function isInternalAuthorized(headers: Record<string, unknown>) {
  const expectedBearer = `Bearer ${env.webhookSecret}`;
  const authHeader = typeof headers.authorization === "string" ? headers.authorization : "";

  if (authHeader === expectedBearer) return true;

  const webhookSecretHeader = headers["x-webhook-secret"];
  if (typeof webhookSecretHeader === "string" && webhookSecretHeader === env.webhookSecret) {
    return true;
  }

  if (Array.isArray(webhookSecretHeader) && webhookSecretHeader.some((value) => value === env.webhookSecret)) {
    return true;
  }

  return false;
}

router.post("/engagement/process-outbox", async (req, res, next) => {
  try {
    if (!isInternalAuthorized(req.headers as Record<string, unknown>)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = parseOrThrow(processOutboxSchema, req.body ?? {});
    const workerId = `internal-endpoint:${Date.now()}`;
    const batchSize = body.batchSize ?? 20;

    console.info("[engagement-outbox] Manual processing started", {
      workerId,
      batchSize,
      enabled: env.engagementEmailsEnabled,
      dryRun: env.engagementEmailDryRun,
    });

    const summary = await processPendingEmailOutboxJobs({
      batchSize,
      workerId,
    });

    console.info("[engagement-outbox] Manual processing completed", {
      workerId,
      summary,
    });

    return res.json({
      success: true,
      data: {
        workerId,
        summary,
      },
      message: "Outbox processing completed",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/engagement/enqueue-ad-performance-reports", async (req, res, next) => {
  const startedAt = Date.now();

  try {
    if (!isInternalAuthorized(req.headers as Record<string, unknown>)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = parseOrThrow(enqueueAdPerformanceReportsSchema, req.body ?? {});

    const periodStart = body.periodStart ? new Date(body.periodStart) : undefined;
    const periodEnd = body.periodEnd ? new Date(body.periodEnd) : undefined;

    if (periodStart && periodEnd && !(periodStart < periodEnd)) {
      return res.status(400).json({ success: false, message: "periodStart must be earlier than periodEnd" });
    }

    const summary = await enqueueAdPerformanceReports({
      periodStart,
      periodEnd,
      sellerIds: body.sellerIds,
    });

    const durationMs = Date.now() - startedAt;

    return res.json({
      success: true,
      data: {
        ...summary,
        durationMs,
      },
      message: "Ad performance report jobs enqueued",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/referrals/run-monthly-settlement", async (req, res, next) => {
  try {
    if (!isInternalAuthorized(req.headers as Record<string, unknown>)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = parseOrThrow(runMonthlySettlementSchema, req.body ?? {});
    const periodStart = body.periodStart ? new Date(body.periodStart) : undefined;
    const periodEnd = body.periodEnd ? new Date(body.periodEnd) : undefined;

    if (periodStart && periodEnd && !(periodStart < periodEnd)) {
      return res.status(400).json({ success: false, message: "periodStart must be earlier than periodEnd" });
    }

    const workerId = `internal-endpoint:${Date.now()}`;
    const summary = await runMonthlySettlement({ periodStart, periodEnd, workerId });

    return res.json({ success: true, data: summary, message: "Monthly settlement processed" });
  } catch (error) {
    next(error);
  }
});

export default router;
