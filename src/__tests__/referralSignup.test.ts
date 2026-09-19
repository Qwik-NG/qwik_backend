import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  createReferralSignupUser,
  InvalidReferralCodeError,
  SelfReferralError,
  type ReferralSignupUser,
} from "../modules/auth/routes";

function createMockPrisma(overrides?: {
  referrerRecord?: any;
  executeRawRows?: number;
}) {
  let capturedSql: Prisma.Sql | undefined;
  const executeRaw = vi.fn(async (sql: Prisma.Sql) => {
    capturedSql = sql;
    return overrides?.executeRawRows ?? 1;
  });

  const referralCode = {
    findUnique: vi.fn(async ({ where }: { where: { code: string } }) => {
      if (overrides?.referrerRecord !== undefined) {
        return overrides.referrerRecord;
      }
      if (where.code === "USMAN123") {
        return {
          id: "rc-123",
          userId: "referrer-user-id",
          code: "USMAN123",
          createdAt: new Date(),
          user: {
            id: "referrer-user-id",
            email: "referrer@example.com",
            phone: "+2348011112222",
            status: "ACTIVE",
          },
        };
      }
      return null;
    }),
  };

  const $transaction = vi.fn(async (promises: any[]) => {
    return Promise.all(promises);
  });

  return {
    client: {
      referralCode,
      $executeRaw: executeRaw,
      $transaction,
    } as any,
    getCapturedSql: () => capturedSql,
    referralCode,
    $executeRaw: executeRaw,
    $transaction,
  };
}

const sampleUserData: ReferralSignupUser = {
  id: "new-user-id-uuid",
  email: "newbuyer@example.com",
  passwordHash: "hashed_password",
  fullName: "New Buyer",
  phone: "+2348099998888",
  location: "Lagos",
  termsAcceptedAt: new Date("2026-09-19T10:00:00Z"),
  privacyAcceptedAt: new Date("2026-09-19T10:00:00Z"),
  termsVersion: "2026-06-09",
  privacyVersion: "2026-06-09",
};

describe("Manual Referral Code Signup — createReferralSignupUser", () => {
  it("attributes valid referral code to referrer and executes atomic transaction", async () => {
    const mock = createMockPrisma();

    await createReferralSignupUser(
      sampleUserData,
      "USMAN123",
      "127.0.0.1",
      "Mozilla/5.0",
      mock.client
    );

    expect(mock.referralCode.findUnique).toHaveBeenCalledWith({
      where: { code: "USMAN123" },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            status: true,
          },
        },
      },
    });

    expect(mock.$transaction).toHaveBeenCalledOnce();
    expect(mock.$executeRaw).toHaveBeenCalledOnce();

    const sql = mock.getCapturedSql()!;
    const rawSqlString = sql.strings.join("?");
    expect(rawSqlString).toContain('INSERT INTO "User"');
    expect(rawSqlString).toContain('INSERT INTO "UserProfile"');
    expect(rawSqlString).toContain('INSERT INTO "Referral"');
    // Ensure no financial reward is accrued/created at signup
    expect(rawSqlString).not.toContain('INSERT INTO "ReferralReward"');
    expect(rawSqlString).not.toContain('rewardAmount');
  });

  it("normalizes lowercase and mixed-case code to uppercase (case-insensitive)", async () => {
    const mock = createMockPrisma();

    await createReferralSignupUser(
      sampleUserData,
      "  usman123  ",
      "127.0.0.1",
      "Mozilla/5.0",
      mock.client
    );

    // Verified normalized to uppercase and trimmed
    expect(mock.referralCode.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: "USMAN123" } })
    );

    const sql = mock.getCapturedSql()!;
    expect(sql.values).toContain("USMAN123");
  });

  it("throws InvalidReferralCodeError (400) when code does not exist", async () => {
    const mock = createMockPrisma({ referrerRecord: null });

    await expect(
      createReferralSignupUser(
        sampleUserData,
        "NONEXISTENT",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      )
    ).rejects.toThrow(InvalidReferralCodeError);

    try {
      await createReferralSignupUser(
        sampleUserData,
        "NONEXISTENT",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      );
    } catch (e: any) {
      expect(e.status).toBe(400);
      expect(e.message).toBe("Invalid referral code");
    }

    // Must NOT create user or referral
    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.$executeRaw).not.toHaveBeenCalled();
  });

  it("throws InvalidReferralCodeError (400) when code has invalid format/characters", async () => {
    const mock = createMockPrisma();

    // Invalid format with special characters
    await expect(
      createReferralSignupUser(
        sampleUserData,
        "bad@code!",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      )
    ).rejects.toThrow(InvalidReferralCodeError);

    // Too short (< 3 chars)
    await expect(
      createReferralSignupUser(
        sampleUserData,
        "ab",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      )
    ).rejects.toThrow(InvalidReferralCodeError);

    expect(mock.referralCode.findUnique).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("throws SelfReferralError (400) when new user email matches referrer email", async () => {
    const mock = createMockPrisma({
      referrerRecord: {
        id: "rc-self",
        userId: "existing-referrer-id",
        code: "USMAN123",
        user: {
          id: "existing-referrer-id",
          email: "samename@example.com",
          phone: "+2348012345678",
          status: "ACTIVE",
        },
      },
    });

    const selfUserData: ReferralSignupUser = {
      ...sampleUserData,
      email: "SAMENAME@example.com", // Case insensitive email match
    };

    await expect(
      createReferralSignupUser(
        selfUserData,
        "USMAN123",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      )
    ).rejects.toThrow(SelfReferralError);

    try {
      await createReferralSignupUser(
        selfUserData,
        "USMAN123",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      );
    } catch (e: any) {
      expect(e.status).toBe(400);
      expect(e.message).toBe("You cannot use your own referral code");
    }

    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("throws SelfReferralError (400) when new user phone matches referrer phone", async () => {
    const mock = createMockPrisma({
      referrerRecord: {
        id: "rc-self",
        userId: "existing-referrer-id",
        code: "USMAN123",
        user: {
          id: "existing-referrer-id",
          email: "referrer@example.com",
          phone: "+234 801 234 5678",
          status: "ACTIVE",
        },
      },
    });

    const selfPhoneUserData: ReferralSignupUser = {
      ...sampleUserData,
      email: "different@example.com",
      phone: "+2348012345678", // Matching phone digits
    };

    await expect(
      createReferralSignupUser(
        selfPhoneUserData,
        "USMAN123",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      )
    ).rejects.toThrow(SelfReferralError);

    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("throws InvalidReferralCodeError (400) if referrer account is BANNED", async () => {
    const mock = createMockPrisma({
      referrerRecord: {
        id: "rc-banned",
        userId: "banned-user-id",
        code: "USMAN123",
        user: {
          id: "banned-user-id",
          email: "banned@example.com",
          phone: "+2348099990000",
          status: "BANNED",
        },
      },
    });

    await expect(
      createReferralSignupUser(
        sampleUserData,
        "USMAN123",
        "127.0.0.1",
        "Mozilla/5.0",
        mock.client
      )
    ).rejects.toThrow(InvalidReferralCodeError);

    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("verifies referral query does not activate referral at signup", async () => {
    const mock = createMockPrisma();

    await createReferralSignupUser(
      sampleUserData,
      "USMAN123",
      "127.0.0.1",
      "Mozilla/5.0",
      mock.client
    );

    const sql = mock.getCapturedSql()!;
    const rawSqlString = sql.strings.join("?");

    // Verify it doesn't set status to ACTIVE
    expect(rawSqlString).not.toContain("'ACTIVE'");
    // Referral table defaults status to PENDING_VERIFICATION in Prisma schema
  });
});
