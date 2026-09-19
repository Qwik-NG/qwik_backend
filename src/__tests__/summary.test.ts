import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateReferralEarnings,
  getReferralSummary,
} from "../modules/referrals/routes";

describe("calculateReferralEarnings", () => {
  it("calculates total as PENDING + SETTLED + PAID", () => {
    const rewardTotals = [
      { status: "PENDING", _sum: { rewardAmount: 15_000 } },
      { status: "SETTLED", _sum: { rewardAmount: 25_000 } },
      { status: "PAID", _sum: { rewardAmount: 60_000 } },
    ];

    const result = calculateReferralEarnings(rewardTotals);

    expect(result.total).toBe(100_000);
    expect(result.pending).toBe(15_000);
    expect(result.settled).toBe(25_000);
    expect(result.paid).toBe(60_000);
    expect(result.reversed).toBe(0);
  });

  it("strictly excludes REVERSED rewards from total", () => {
    const rewardTotals = [
      { status: "PENDING", _sum: { rewardAmount: 10_000 } },
      { status: "SETTLED", _sum: { rewardAmount: 20_000 } },
      { status: "PAID", _sum: { rewardAmount: 30_000 } },
      { status: "REVERSED", _sum: { rewardAmount: 50_000 } },
    ];

    const result = calculateReferralEarnings(rewardTotals);

    // Total must be 10_000 + 20_000 + 30_000 = 60_000 (NOT 110_000)
    expect(result.total).toBe(60_000);
    expect(result.reversed).toBe(50_000);
    expect(result.total).not.toBe(110_000);
  });

  it("returns 0 for all fields when rewards are empty/zero", () => {
    const result = calculateReferralEarnings([]);

    expect(result.total).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.paid).toBe(0);
    expect(result.reversed).toBe(0);
  });

  it("handles null sum amounts safely as 0", () => {
    const rewardTotals = [
      { status: "PENDING", _sum: { rewardAmount: null } },
      { status: "SETTLED", _sum: { rewardAmount: null } },
      { status: "PAID", _sum: { rewardAmount: null } },
      { status: "REVERSED", _sum: { rewardAmount: null } },
    ];

    const result = calculateReferralEarnings(rewardTotals);

    expect(result.total).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.settled).toBe(0);
    expect(result.paid).toBe(0);
    expect(result.reversed).toBe(0);
  });
});

describe("getReferralSummary — referrer isolation & aggregation", () => {
  const mockUserId = "user-alice-777";
  const otherUserId = "user-bob-999";

  function createMockPrisma() {
    return {
      referralCode: {
        findUnique: vi.fn().mockResolvedValue({ code: "ALICE123", userId: mockUserId }),
        create: vi.fn(),
      },
      referral: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "ACTIVE", _count: { _all: 3 } },
          { status: "PENDING_VERIFICATION", _count: { _all: 1 } },
        ]),
      },
      referralReward: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "PENDING", _sum: { rewardAmount: 10_000 } },
          { status: "SETTLED", _sum: { rewardAmount: 20_000 } },
          { status: "PAID", _sum: { rewardAmount: 70_000 } },
          { status: "REVERSED", _sum: { rewardAmount: 15_000 } },
        ]),
      },
    } as any;
  }

  it("scopes all queries strictly to the authenticated referrerId", async () => {
    const mockPrisma = createMockPrisma();

    const summary = await getReferralSummary(mockUserId, mockPrisma);

    // Verify referralCode query
    expect(mockPrisma.referralCode.findUnique).toHaveBeenCalledWith({
      where: { userId: mockUserId },
    });
    expect(mockPrisma.referralCode.findUnique).not.toHaveBeenCalledWith({
      where: { userId: otherUserId },
    });

    // Verify referral counts query is scoped to referrerId
    expect(mockPrisma.referral.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { referrerId: mockUserId },
      _count: { _all: true },
    });

    // Verify referralReward query is scoped to referrerId
    expect(mockPrisma.referralReward.groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { referrerId: mockUserId },
      _sum: { rewardAmount: true },
    });

    // Verify summary values
    expect(summary.code).toBe("ALICE123");
    expect(summary.totalReferrals).toBe(4);
    expect(summary.referralsByStatus.ACTIVE).toBe(3);
    expect(summary.referralsByStatus.PENDING_VERIFICATION).toBe(1);
    expect(summary.earnings.total).toBe(100_000);
    expect(summary.earnings.pending).toBe(10_000);
    expect(summary.earnings.settled).toBe(20_000);
    expect(summary.earnings.paid).toBe(70_000);
    expect(summary.earnings.reversed).toBe(15_000);
  });

  it("returns zero counts and zero earnings when user has no referrals or rewards", async () => {
    const mockPrisma = {
      referralCode: {
        findUnique: vi.fn().mockResolvedValue({ code: "NEWUSER1", userId: "new-user" }),
        create: vi.fn(),
      },
      referral: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
      referralReward: {
        groupBy: vi.fn().mockResolvedValue([]),
      },
    } as any;

    const summary = await getReferralSummary("new-user", mockPrisma);

    expect(summary.code).toBe("NEWUSER1");
    expect(summary.totalReferrals).toBe(0);
    expect(summary.referralsByStatus.ACTIVE).toBe(0);
    expect(summary.referralsByStatus.PENDING_VERIFICATION).toBe(0);
    expect(summary.referralsByStatus.REVOKED).toBe(0);
    expect(summary.earnings.total).toBe(0);
    expect(summary.earnings.pending).toBe(0);
    expect(summary.earnings.settled).toBe(0);
    expect(summary.earnings.paid).toBe(0);
    expect(summary.earnings.reversed).toBe(0);
  });
});
