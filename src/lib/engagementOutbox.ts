import {
  type EngagementEventType,
  type EmailOutboxJob,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "./prisma";
import { buildEngagementFingerprint } from "./engagementFingerprint";

export type EngagementOutboxClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type QueueEngagementEmailInput = {
  eventType: EngagementEventType;
  recipientId: string;
  recipientEmail: string;
  subject: string;
  htmlBody?: string | null;
  textBody?: string | null;
  actionUrl?: string | null;
  payload?: Prisma.JsonValue;
  idempotencyKey: string;
  maxAttempts?: number;
  availableAt?: Date;
};

export type QueueEngagementEmailResult = {
  job: EmailOutboxJob;
  duplicate: boolean;
};

export async function queueEngagementEmail(
  input: QueueEngagementEmailInput,
  client: EngagementOutboxClient = prisma,
): Promise<QueueEngagementEmailResult> {
  const fingerprint = buildEngagementFingerprint({
    eventType: input.eventType,
    recipientId: input.recipientId,
    idempotencyKey: input.idempotencyKey,
  });

  const existingJob = await client.emailOutboxJob.findUnique({
    where: { fingerprint },
  });

  if (existingJob) {
    return { job: existingJob, duplicate: true };
  }

  let fingerprintRecord = await client.notificationEventFingerprint.findUnique({
    where: { fingerprint },
  });

  if (!fingerprintRecord) {
    fingerprintRecord = await client.notificationEventFingerprint.create({
      data: {
        fingerprint,
        eventType: input.eventType,
        recipientId: input.recipientId,
        payload: input.payload,
      },
    });
  }

  const job = await client.emailOutboxJob.create({
    data: {
      eventType: input.eventType,
      recipientId: input.recipientId,
      recipientEmail: input.recipientEmail,
      subject: input.subject,
      htmlBody: input.htmlBody ?? null,
      textBody: input.textBody ?? null,
      actionUrl: input.actionUrl ?? null,
      payload: input.payload,
      fingerprint,
      notificationEventFingerprintId: fingerprintRecord.id,
      ...(typeof input.maxAttempts === "number" ? { maxAttempts: input.maxAttempts } : {}),
      ...(input.availableAt ? { availableAt: input.availableAt } : {}),
    },
  });

  return { job, duplicate: false };
}

export type QueuePhaseHookInput = {
  recipientId: string;
  recipientEmail: string;
  idempotencyKey: string;
  subject: string;
  htmlBody?: string | null;
  textBody?: string | null;
  actionUrl?: string | null;
  payload?: Prisma.JsonValue;
};

// TODO(Phase 1): call this from new-message event source
export async function queueNewMessageEmail(input: QueuePhaseHookInput, client: EngagementOutboxClient = prisma) {
  return queueEngagementEmail({ ...input, eventType: "NEW_MESSAGE" }, client);
}

// TODO(Phase 2): call this from new-offer event source
export async function queueNewOfferEmail(input: QueuePhaseHookInput, client: EngagementOutboxClient = prisma) {
  return queueEngagementEmail({ ...input, eventType: "NEW_OFFER" }, client);
}

// TODO(Phase 3): call this from report generation flow
export async function queueAdPerformanceReportEmail(input: QueuePhaseHookInput, client: EngagementOutboxClient = prisma) {
  return queueEngagementEmail({ ...input, eventType: "AD_PERFORMANCE_REPORT" }, client);
}
