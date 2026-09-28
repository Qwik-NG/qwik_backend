import { describe, it, expect, vi } from "vitest";
import {
  generateChunkIdempotencyKey,
  chunkArray,
  executeBulkEmailBatch,
  MAX_RESEND_BATCH_SIZE,
  BulkEmailBatchRecipient,
} from "../modules/admin/bulkEmailBatch";

function createMockPrisma() {
  const createdLogs: any[] = [];
  let updatedCampaign: any = null;

  return {
    emailRecipientLog: {
      create: vi.fn(async ({ data }: { data: any }) => {
        createdLogs.push(data);
        return { id: `log_${createdLogs.length}`, ...data, createdAt: new Date() };
      }),
    },
    emailCampaign: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        updatedCampaign = { id: where.id, ...data };
        return updatedCampaign;
      }),
    },
    getCreatedLogs: () => createdLogs,
    getUpdatedCampaign: () => updatedCampaign,
  };
}

describe("bulkEmailBatch Resend batch integration", () => {
  describe("idempotency key generation & chunking", () => {
    it("generates deterministic chunk idempotency keys", () => {
      const key0 = generateChunkIdempotencyKey("camp_123", 0);
      const key1 = generateChunkIdempotencyKey("camp_123", 1);
      const key99 = generateChunkIdempotencyKey("camp_abc", 99);

      expect(key0).toBe("qwik_camp_camp_123_chk_0");
      expect(key1).toBe("qwik_camp_camp_123_chk_1");
      expect(key99).toBe("qwik_camp_camp_abc_chk_99");
    });

    it("chunks array accurately into slices of at most MAX_RESEND_BATCH_SIZE (100)", () => {
      expect(MAX_RESEND_BATCH_SIZE).toBe(100);

      // Empty
      expect(chunkArray([], 100)).toEqual([]);

      // Smaller than batch size
      const small = Array.from({ length: 45 }, (_, i) => i);
      const smallChunks = chunkArray(small, 100);
      expect(smallChunks.length).toBe(1);
      expect(smallChunks[0].length).toBe(45);

      // Exactly 100
      const exact = Array.from({ length: 100 }, (_, i) => i);
      const exactChunks = chunkArray(exact, 100);
      expect(exactChunks.length).toBe(1);
      expect(exactChunks[0].length).toBe(100);

      // 215 items -> 3 chunks (100, 100, 15)
      const large = Array.from({ length: 215 }, (_, i) => i);
      const largeChunks = chunkArray(large, 100);
      expect(largeChunks.length).toBe(3);
      expect(largeChunks[0].length).toBe(100);
      expect(largeChunks[1].length).toBe(100);
      expect(largeChunks[2].length).toBe(15);
    });

    it("throws when chunk size is zero or negative", () => {
      expect(() => chunkArray([1, 2], 0)).toThrow();
      expect(() => chunkArray([1, 2], -5)).toThrow();
    });
  });

  describe("executeBulkEmailBatch", () => {
    const sampleRecipients: BulkEmailBatchRecipient[] = [
      { id: "usr_1", email: "alice@example.com", fullName: "Alice" },
      { id: "usr_2", email: "bob@example.com", fullName: "Bob" },
    ];

    it("handles empty recipient list by updating campaign to FAILED", async () => {
      const mockPrisma = createMockPrisma();
      const mockResend = {
        batch: { send: vi.fn() },
      };

      const result = await executeBulkEmailBatch(
        {
          campaignId: "camp_empty",
          recipients: [],
          subject: "Empty",
          messageText: "No recipients",
        },
        {
          prismaClient: mockPrisma,
          resendClient: mockResend as any,
        }
      );

      expect(result.status).toBe("FAILED");
      expect(result.sentCount).toBe(0);
      expect(mockResend.batch.send).not.toHaveBeenCalled();
      expect(mockPrisma.getUpdatedCampaign().status).toBe("FAILED");
    });

    it("handles unconfigured Resend by failing all recipients gracefully without throwing", async () => {
      const mockPrisma = createMockPrisma();

      const result = await executeBulkEmailBatch(
        {
          campaignId: "camp_no_resend",
          recipients: sampleRecipients,
          subject: "Notice",
          messageText: "System message",
        },
        {
          prismaClient: mockPrisma,
          resendClient: null,
        }
      );

      expect(result.status).toBe("FAILED");
      expect(result.failedCount).toBe(2);
      expect(result.sentCount).toBe(0);
      expect(mockPrisma.getCreatedLogs().length).toBe(2);
      expect(mockPrisma.getCreatedLogs()[0].status).toBe("FAILED");
      expect(mockPrisma.getUpdatedCampaign().status).toBe("FAILED");
    });

    it("dispatches a single batch for recipients <= 100 with isolated recipient email payloads", async () => {
      const mockPrisma = createMockPrisma();
      const mockSend = vi.fn(async (emails: any[], options: any) => {
        return {
          data: emails.map((_, i) => ({ id: `msg_resend_${i}` })),
          error: null,
        };
      });

      const mockResend = {
        batch: { send: mockSend },
      };

      const result = await executeBulkEmailBatch(
        {
          campaignId: "camp_single_batch",
          recipients: sampleRecipients,
          subject: "Exclusive Marketplace Update",
          messageText: "Hello Qwik users!",
          subtitle: "Qwik Deals",
        },
        {
          prismaClient: mockPrisma,
          resendClient: mockResend as any,
        }
      );

      expect(result.status).toBe("SENT");
      expect(result.sentCount).toBe(2);
      expect(result.failedCount).toBe(0);

      // Verify Resend was called once with idempotency key
      expect(mockSend).toHaveBeenCalledTimes(1);
      const [calledEmails, calledOptions] = mockSend.mock.calls[0];
      expect(calledOptions.idempotencyKey).toBe("qwik_camp_camp_single_batch_chk_0");

      // Verify zero recipient exposure: each email in the batch has its own single `to` string
      expect(calledEmails.length).toBe(2);
      expect(calledEmails[0].to).toBe("alice@example.com");
      expect(calledEmails[1].to).toBe("bob@example.com");

      // Verify recipient logs and campaign updates
      const logs = mockPrisma.getCreatedLogs();
      expect(logs.length).toBe(2);
      expect(logs[0].status).toBe("SENT");
      expect(logs[0].userId).toBe("usr_1");
      expect(logs[1].status).toBe("SENT");
      expect(logs[1].userId).toBe("usr_2");

      expect(mockPrisma.getUpdatedCampaign()).toEqual({
        id: "camp_single_batch",
        status: "SENT",
        sentCount: 2,
        failedCount: 0,
      });
    });

    it("dispatches multiple batch chunks for recipients > 100 with separate idempotency keys", async () => {
      const mockPrisma = createMockPrisma();
      // Generate 125 recipients
      const recipients125: BulkEmailBatchRecipient[] = Array.from({ length: 125 }, (_, i) => ({
        id: `usr_${i}`,
        email: `user${i}@example.com`,
        fullName: `User ${i}`,
      }));

      const mockSend = vi.fn(async (emails: any[], options: any) => {
        return {
          data: emails.map((_, i) => ({ id: `msg_${i}` })),
          error: null,
        };
      });

      const mockResend = {
        batch: { send: mockSend },
      };

      const result = await executeBulkEmailBatch(
        {
          campaignId: "camp_multi_chunk",
          recipients: recipients125,
          subject: "Large Broadcast",
          messageText: "Announcement to all sellers",
        },
        {
          prismaClient: mockPrisma,
          resendClient: mockResend as any,
        }
      );

      expect(result.status).toBe("SENT");
      expect(result.sentCount).toBe(125);
      expect(result.failedCount).toBe(0);

      // Verify 2 batch requests were made
      expect(mockSend).toHaveBeenCalledTimes(2);

      // Chunk 0: 100 emails
      expect(mockSend.mock.calls[0]?.[0]?.length).toBe(100);
      expect(mockSend.mock.calls[0]?.[1]?.idempotencyKey).toBe("qwik_camp_camp_multi_chunk_chk_0");

      // Chunk 1: 25 emails
      expect(mockSend.mock.calls[1]?.[0]?.length).toBe(25);
      expect(mockSend.mock.calls[1]?.[1]?.idempotencyKey).toBe("qwik_camp_camp_multi_chunk_chk_1");

      expect(mockPrisma.getCreatedLogs().length).toBe(125);
      expect(mockPrisma.getUpdatedCampaign().status).toBe("SENT");
      expect(mockPrisma.getUpdatedCampaign().sentCount).toBe(125);
    });

    it("handles partial chunk failure by setting status to PARTIAL and recording accurate counts", async () => {
      const mockPrisma = createMockPrisma();
      // 120 recipients -> chunk 0 has 100, chunk 1 has 20
      const recipients120: BulkEmailBatchRecipient[] = Array.from({ length: 120 }, (_, i) => ({
        id: `usr_${i}`,
        email: `user${i}@example.com`,
      }));

      let callCount = 0;
      const mockSend = vi.fn(async (emails: any[]) => {
        callCount++;
        if (callCount === 1) {
          // Chunk 0 succeeds
          return {
            data: emails.map((_, i) => ({ id: `msg_${i}` })),
            error: null,
          };
        }
        // Chunk 1 fails
        return {
          data: null,
          error: { message: "Internal mail delivery error on provider", statusCode: 500 },
        };
      });

      const mockResend = {
        batch: { send: mockSend },
      };

      const result = await executeBulkEmailBatch(
        {
          campaignId: "camp_partial",
          recipients: recipients120,
          subject: "Partial Test",
          messageText: "Body",
        },
        {
          prismaClient: mockPrisma,
          resendClient: mockResend as any,
          maxRetries: 0,
        }
      );

      expect(result.status).toBe("PARTIAL");
      expect(result.sentCount).toBe(100);
      expect(result.failedCount).toBe(20);
      expect(result.errors.length).toBe(20);

      const logs = mockPrisma.getCreatedLogs();
      expect(logs.length).toBe(120);
      const sentLogs = logs.filter((l) => l.status === "SENT");
      const failedLogs = logs.filter((l) => l.status === "FAILED");
      expect(sentLogs.length).toBe(100);
      expect(failedLogs.length).toBe(20);

      expect(mockPrisma.getUpdatedCampaign().status).toBe("PARTIAL");
    });

    it("retries on HTTP 429 rate limit with exponential backoff and succeeds on retry", async () => {
      const mockPrisma = createMockPrisma();
      const mockSleep = vi.fn(async () => {});

      let callCount = 0;
      const mockSend = vi.fn(async (emails: any[]) => {
        callCount++;
        if (callCount === 1) {
          // First attempt triggers rate limit
          return {
            data: null,
            error: { statusCode: 429, message: "rate_limit_exceeded: too many requests" },
          };
        }
        // Second attempt succeeds
        return {
          data: emails.map((_, i) => ({ id: `msg_${i}` })),
          error: null,
        };
      });

      const mockResend = {
        batch: { send: mockSend },
      };

      const result = await executeBulkEmailBatch(
        {
          campaignId: "camp_rate_limit_retry",
          recipients: sampleRecipients,
          subject: "Notice",
          messageText: "Content",
        },
        {
          prismaClient: mockPrisma,
          resendClient: mockResend as any,
          maxRetries: 2,
          initialBackoffMs: 100,
          sleepFn: mockSleep,
        }
      );

      expect(result.status).toBe("SENT");
      expect(result.sentCount).toBe(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSleep).toHaveBeenCalledWith(100);
      expect(mockPrisma.getUpdatedCampaign().status).toBe("SENT");
    });

    it("sanitizes subject CRLF and HTML-escapes message body", async () => {
      const mockPrisma = createMockPrisma();
      let capturedPayload: any = null;

      const mockSend = vi.fn(async (emails: any[]) => {
        capturedPayload = emails;
        return {
          data: emails.map(() => ({ id: "msg_1" })),
          error: null,
        };
      });

      const mockResend = {
        batch: { send: mockSend },
      };

      await executeBulkEmailBatch(
        {
          campaignId: "camp_sanitize",
          recipients: [sampleRecipients[0]],
          subject: "Injected\r\nSubject\nHeader",
          messageText: "<script>alert('xss')</script> Hello",
        },
        {
          prismaClient: mockPrisma,
          resendClient: mockResend as any,
        }
      );

      expect(capturedPayload).not.toBeNull();
      // CRLF replaced with space
      expect(capturedPayload[0].subject).toBe("Injected Subject Header");
      // HTML escaped in email html body
      expect(capturedPayload[0].html).toContain("&lt;script&gt;alert('xss')&lt;/script&gt; Hello");
      expect(capturedPayload[0].html).not.toContain("<script>");
      expect(capturedPayload[0].html).not.toContain("Admin Communication");
    });
  });
});
