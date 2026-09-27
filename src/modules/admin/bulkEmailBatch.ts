import { Resend } from "resend";
import { Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { buildBrandedEmailHtml } from "../../lib/emailBranding";
import { generateUnsubscribeUrls } from "../../lib/unsubscribeToken";

/**
 * Resend Batch API allows up to 100 individual emails per batch request.
 * Reference: https://resend.com/docs/api-reference/emails/send-batch-emails
 */
export const MAX_RESEND_BATCH_SIZE = 100;

/**
 * Formats a deterministic idempotency key for a given campaign chunk.
 * Ensures that retried requests (e.g., after network interruptions) do not
 * result in duplicate email sends by Resend.
 */
export function generateChunkIdempotencyKey(campaignId: string, chunkIndex: number): string {
  return `qwik_camp_${campaignId}_chk_${chunkIndex}`;
}

export interface BulkEmailBatchRecipient {
  id: string;
  email: string;
  fullName?: string | null;
}

export interface BulkEmailBatchPayload {
  campaignId: string;
  recipients: BulkEmailBatchRecipient[];
  subject: string;
  messageText: string;
  customHeaders?: Record<string, string>;
  subtitle?: string;
}

export interface BulkEmailBatchResult {
  campaignId: string;
  requestedCount: number;
  eligibleCount: number;
  sentCount: number;
  failedCount: number;
  status: "SENT" | "PARTIAL" | "FAILED";
  errors: Array<{ recipientId: string; email: string; error: string }>;
}

export interface BulkBatchSenderDeps {
  resendClient?: Resend | null;
  prismaClient?: typeof defaultPrisma | any;
  maxRetries?: number;
  initialBackoffMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Splits an array into chunks of a given maximum size.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("Chunk size must be greater than 0");
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Dispatches bulk emails using Resend's native Batch API (`resend.batch.send`).
 *
 * KEY GUARANTEES:
 * 1. Zero Recipient Exposure: Each email is dispatched with an isolated `to: recipient.email`.
 *    Shared `to:` grouping and `bcc:` lists are strictly avoided.
 * 2. Deterministic Idempotency: Each batch chunk passes a unique `idempotencyKey` to Resend.
 * 3. Provider Acceptance vs Delivery Distinction:
 *    A successful batch response (`HTTP 200` with email ID) indicates that Resend has accepted
 *    the message into its dispatch queue. It does NOT guarantee final inbox delivery, which
 *    is subject to downstream MTA acceptance, spam filters, and asynchronous bounce events.
 *    Logged status reflects provider submission (`SENT`), while errors reflect provider rejection.
 * 4. Rate-Limit Recovery: If Resend responds with HTTP 429, the chunk retries with exponential
 *    backoff rather than arbitrary unhandled failure.
 */
export async function executeBulkEmailBatch(
  payload: BulkEmailBatchPayload,
  deps: BulkBatchSenderDeps = {}
): Promise<BulkEmailBatchResult> {
  const prismaClient = deps.prismaClient ?? defaultPrisma;
  const resendClient = deps.resendClient !== undefined ? deps.resendClient : (env.resendApiKey ? new Resend(env.resendApiKey) : null);
  const maxRetries = deps.maxRetries ?? 2;
  const initialBackoffMs = deps.initialBackoffMs ?? 500;
  const sleep = deps.sleepFn ?? defaultSleep;

  const requestedCount = payload.recipients.length;
  const eligibleCount = payload.recipients.length;
  let sentCount = 0;
  let failedCount = 0;
  const collectedErrors: Array<{ recipientId: string; email: string; error: string }> = [];

  if (requestedCount === 0) {
    await prismaClient.emailCampaign.update({
      where: { id: payload.campaignId },
      data: {
        status: "FAILED",
        sentCount: 0,
        failedCount: 0,
      },
    });

    return {
      campaignId: payload.campaignId,
      requestedCount: 0,
      eligibleCount: 0,
      sentCount: 0,
      failedCount: 0,
      status: "FAILED",
      errors: [],
    };
  }

  if (!resendClient) {
    // If Resend is unconfigured in development/test, log recipients as skipped/failed
    const errorMessage = "Email provider (Resend) is not configured";
    await Promise.all(
      payload.recipients.map((r) =>
        prismaClient.emailRecipientLog.create({
          data: {
            campaignId: payload.campaignId,
            userId: r.id,
            email: r.email,
            status: "FAILED",
            error: errorMessage,
          },
        })
      )
    );

    await prismaClient.emailCampaign.update({
      where: { id: payload.campaignId },
      data: {
        status: "FAILED",
        sentCount: 0,
        failedCount: requestedCount,
      },
    });

    return {
      campaignId: payload.campaignId,
      requestedCount,
      eligibleCount,
      sentCount: 0,
      failedCount: requestedCount,
      status: "FAILED",
      errors: payload.recipients.map((r) => ({ recipientId: r.id, email: r.email, error: errorMessage })),
    };
  }

  // Sanitize subject (strip CRLF to prevent SMTP header injection)
  const safeSubject = payload.subject.replace(/[\r\n]+/g, " ").trim();

  // Sanitize message body (HTML-escape admin input)
  const safeMessageHtml = payload.messageText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const chunks = chunkArray(payload.recipients, MAX_RESEND_BATCH_SIZE);

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex];
    const idempotencyKey = generateChunkIdempotencyKey(payload.campaignId, chunkIndex);

    // Build the isolated individual email payloads for this batch
    const batchEmails = chunk.map((recipient) => {
      const urls = generateUnsubscribeUrls(recipient.id);

      const recipientHtml = buildBrandedEmailHtml(
        `
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Subject</p>
        <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#1f1f29">${safeSubject}</p>
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Message</p>
        <div style="background:#f8f8fa;border-radius:8px;padding:16px;font-size:15px;line-height:1.6;color:#3a3743;white-space:pre-wrap">${safeMessageHtml}</div>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #f0f0f2;font-size:12px;color:#9a99a6;line-height:1.5;">
          <p style="margin:0 0 6px;">You received this email because you are a registered user of Qwik.ng.</p>
          <p style="margin:0;">To unsubscribe from marketing deals, <a href="${urls.directUnsubscribeUrl}" style="color:#ff9715;text-decoration:underline;">click here</a>. You can also manage all notifications in your <a href="${urls.preferencesUrl}" style="color:#ff9715;text-decoration:underline;">account settings</a>.</p>
        </div>`,
        {
          preheader: safeSubject,
          subtitle: payload.subtitle || "Admin Communication",
        }
      );

      const recipientPlainText = `${safeSubject}\n\n${payload.messageText}\n\n---\nTo unsubscribe from marketing deals: ${urls.directUnsubscribeUrl}\nManage notification settings: ${urls.preferencesUrl}`;

      const headers: Record<string, string> = {
        "List-Unsubscribe": `<${urls.oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        ...(payload.customHeaders ?? {}),
      };

      return {
        from: env.resendFromEmail,
        to: recipient.email,
        subject: safeSubject,
        html: recipientHtml,
        text: recipientPlainText,
        headers,
      };
    });

    let batchResult: any = null;
    let chunkError: string | null = null;
    let attempts = 0;

    while (attempts <= maxRetries) {
      attempts++;
      try {
        batchResult = await resendClient.batch.send(batchEmails, { idempotencyKey });

        // If Resend returns an error response
        if (batchResult?.error) {
          const isRateLimit =
            batchResult.error.message?.includes("rate limit") ||
            batchResult.error.name === "rate_limit_exceeded" ||
            batchResult.error.statusCode === 429;

          if (isRateLimit && attempts <= maxRetries) {
            const backoff = initialBackoffMs * Math.pow(2, attempts - 1);
            await sleep(backoff);
            continue;
          }

          chunkError = batchResult.error.message || "Resend batch dispatch failed";
          break;
        }

        // Successfully received provider response
        chunkError = null;
        break;
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        const isRateLimit = errMessage.includes("429") || errMessage.includes("rate limit");

        if (isRateLimit && attempts <= maxRetries) {
          const backoff = initialBackoffMs * Math.pow(2, attempts - 1);
          await sleep(backoff);
          continue;
        }

        chunkError = errMessage;
        break;
      }
    }

    if (chunkError) {
      // Chunk-level failure: record all recipients in chunk as FAILED
      for (const recipient of chunk) {
        failedCount++;
        collectedErrors.push({
          recipientId: recipient.id,
          email: recipient.email,
          error: chunkError,
        });

        await prismaClient.emailRecipientLog.create({
          data: {
            campaignId: payload.campaignId,
            userId: recipient.id,
            email: recipient.email,
            status: "FAILED",
            error: chunkError,
          },
        });
      }
    } else {
      // Chunk-level success: check if individual items in data have status
      const responseData = batchResult?.data;
      const isArrayResponse = Array.isArray(responseData);

      for (let i = 0; i < chunk.length; i++) {
        const recipient = chunk[i];
        const itemResult = isArrayResponse ? responseData[i] : null;

        // If itemResult exists and has an error property (permissive mode), mark FAILED; otherwise SENT
        if (itemResult && (itemResult as any).error) {
          failedCount++;
          const itemError = (itemResult as any).error?.message || "Recipient send failed";
          collectedErrors.push({
            recipientId: recipient.id,
            email: recipient.email,
            error: itemError,
          });

          await prismaClient.emailRecipientLog.create({
            data: {
              campaignId: payload.campaignId,
              userId: recipient.id,
              email: recipient.email,
              status: "FAILED",
              error: itemError,
            },
          });
        } else {
          // Provider acceptance confirmed
          sentCount++;
          await prismaClient.emailRecipientLog.create({
            data: {
              campaignId: payload.campaignId,
              userId: recipient.id,
              email: recipient.email,
              status: "SENT",
            },
          });
        }
      }
    }
  }

  const finalStatus =
    sentCount > 0 && failedCount === 0 ? "SENT" : sentCount > 0 ? "PARTIAL" : "FAILED";

  await prismaClient.emailCampaign.update({
    where: { id: payload.campaignId },
    data: {
      status: finalStatus,
      sentCount,
      failedCount,
    },
  });

  return {
    campaignId: payload.campaignId,
    requestedCount,
    eligibleCount,
    sentCount,
    failedCount,
    status: finalStatus,
    errors: collectedErrors,
  };
}
