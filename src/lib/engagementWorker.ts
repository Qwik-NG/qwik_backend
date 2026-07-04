import {
  type EmailOutboxJob,
  type EmailOutboxStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { sendEmailWithResend } from "./emailDelivery";

export type EngagementWorkerClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type ProcessOutboxOptions = {
  batchSize?: number;
  now?: Date;
  workerId?: string;
};

export type ProcessOutboxSummary = {
  fetched: number;
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  dryRun: number;
};

function nextBackoffDate(attemptCount: number, now: Date) {
  const baseSeconds = env.engagementEmailBackoffBaseSeconds;
  const multiplier = Math.max(1, 2 ** Math.max(0, attemptCount - 1));
  const delayMs = baseSeconds * multiplier * 1000;
  return new Date(now.getTime() + delayMs);
}

function toProcessingCandidateStatus(job: EmailOutboxJob): EmailOutboxStatus {
  if (job.status === "PENDING" || job.status === "RETRY") return "PROCESSING";
  return job.status;
}

async function lockJobs(client: EngagementWorkerClient, now: Date, batchSize: number, workerId: string) {
  const candidates = await client.emailOutboxJob.findMany({
    where: {
      status: { in: ["PENDING", "RETRY"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      availableAt: { lte: now },
      lockedAt: null,
    },
    orderBy: [{ createdAt: "asc" }],
    take: batchSize,
  });

  const locked: EmailOutboxJob[] = [];

  for (const candidate of candidates) {
    const updated = await client.emailOutboxJob.updateMany({
      where: {
        id: candidate.id,
        lockedAt: null,
        status: { in: ["PENDING", "RETRY"] },
      },
      data: {
        status: toProcessingCandidateStatus(candidate),
        lockedAt: now,
        lockedBy: workerId,
      },
    });

    if (updated.count > 0) {
      const lockedRecord = await client.emailOutboxJob.findUnique({ where: { id: candidate.id } });
      if (lockedRecord) locked.push(lockedRecord);
    }
  }

  return locked;
}

async function logAttempt(
  client: EngagementWorkerClient,
  outboxJobId: string,
  attemptNumber: number,
  status: "SENT" | "FAILED" | "SKIPPED" | "DRY_RUN",
  details?: { providerMessageId?: string | null; error?: string | null; responsePayload?: Prisma.JsonValue },
) {
  await client.emailDeliveryAttempt.create({
    data: {
      outboxJobId,
      attemptNumber,
      status,
      providerMessageId: details?.providerMessageId ?? null,
      error: details?.error ?? null,
      responsePayload: details?.responsePayload,
    },
  });
}

async function processSingleJob(client: EngagementWorkerClient, job: EmailOutboxJob, now: Date): Promise<"SENT" | "FAILED" | "SKIPPED" | "DRY_RUN"> {
  const attemptNumber = job.attemptCount + 1;

  if (!job.recipientEmail || (!job.htmlBody && !job.textBody)) {
    await logAttempt(client, job.id, attemptNumber, "SKIPPED", {
      error: !job.recipientEmail ? "Recipient email is missing" : "Email body is missing",
    });

    await client.emailOutboxJob.update({
      where: { id: job.id },
      data: {
        attemptCount: attemptNumber,
        status: "FAILED",
        lastError: !job.recipientEmail ? "Recipient email is missing" : "Email body is missing",
        lockedAt: null,
        lockedBy: null,
      },
    });

    return "SKIPPED";
  }

  const result = await sendEmailWithResend({
    to: job.recipientEmail,
    subject: job.subject,
    html: job.htmlBody,
    text: job.textBody,
  });

  if (result.dryRun) {
    await logAttempt(client, job.id, attemptNumber, "DRY_RUN");
    await client.emailOutboxJob.update({
      where: { id: job.id },
      data: {
        attemptCount: attemptNumber,
        status: "PENDING",
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
      },
    });
    return "DRY_RUN";
  }

  if (result.sent) {
    await logAttempt(client, job.id, attemptNumber, "SENT", {
      providerMessageId: result.providerMessageId,
      responsePayload: result.responsePayload as Prisma.JsonValue,
    });

    await client.emailOutboxJob.update({
      where: { id: job.id },
      data: {
        attemptCount: attemptNumber,
        status: "SENT",
        providerMessageId: result.providerMessageId,
        sentAt: now,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
      },
    });
    return "SENT";
  }

  const exhausted = attemptNumber >= job.maxAttempts;
  const nextAttemptAt = exhausted ? null : nextBackoffDate(attemptNumber, now);

  await logAttempt(client, job.id, attemptNumber, "FAILED", {
    error: result.errorMessage,
    responsePayload: result.responsePayload as Prisma.JsonValue,
  });

  await client.emailOutboxJob.update({
    where: { id: job.id },
    data: {
      attemptCount: attemptNumber,
      status: exhausted ? "FAILED" : "RETRY",
      nextAttemptAt,
      lastError: result.errorMessage,
      lockedAt: null,
      lockedBy: null,
    },
  });

  return "FAILED";
}

export async function processPendingEmailOutboxJobs(
  options: ProcessOutboxOptions = {},
  client: EngagementWorkerClient = prisma,
): Promise<ProcessOutboxSummary> {
  const now = options.now ?? new Date();
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 20, 200));
  const workerId = options.workerId ?? "engagement-worker";

  const lockedJobs = await lockJobs(client, now, batchSize, workerId);

  const summary: ProcessOutboxSummary = {
    fetched: lockedJobs.length,
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    dryRun: 0,
  };

  for (const job of lockedJobs) {
    const outcome = await processSingleJob(client, job, now);
    summary.processed += 1;
    if (outcome === "SENT") summary.sent += 1;
    if (outcome === "FAILED") summary.failed += 1;
    if (outcome === "SKIPPED") summary.skipped += 1;
    if (outcome === "DRY_RUN") summary.dryRun += 1;
  }

  return summary;
}

// TODO(Phase 3): expose protected admin-only endpoint for on-demand outbox processing if needed.
// TODO(Phase 3): wire scheduled trigger (Render scheduled job) to enqueue report jobs, not direct send.
