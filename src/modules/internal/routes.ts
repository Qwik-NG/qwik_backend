import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { processPendingEmailOutboxJobs } from "../../lib/engagementWorker";
import { parseOrThrow } from "../../utils/validation";

const router = Router();

const processOutboxSchema = z.object({
  batchSize: z.number().int().min(1).max(200).optional(),
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

export default router;
