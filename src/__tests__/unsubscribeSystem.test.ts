import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "http";
import jwt from "jsonwebtoken";
import { app } from "../app";
import { env } from "../config/env";
import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  generateUnsubscribeUrls,
} from "../lib/unsubscribeToken";
import { evaluateUserEligibility, CandidateUserRecord } from "../modules/admin/bulkRecipients";
import { UserRole, UserStatus, AdStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

describe("Phase 3: Consent and Frictionless Unsubscribe System", () => {
  const testUserId = "usr_unsub_test_123";
  let server: http.Server;
  let baseUrl: string;

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

  describe("Token Generation and Verification", () => {
    it("generates a valid, signed unsubscribe token that decodes to the user ID", () => {
      const token = generateUnsubscribeToken(testUserId);
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(20);

      const verified = verifyUnsubscribeToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe(testUserId);
    });

    it("throws when generating a token without a userId", () => {
      expect(() => generateUnsubscribeToken("")).toThrow("userId is required");
      expect(() => generateUnsubscribeToken(null as any)).toThrow("userId is required");
    });

    it("rejects invalid, empty, or tampered tokens", () => {
      expect(verifyUnsubscribeToken("")).toBeNull();
      expect(verifyUnsubscribeToken(null as any)).toBeNull();
      expect(verifyUnsubscribeToken("invalid.token.signature")).toBeNull();

      // Tampered token signed with wrong secret
      const fakeToken = jwt.sign(
        { userId: testUserId, category: "emailNotifications", type: "unsubscribe" },
        "wrong_secret"
      );
      expect(verifyUnsubscribeToken(fakeToken)).toBeNull();
    });

    it("rejects tokens that do not have type: unsubscribe", () => {
      // Normal auth token or different payload
      const authLikeToken = jwt.sign(
        { userId: testUserId, role: "USER" },
        env.jwtSecret
      );
      expect(verifyUnsubscribeToken(authLikeToken)).toBeNull();
    });

    it("generates complete unsubscribe URLs for headers and footers", () => {
      const urls = generateUnsubscribeUrls(testUserId);

      expect(urls.directUnsubscribeUrl).toContain("/api/notifications/unsubscribe?token=");
      expect(urls.oneClickUrl).toContain("/api/notifications/unsubscribe-one-click?token=");
      expect(urls.preferencesUrl).toContain("/notification-settings-email");
    });
  });

  describe("Public Unsubscribe Endpoints", () => {
    it("GET /api/notifications/unsubscribe returns 400 when token is missing or invalid", async () => {
      const resJson = await fetch(`${baseUrl}/api/notifications/unsubscribe`, {
        headers: { Accept: "application/json" },
      });
      const dataJson = await resJson.json() as any;

      expect(resJson.status).toBe(400);
      expect(dataJson.success).toBe(false);
      expect(dataJson.message).toContain("Invalid or expired");

      const resHtml = await fetch(`${baseUrl}/api/notifications/unsubscribe?token=malformed_token`, {
        headers: { Accept: "text/html" },
      });
      const dataHtml = await resHtml.text();

      expect(resHtml.status).toBe(400);
      expect(dataHtml).toContain("Invalid or Expired Link");
    });

    it("GET /api/notifications/unsubscribe validates token and updates notification settings to opted-out", async () => {
      const validToken = generateUnsubscribeToken(testUserId);

      const upsertSpy = vi.spyOn(prisma.notificationSettings, "upsert").mockResolvedValueOnce({
        id: "ns_1",
        userId: testUserId,
        emailNotifications: false,
        pushNotifications: false,
        messageNotifications: true,
        offerNotifications: true,
        systemNotifications: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await fetch(`${baseUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(validToken)}`, {
        headers: { Accept: "text/html" },
      });
      const html = await res.text();

      expect(res.status).toBe(200);
      expect(html).toContain("You have been unsubscribed");
      expect(html).toContain("Manage Notification Settings");

      expect(upsertSpy).toHaveBeenCalledWith({
        where: { userId: testUserId },
        create: {
          userId: testUserId,
          emailNotifications: false,
        },
        update: {
          emailNotifications: false,
        },
      });

      upsertSpy.mockRestore();
    });

    it("GET /api/notifications/unsubscribe returns JSON confirmation when JSON is requested", async () => {
      const validToken = generateUnsubscribeToken(testUserId);

      const upsertSpy = vi.spyOn(prisma.notificationSettings, "upsert").mockResolvedValueOnce({
        id: "ns_1",
        userId: testUserId,
        emailNotifications: false,
        pushNotifications: false,
        messageNotifications: true,
        offerNotifications: true,
        systemNotifications: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await fetch(`${baseUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(validToken)}`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json() as any;

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain("unsubscribed");

      upsertSpy.mockRestore();
    });

    it("POST /api/notifications/unsubscribe-one-click complies with RFC 8058 one-click unsubscribe", async () => {
      const validToken = generateUnsubscribeToken(testUserId);

      const upsertSpy = vi.spyOn(prisma.notificationSettings, "upsert").mockResolvedValueOnce({
        id: "ns_1",
        userId: testUserId,
        emailNotifications: false,
        pushNotifications: false,
        messageNotifications: true,
        offerNotifications: true,
        systemNotifications: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Email client sends POST with List-Unsubscribe=One-Click
      const res = await fetch(`${baseUrl}/api/notifications/unsubscribe-one-click?token=${encodeURIComponent(validToken)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "List-Unsubscribe=One-Click",
      });
      const data = await res.json() as any;

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Unsubscribed");

      expect(upsertSpy).toHaveBeenCalledWith({
        where: { userId: testUserId },
        create: {
          userId: testUserId,
          emailNotifications: false,
        },
        update: {
          emailNotifications: false,
        },
      });

      upsertSpy.mockRestore();
    });

    it("POST /api/notifications/unsubscribe-one-click returns 400 for invalid token", async () => {
      const res = await fetch(`${baseUrl}/api/notifications/unsubscribe-one-click?token=invalid_token`, {
        method: "POST",
      });
      const data = await res.json() as any;

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Invalid or expired");
    });
  });

  describe("Preference State Synchronization with Eligibility Rules", () => {
    it("ensures that an unsubscribed user is immediately excluded from future bulk campaigns", () => {
      const activeSeller: CandidateUserRecord = {
        id: testUserId,
        email: "seller@example.com",
        fullName: "Jane Seller",
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        bannedAt: null,
        emailVerifiedAt: new Date(),
        notificationSettings: {
          emailNotifications: true, // Initially opted-in
        },
        ads: [{ status: AdStatus.ACTIVE }],
      };

      // Initially eligible
      expect(evaluateUserEligibility(activeSeller, "ACTIVE_SELLERS").eligible).toBe(true);
      expect(evaluateUserEligibility(activeSeller, "ALL_ACTIVE_USERS").eligible).toBe(true);

      // User clicks unsubscribe -> notificationSettings updated to emailNotifications: false
      const unsubscribedSeller: CandidateUserRecord = {
        ...activeSeller,
        notificationSettings: {
          emailNotifications: false,
        },
      };

      // Immediately excluded from all subsequent bulk sends
      const sellerResult = evaluateUserEligibility(unsubscribedSeller, "ACTIVE_SELLERS");
      expect(sellerResult.eligible).toBe(false);
      expect(sellerResult.reason).toContain("opted out of email notifications (Deals on products)");

      const userResult = evaluateUserEligibility(unsubscribedSeller, "ALL_ACTIVE_USERS");
      expect(userResult.eligible).toBe(false);
      expect(userResult.reason).toContain("opted out of email notifications (Deals on products)");
    });
  });
});
