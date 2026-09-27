import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import jwt from "jsonwebtoken";
import { app } from "../app";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { _resetBulkEmailLocksForTesting } from "../modules/admin/routes";
import { UserRole, UserStatus, AdStatus } from "@prisma/client";

describe("Phase 4: Admin Communications Security & Endpoints", () => {
  let server: http.Server;
  let baseUrl: string;

  const adminId = "admin_sec_test_001";
  const nonAdminId = "user_sec_test_002";
  const bannedAdminId = "admin_banned_003";

  const adminToken = jwt.sign({ userId: adminId, email: "admin@qwik.ng" }, env.jwtSecret);
  const nonAdminToken = jwt.sign({ userId: nonAdminId, email: "regular@qwik.ng" }, env.jwtSecret);
  const bannedAdminToken = jwt.sign({ userId: bannedAdminId, email: "bannedadmin@qwik.ng" }, env.jwtSecret);

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    _resetBulkEmailLocksForTesting();
    vi.restoreAllMocks();
  });

  function setupAdminAuthMocks() {
    vi.spyOn(prisma.user, "findUnique").mockImplementation(async ({ where }: any) => {
      if (where.id === adminId) {
        return {
          id: adminId,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          email: "admin@qwik.ng",
          fullName: "Admin Officer",
        } as any;
      }
      if (where.id === nonAdminId) {
        return {
          id: nonAdminId,
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
          email: "regular@qwik.ng",
          fullName: "Regular User",
        } as any;
      }
      if (where.id === bannedAdminId) {
        return {
          id: bannedAdminId,
          role: UserRole.ADMIN,
          status: UserStatus.BANNED,
          email: "bannedadmin@qwik.ng",
          fullName: "Banned Admin",
        } as any;
      }
      return null;
    });
  }

  describe("Authentication & Authorization Guards", () => {
    it("returns 401 Unauthorized for unauthenticated requests", async () => {
      const countRes = await fetch(`${baseUrl}/api/admin/communications/recipient-count?segment=ACTIVE_SELLERS`);
      expect(countRes.status).toBe(401);

      const sendRes = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "Test Broadcast",
          message: "Broadcast content",
        }),
      });
      expect(sendRes.status).toBe(401);
    });

    it("returns 403 Forbidden for non-admin users", async () => {
      setupAdminAuthMocks();

      const countRes = await fetch(`${baseUrl}/api/admin/communications/recipient-count?segment=ACTIVE_SELLERS`, {
        headers: { Authorization: `Bearer ${nonAdminToken}` },
      });
      expect(countRes.status).toBe(403);
      const countBody = (await countRes.json()) as any;
      expect(countBody.message).toContain("Admin access required");

      const sendRes = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${nonAdminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "Test Broadcast",
          message: "Broadcast content",
        }),
      });
      expect(sendRes.status).toBe(403);
    });

    it("returns 403 Forbidden for banned admin users", async () => {
      setupAdminAuthMocks();

      const countRes = await fetch(`${baseUrl}/api/admin/communications/recipient-count?segment=ACTIVE_SELLERS`, {
        headers: { Authorization: `Bearer ${bannedAdminToken}` },
      });
      expect(countRes.status).toBe(403);
      const countBody = (await countRes.json()) as any;
      expect(countBody.message).toContain("Admin access required");
    });
  });

  describe("Recipient Count Endpoint (GET /api/admin/communications/recipient-count)", () => {
    it("returns 400 when segment parameter is missing or invalid", async () => {
      setupAdminAuthMocks();

      const missingRes = await fetch(`${baseUrl}/api/admin/communications/recipient-count`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(missingRes.status).toBe(400);

      const invalidRes = await fetch(`${baseUrl}/api/admin/communications/recipient-count?segment=INVALID_SEGMENT`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(invalidRes.status).toBe(400);
      const body = (await invalidRes.json()) as any;
      expect(body.message).toContain("Invalid segment");
    });

    it("returns eligible recipient count and breakdown for ACTIVE_SELLERS", async () => {
      setupAdminAuthMocks();

      const countSpy = vi.spyOn(prisma.user, "count").mockImplementation(async (args?: any) => {
        if (args?.where?.ads?.some) return 42; // eligible active sellers
        if (args?.where?.bannedAt) return 5; // banned count
        if (args?.where?.emailVerifiedAt === null) return 8; // unverified email
        if (args?.where?.notificationSettings?.emailNotifications === false) return 12; // opted out
        if (args?.where?.ads?.none) return 20; // no active ads
        return 100; // total users
      });

      const res = await fetch(`${baseUrl}/api/admin/communications/recipient-count?segment=ACTIVE_SELLERS`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.segment).toBe("ACTIVE_SELLERS");
      expect(body.data.eligibleCount).toBe(42);
      expect(body.data.breakdown).toBeDefined();
      expect(body.data.breakdown.totalUsers).toBe(100);
      expect(body.data.breakdown.banned).toBe(5);
      expect(body.data.breakdown.unverifiedEmail).toBe(8);
      expect(body.data.breakdown.optedOut).toBe(12);
      expect(body.data.breakdown.noActiveAds).toBe(20);
      expect(body.data.timestamp).toBeDefined();

      countSpy.mockRestore();
    });

    it("returns eligible recipient count and breakdown for ALL_ACTIVE_USERS", async () => {
      setupAdminAuthMocks();

      const countSpy = vi.spyOn(prisma.user, "count").mockImplementation(async (args?: any) => {
        if (args?.where?.bannedAt === null && args?.where?.emailVerifiedAt && !args?.where?.ads) return 75; // eligible all active
        if (args?.where?.bannedAt) return 5;
        if (args?.where?.emailVerifiedAt === null) return 8;
        if (args?.where?.notificationSettings?.emailNotifications === false) return 12;
        return 100;
      });

      const res = await fetch(`${baseUrl}/api/admin/communications/recipient-count?segment=ALL_ACTIVE_USERS`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.segment).toBe("ALL_ACTIVE_USERS");
      expect(body.data.eligibleCount).toBe(75);
      expect(body.data.breakdown.noActiveAds).toBeUndefined(); // only for active sellers

      countSpy.mockRestore();
    });
  });

  describe("Bulk Send Validation & Sanitization (POST /api/admin/communications/send-bulk-email)", () => {
    it("returns 400 for missing or invalid parameters", async () => {
      setupAdminAuthMocks();

      // Missing segment
      const res1 = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ subject: "Hi", message: "Hello" }),
      });
      expect(res1.status).toBe(400);

      // Subject too long (> 120 chars)
      const res2 = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "A".repeat(121),
          message: "Hello",
        }),
      });
      expect(res2.status).toBe(400);

      // Empty message
      const res3 = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "Valid Subject",
          message: "   ",
        }),
      });
      expect(res3.status).toBe(400);

      // Message too long (> 5000 chars)
      const res4 = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "Valid Subject",
          message: "A".repeat(5001),
        }),
      });
      expect(res4.status).toBe(400);
    });

    it("returns 400 when no eligible recipients exist for the segment", async () => {
      setupAdminAuthMocks();

      vi.spyOn(prisma.user, "findMany").mockResolvedValueOnce([]); // 0 eligible recipients

      const res = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "Broadcast with no recipients",
          message: "Content goes here",
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.message).toContain("No eligible recipients found");
    });

    it("sanitizes CRLF header injection from subject line", async () => {
      setupAdminAuthMocks();

      vi.spyOn(prisma.user, "findMany").mockResolvedValueOnce([
        { id: "usr_1", email: "seller1@example.com", fullName: "Seller One" },
      ] as any);

      let createdCampaignSubject = "";
      vi.spyOn(prisma.emailCampaign, "create").mockImplementationOnce(async ({ data }: any) => {
        createdCampaignSubject = data.subject;
        return {
          id: "camp_crlf_1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      vi.spyOn(prisma.emailCampaign, "update").mockResolvedValue({} as any);
      vi.spyOn(prisma.emailRecipientLog, "create").mockResolvedValue({} as any);
      vi.spyOn(prisma.adminAuditLog, "create").mockResolvedValue({} as any);

      const maliciousSubject = "Important Update\r\nBcc: victim@target.com\r\nX-Spam: High";
      const res = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: maliciousSubject,
          message: "Regular message content",
        }),
      });

      expect(res.status).toBe(200);
      // Stripped CRLF replaced with space
      expect(createdCampaignSubject).not.toContain("\r");
      expect(createdCampaignSubject).not.toContain("\n");
      expect(createdCampaignSubject).toBe("Important Update Bcc: victim@target.com X-Spam: High");
    });

    it("escapes raw HTML tags in message content (< and >)", async () => {
      setupAdminAuthMocks();

      vi.spyOn(prisma.user, "findMany").mockResolvedValueOnce([
        { id: "usr_1", email: "seller1@example.com", fullName: "Seller One" },
      ] as any);

      let createdCampaignSnippet = "";
      vi.spyOn(prisma.emailCampaign, "create").mockImplementationOnce(async ({ data }: any) => {
        createdCampaignSnippet = data.messageSnippet;
        return {
          id: "camp_html_1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      vi.spyOn(prisma.emailCampaign, "update").mockResolvedValue({} as any);
      vi.spyOn(prisma.emailRecipientLog, "create").mockResolvedValue({} as any);
      vi.spyOn(prisma.adminAuditLog, "create").mockResolvedValue({} as any);

      const xssMessage = "<script>alert('xss')</script><b>Special Offer!</b>";
      const res = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "HTML Escape Test",
          message: xssMessage,
        }),
      });

      expect(res.status).toBe(200);
      expect(createdCampaignSnippet).not.toContain("<script>");
      expect(createdCampaignSnippet).toContain("&lt;script&gt;alert('xss')&lt;/script&gt;");
    });
  });

  describe("Duplicate and In-Flight Re-entrancy Protection", () => {
    it("rejects identical campaign submitted within 60 seconds with 409 Conflict", async () => {
      setupAdminAuthMocks();

      vi.spyOn(prisma.user, "findMany").mockResolvedValue([
        { id: "usr_1", email: "seller1@example.com", fullName: "Seller One" },
      ] as any);

      vi.spyOn(prisma.emailCampaign, "create").mockResolvedValue({
        id: "camp_dup_1",
        type: "BULK_SELLERS",
        status: "DRAFT",
        adminId,
        subject: "Unique Promo Announcement",
        messageSnippet: "Test content",
        requestedCount: 1,
        eligibleCount: 1,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.spyOn(prisma.emailCampaign, "update").mockResolvedValue({} as any);
      vi.spyOn(prisma.emailRecipientLog, "create").mockResolvedValue({} as any);
      vi.spyOn(prisma.adminAuditLog, "create").mockResolvedValue({} as any);

      const payload = {
        segment: "ACTIVE_SELLERS",
        subject: "Unique Promo Announcement",
        message: "First dispatch content",
      };

      // First send -> 200 OK
      const firstRes = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(firstRes.status).toBe(200);

      // Immediate resend of identical campaign -> 409 Conflict
      const secondRes = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      expect(secondRes.status).toBe(409);
      const secondBody = (await secondRes.json()) as any;
      expect(secondBody.success).toBe(false);
      expect(secondBody.message).toContain("identical bulk campaign was recently submitted");
      expect(secondBody.message).toContain("60 seconds");

      // Sending with different subject -> allowed
      const differentSubjectRes = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          subject: "A completely different subject",
        }),
      });
      expect(differentSubjectRes.status).toBe(200);
    });

    it("records ADMIN_BULK_EMAIL_SENT in AdminAuditLog upon dispatch", async () => {
      setupAdminAuthMocks();

      vi.spyOn(prisma.user, "findMany").mockResolvedValueOnce([
        { id: "usr_1", email: "seller1@example.com", fullName: "Seller One" },
        { id: "usr_2", email: "seller2@example.com", fullName: "Seller Two" },
      ] as any);

      vi.spyOn(prisma.emailCampaign, "create").mockResolvedValueOnce({
        id: "camp_audit_100",
        type: "BULK_SELLERS",
        status: "DRAFT",
        adminId,
        subject: "Audit Verification Send",
        messageSnippet: "Audit content",
        requestedCount: 2,
        eligibleCount: 2,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.spyOn(prisma.emailCampaign, "update").mockResolvedValue({} as any);
      vi.spyOn(prisma.emailRecipientLog, "create").mockResolvedValue({} as any);

      let recordedAuditAction: any = null;
      vi.spyOn(prisma.adminAuditLog, "create").mockImplementationOnce(async ({ data }: any) => {
        recordedAuditAction = data;
        return { id: "audit_1", ...data, createdAt: new Date() };
      });

      const res = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "Audit Verification Send",
          message: "Audit content",
        }),
      });

      expect(res.status).toBe(200);
      expect(recordedAuditAction).not.toBeNull();
      expect(recordedAuditAction.action).toBe("ADMIN_BULK_EMAIL_SENT");
      expect(recordedAuditAction.targetType).toBe("EMAIL_CAMPAIGN");
      expect(recordedAuditAction.targetId).toBe("camp_audit_100");
      expect(recordedAuditAction.adminId).toBe(adminId);
      expect(recordedAuditAction.metadata.segment).toBe("ACTIVE_SELLERS");
      expect(recordedAuditAction.metadata.eligibleCount).toBe(2);
    });

    it("rejects simultaneous in-flight bulk sends by the same admin with 409 Conflict", async () => {
      setupAdminAuthMocks();

      let resolveInFlight: (() => void) | null = null;
      const inFlightPromise = new Promise<void>((resolve) => {
        resolveInFlight = resolve;
      });

      vi.spyOn(prisma.user, "findMany").mockImplementation(async () => {
        // Pause execution of first send
        await inFlightPromise;
        return [{ id: "usr_1", email: "seller1@example.com", fullName: "Seller One" }] as any;
      });

      vi.spyOn(prisma.emailCampaign, "create").mockResolvedValue({
        id: "camp_inflight_1",
        type: "BULK_SELLERS",
        status: "DRAFT",
        adminId,
        subject: "Slow Send",
        messageSnippet: "Slow content",
        requestedCount: 1,
        eligibleCount: 1,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      vi.spyOn(prisma.emailCampaign, "update").mockResolvedValue({} as any);
      vi.spyOn(prisma.emailRecipientLog, "create").mockResolvedValue({} as any);
      vi.spyOn(prisma.adminAuditLog, "create").mockResolvedValue({} as any);

      // Start first send (asynchronous)
      const firstSendPromise = fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ACTIVE_SELLERS",
          subject: "Slow Send",
          message: "First in-flight send",
        }),
      });

      // Small delay to ensure first request reaches mutex-acquired phase
      await new Promise((r) => setTimeout(r, 50));

      // Attempt second send while first is still in flight
      const secondSendRes = await fetch(`${baseUrl}/api/admin/communications/send-bulk-email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          segment: "ALL_ACTIVE_USERS",
          subject: "Different Subject",
          message: "Second send while in-flight",
        }),
      });

      expect(secondSendRes.status).toBe(409);
      const secondBody = (await secondSendRes.json()) as any;
      expect(secondBody.success).toBe(false);
      expect(secondBody.message).toContain("already in progress");

      // Release first send
      if (resolveInFlight) (resolveInFlight as () => void)();
      const firstSendRes = await firstSendPromise;
      expect(firstSendRes.status).toBe(200);
    });
  });
});
