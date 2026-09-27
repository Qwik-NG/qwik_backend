import { describe, it, expect } from "vitest";
import { UserRole, UserStatus, AdStatus, EmailCampaignType } from "@prisma/client";
import {
  getBulkRecipientWhereClause,
  evaluateUserEligibility,
  getCampaignTypeForSegment,
  isBulkRecipientSegment,
  CandidateUserRecord,
} from "../modules/admin/bulkRecipients";

describe("bulkRecipients eligibility and query builders", () => {
  const baseValidUser: CandidateUserRecord = {
    id: "usr_valid_seller",
    email: "seller@example.com",
    fullName: "Jane Seller",
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    bannedAt: null,
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    notificationSettings: {
      emailNotifications: true,
    },
    ads: [
      { status: AdStatus.ACTIVE },
    ],
  };

  describe("Segment validation & Campaign type mapping", () => {
    it("recognizes valid segments and rejects invalid ones", () => {
      expect(isBulkRecipientSegment("ACTIVE_SELLERS")).toBe(true);
      expect(isBulkRecipientSegment("ALL_ACTIVE_USERS")).toBe(true);
      expect(isBulkRecipientSegment("INVALID_SEGMENT")).toBe(false);
      expect(isBulkRecipientSegment(null)).toBe(false);
      expect(isBulkRecipientSegment(undefined)).toBe(false);
    });

    it("maps segments to the correct EmailCampaignType", () => {
      expect(getCampaignTypeForSegment("ACTIVE_SELLERS")).toBe(EmailCampaignType.BULK_SELLERS);
      expect(getCampaignTypeForSegment("ALL_ACTIVE_USERS")).toBe(EmailCampaignType.BULK_USERS);
    });
  });

  describe("Prisma UserWhereInput generation", () => {
    it("generates correct baseline UserWhereInput for ALL_ACTIVE_USERS", () => {
      const where = getBulkRecipientWhereClause("ALL_ACTIVE_USERS");

      expect(where.role).toBe(UserRole.USER);
      expect(where.status).toBe(UserStatus.ACTIVE);
      expect(where.bannedAt).toBeNull();
      expect(where.emailVerifiedAt).toEqual({ not: null });
      expect(where.email).toEqual({ not: "" });
      expect(where.notificationSettings).toEqual({
        isNot: {
          emailNotifications: false,
        },
      });
      expect(where.ads).toBeUndefined();
    });

    it("generates correct UserWhereInput for ACTIVE_SELLERS with active ads requirement", () => {
      const where = getBulkRecipientWhereClause("ACTIVE_SELLERS");

      expect(where.role).toBe(UserRole.USER);
      expect(where.status).toBe(UserStatus.ACTIVE);
      expect(where.bannedAt).toBeNull();
      expect(where.emailVerifiedAt).toEqual({ not: null });
      expect(where.email).toEqual({ not: "" });
      expect(where.notificationSettings).toEqual({
        isNot: {
          emailNotifications: false,
        },
      });
      expect(where.ads).toEqual({
        some: {
          status: AdStatus.ACTIVE,
        },
      });
    });
  });

  describe("evaluateUserEligibility rule enforcement", () => {
    it("marks an active seller with active ads, verified email, and opted-in as eligible for ACTIVE_SELLERS", () => {
      const result = evaluateUserEligibility(baseValidUser, "ACTIVE_SELLERS");
      expect(result.eligible).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("marks an active user eligible for ALL_ACTIVE_USERS even without ads", () => {
      const buyerUser: CandidateUserRecord = {
        ...baseValidUser,
        id: "usr_buyer",
        ads: [],
      };
      const result = evaluateUserEligibility(buyerUser, "ALL_ACTIVE_USERS");
      expect(result.eligible).toBe(true);
    });

    it("excludes active user with no active ads from ACTIVE_SELLERS", () => {
      const userWithNoAds: CandidateUserRecord = {
        ...baseValidUser,
        ads: [],
      };
      const result = evaluateUserEligibility(userWithNoAds, "ACTIVE_SELLERS");
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("no active ad listings");
    });

    it("excludes user whose ads are all SOLD or DRAFT or ARCHIVED from ACTIVE_SELLERS", () => {
      const userWithInactiveAds: CandidateUserRecord = {
        ...baseValidUser,
        ads: [
          { status: AdStatus.SOLD },
          { status: AdStatus.DRAFT },
          { status: AdStatus.ARCHIVED },
        ],
      };
      const result = evaluateUserEligibility(userWithInactiveAds, "ACTIVE_SELLERS");
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("no active ad listings");

      // But they are still eligible for ALL_ACTIVE_USERS
      const allUsersResult = evaluateUserEligibility(userWithInactiveAds, "ALL_ACTIVE_USERS");
      expect(allUsersResult.eligible).toBe(true);
    });

    it("excludes banned users (bannedAt is set)", () => {
      const bannedUser: CandidateUserRecord = {
        ...baseValidUser,
        bannedAt: new Date("2026-05-01T12:00:00Z"),
      };
      expect(evaluateUserEligibility(bannedUser, "ACTIVE_SELLERS").eligible).toBe(false);
      expect(evaluateUserEligibility(bannedUser, "ALL_ACTIVE_USERS").eligible).toBe(false);
    });

    it("excludes non-ACTIVE users (status !== ACTIVE)", () => {
      const inactiveUser: CandidateUserRecord = {
        ...baseValidUser,
        status: UserStatus.BANNED,
      };
      expect(evaluateUserEligibility(inactiveUser, "ACTIVE_SELLERS").eligible).toBe(false);
      expect(evaluateUserEligibility(inactiveUser, "ALL_ACTIVE_USERS").eligible).toBe(false);
    });

    it("excludes users with unverified email (emailVerifiedAt is null)", () => {
      const unverifiedUser: CandidateUserRecord = {
        ...baseValidUser,
        emailVerifiedAt: null,
      };
      expect(evaluateUserEligibility(unverifiedUser, "ACTIVE_SELLERS").eligible).toBe(false);
      expect(evaluateUserEligibility(unverifiedUser, "ALL_ACTIVE_USERS").eligible).toBe(false);
    });

    it("excludes users with opted-out email notifications (emailNotifications: false)", () => {
      const optedOutUser: CandidateUserRecord = {
        ...baseValidUser,
        notificationSettings: {
          emailNotifications: false,
        },
      };
      const sellerResult = evaluateUserEligibility(optedOutUser, "ACTIVE_SELLERS");
      expect(sellerResult.eligible).toBe(false);
      expect(sellerResult.reason).toContain("opted out");

      const allUsersResult = evaluateUserEligibility(optedOutUser, "ALL_ACTIVE_USERS");
      expect(allUsersResult.eligible).toBe(false);
      expect(allUsersResult.reason).toContain("opted out");
    });

    it("includes users where notificationSettings is null or undefined (defaults to opted-in)", () => {
      const defaultUser: CandidateUserRecord = {
        ...baseValidUser,
        notificationSettings: null,
      };
      expect(evaluateUserEligibility(defaultUser, "ACTIVE_SELLERS").eligible).toBe(true);
      expect(evaluateUserEligibility(defaultUser, "ALL_ACTIVE_USERS").eligible).toBe(true);
    });

    it("excludes admin users (role === ADMIN)", () => {
      const adminUser: CandidateUserRecord = {
        ...baseValidUser,
        role: UserRole.ADMIN,
      };
      const result = evaluateUserEligibility(adminUser, "ACTIVE_SELLERS");
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("administrator");

      expect(evaluateUserEligibility(adminUser, "ALL_ACTIVE_USERS").eligible).toBe(false);
    });

    it("excludes users with missing or empty email", () => {
      const noEmailUser: CandidateUserRecord = {
        ...baseValidUser,
        email: null,
      };
      expect(evaluateUserEligibility(noEmailUser, "ACTIVE_SELLERS").eligible).toBe(false);

      const emptyEmailUser: CandidateUserRecord = {
        ...baseValidUser,
        email: "   ",
      };
      expect(evaluateUserEligibility(emptyEmailUser, "ACTIVE_SELLERS").eligible).toBe(false);
    });
  });
});
