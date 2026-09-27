import { Prisma, EmailCampaignType, UserRole, UserStatus, AdStatus } from "@prisma/client";

/**
 * Strongly typed recipient segments for admin bulk communications.
 *
 * ACTIVE_SELLERS: Active users with at least one ACTIVE ad listing.
 * ALL_ACTIVE_USERS: All active platform users (buyers and sellers).
 */
export const BULK_RECIPIENT_SEGMENTS = ["ACTIVE_SELLERS", "ALL_ACTIVE_USERS"] as const;
export type BulkRecipientSegment = (typeof BULK_RECIPIENT_SEGMENTS)[number];

export function isBulkRecipientSegment(value: unknown): value is BulkRecipientSegment {
  return typeof value === "string" && BULK_RECIPIENT_SEGMENTS.includes(value as BulkRecipientSegment);
}

/**
 * Maps a BulkRecipientSegment to the corresponding Prisma EmailCampaignType enum.
 */
export function getCampaignTypeForSegment(segment: BulkRecipientSegment): EmailCampaignType {
  switch (segment) {
    case "ACTIVE_SELLERS":
      return EmailCampaignType.BULK_SELLERS;
    case "ALL_ACTIVE_USERS":
      return EmailCampaignType.BULK_USERS;
  }
}

/**
 * Reusable minimal projection for bulk recipient records.
 * Ensures only the necessary delivery identity fields are selected.
 */
export const bulkRecipientSelect = {
  id: true,
  email: true,
  fullName: true,
} as const satisfies Prisma.UserSelect;

export type BulkRecipientUser = Prisma.UserGetPayload<{
  select: typeof bulkRecipientSelect;
}>;

/**
 * Minimal user shape used for in-memory eligibility evaluation and unit testing.
 */
export interface CandidateUserRecord {
  id: string;
  email: string | null;
  fullName: string;
  role: UserRole | string;
  status: UserStatus | string;
  bannedAt: Date | string | null;
  emailVerifiedAt: Date | string | null;
  notificationSettings?: {
    emailNotifications: boolean;
  } | null;
  ads?: Array<{
    status: AdStatus | string;
  }>;
}

/**
 * Resolves the Prisma `UserWhereInput` query clause for a given bulk segment.
 *
 * CONSENT SEMANTICS:
 * Qwik's `NotificationSettings.emailNotifications` field corresponds to the
 * "Deals on products" preference in the user settings UI (`/notification-settings-email`).
 * An explicit `emailNotifications: false` setting signifies that the user has opted out
 * of promotional/marketing announcements.
 *
 * BASELINE ELIGIBILITY (both segments):
 * - role = USER (admins must not receive consumer marketing blasts; they use test email)
 * - status = ACTIVE (only active user accounts)
 * - bannedAt = null (suspended/banned accounts excluded)
 * - emailVerifiedAt != null (unverified accounts excluded to protect deliverability and avoid spam traps)
 * - email is present and non-empty
 * - notificationSettings does not explicitly set emailNotifications = false
 *
 * ACTIVE_SELLERS ADDITIONAL REQUIREMENT:
 * - ads: at least one ad with status = ACTIVE
 *
 * NOTE: Recipient IDs or raw email addresses from the client are NEVER accepted.
 * All recipient resolution is performed exclusively server-side.
 */
export function getBulkRecipientWhereClause(segment: BulkRecipientSegment): Prisma.UserWhereInput {
  const baseWhere: Prisma.UserWhereInput = {
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    bannedAt: null,
    emailVerifiedAt: { not: null },
    email: { not: "" },
    notificationSettings: {
      isNot: {
        emailNotifications: false,
      },
    },
  };

  if (segment === "ACTIVE_SELLERS") {
    return {
      ...baseWhere,
      ads: {
        some: {
          status: AdStatus.ACTIVE,
        },
      },
    };
  }

  return baseWhere;
}

/**
 * Pure in-memory validator that verifies whether a specific user record meets
 * the exact eligibility requirements of a segment.
 *
 * Useful for automated testing, pre-send assertions, and audit verification.
 */
export function evaluateUserEligibility(
  user: CandidateUserRecord,
  segment: BulkRecipientSegment
): { eligible: boolean; reason?: string } {
  // 1. Role must be USER
  if (user.role !== UserRole.USER && user.role !== "USER") {
    return { eligible: false, reason: "User is an administrator, not a consumer user" };
  }

  // 2. Status must be ACTIVE
  if (user.status !== UserStatus.ACTIVE && user.status !== "ACTIVE") {
    return { eligible: false, reason: "Account status is not ACTIVE" };
  }

  // 3. Must not be banned
  if (user.bannedAt !== null && user.bannedAt !== undefined) {
    return { eligible: false, reason: "User account is banned" };
  }

  // 4. Email must be present and non-empty
  if (!user.email || user.email.trim().length === 0) {
    return { eligible: false, reason: "User has no email address" };
  }

  // 5. Email must be verified
  if (user.emailVerifiedAt === null || user.emailVerifiedAt === undefined) {
    return { eligible: false, reason: "User email address is not verified" };
  }

  // 6. Notification preference ("Deals on products" consent)
  // If notificationSettings exists and emailNotifications is explicitly false, user is opted out.
  if (user.notificationSettings && user.notificationSettings.emailNotifications === false) {
    return { eligible: false, reason: "User opted out of email notifications (Deals on products)" };
  }

  // 7. Segment-specific checks
  if (segment === "ACTIVE_SELLERS") {
    const hasActiveAd = Boolean(
      user.ads && user.ads.some((ad) => ad.status === AdStatus.ACTIVE || ad.status === "ACTIVE")
    );
    if (!hasActiveAd) {
      return { eligible: false, reason: "User has no active ad listings" };
    }
  }

  return { eligible: true };
}
