/**
 * Tests for runMonthlySettlement (src/modules/referrals/settlement.ts).
 *
 * We call the REAL runMonthlySettlement function. The `prisma` singleton it
 * imports is replaced with a vi.mock so no DB connection is made.
 *
 * Key behavioral assertion: settlement reads the stored `rewardAmount` field
 * directly from each candidate row. It does NOT recalculate amount * rate.
 * So a reward created at the old 5% rate (rewardAmount=50_000) must settle
 * at exactly 50_000, not at 100_000 (which would be the new 10% of 1_000_000).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted before imports by vitest — the prisma import below and
// the internal import inside settlement.ts both receive this mock.
vi.mock("../lib/prisma", () => ({
  prisma: {
    referralSettlementCycle: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    referralReward: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    referralPayout: { upsert: vi.fn() },
  },
}));

import { prisma } from "../lib/prisma";
import { runMonthlySettlement } from "../modules/referrals/settlement";

// Cast once to avoid repetitive `as any` at every call site.
const p = prisma as any;

// Fixed period used in all tests — arbitrary, past dates.
const PERIOD_START = new Date("2026-07-01T00:00:00.000Z");
const PERIOD_END   = new Date("2026-08-01T00:00:00.000Z");

// A reward row that was accrued at the OLD 5% rate before this change.
const LEGACY_REWARD = {
  id:          "reward-legacy-1",
  referrerId:  "referrer-user-1",
  rewardAmount: 50_000,   // 5% of 1_000_000 kobo — value already stored in DB
};

// The cycle that findOrCreateCycle returns (only `id` is used downstream).
const MOCK_CYCLE = {
  id:          "cycle-1",
  periodStart: PERIOD_START,
  periodEnd:   PERIOD_END,
  status:      "OPEN",
  lockedAt:    null,
  lockedBy:    null,
};

function setupHappyPath(reward = LEGACY_REWARD) {
  p.referralSettlementCycle.findUnique.mockResolvedValue(null);    // no existing cycle
  p.referralSettlementCycle.create.mockResolvedValue(MOCK_CYCLE);  // create succeeds
  p.referralSettlementCycle.updateMany.mockResolvedValue({ count: 1 }); // claim succeeds
  p.referralSettlementCycle.update.mockResolvedValue({});           // close cycle
  p.referralReward.findMany.mockResolvedValue([reward]);            // one PENDING reward
  p.referralReward.updateMany.mockResolvedValue({ count: 1 });      // mark SETTLED / set payoutId
  p.user.findUnique.mockResolvedValue({ status: "ACTIVE" });
  p.referralPayout.upsert.mockResolvedValue({ id: "payout-1" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runMonthlySettlement — real function, mock DB", () => {

  describe("backward compatibility: existing 5% reward settled at stored amount", () => {
    it("creates the payout with totalAmount equal to the stored rewardAmount (50_000), not recalculated at 10%", async () => {
      setupHappyPath();
      await runMonthlySettlement({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

      const upsertCall = p.referralPayout.upsert.mock.calls[0][0];
      expect(upsertCall.create.totalAmount).toBe(50_000);
      expect(upsertCall.create.totalAmount).not.toBe(100_000); // 10% of 1_000_000 — must NOT appear
    });

    it("returns totalSettledAmount equal to the stored rewardAmount (50_000)", async () => {
      setupHappyPath();
      const summary = await runMonthlySettlement({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

      expect(summary.totalSettledAmount).toBe(50_000);
      expect(summary.totalSettledAmount).not.toBe(100_000);
    });

    it("returns correct summary counts", async () => {
      setupHappyPath();
      const summary = await runMonthlySettlement({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

      expect(summary.claimed).toBe(true);
      expect(summary.claimedRewardCount).toBe(1);
      expect(summary.payoutsCreated).toBe(1);
      expect(summary.bannedReferrerRewardCount).toBe(0);
    });
  });

  describe("idempotency: cycle already locked (PROCESSING or CLOSED)", () => {
    it("returns claimed=false without processing rewards if updateMany returns count=0", async () => {
      p.referralSettlementCycle.findUnique.mockResolvedValue(MOCK_CYCLE);
      p.referralSettlementCycle.updateMany.mockResolvedValue({ count: 0 }); // lock contested

      const summary = await runMonthlySettlement({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

      expect(summary.claimed).toBe(false);
      expect(summary.payoutsCreated).toBe(0);
      expect(summary.claimedRewardCount).toBe(0);
      expect(p.referralReward.findMany).not.toHaveBeenCalled();
    });
  });

  describe("banned referrer excluded from payout", () => {
    it("does not create a payout for a banned referrer", async () => {
      setupHappyPath();
      p.user.findUnique.mockResolvedValue({ status: "BANNED" });

      const summary = await runMonthlySettlement({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

      expect(p.referralPayout.upsert).not.toHaveBeenCalled();
      expect(summary.bannedReferrerRewardCount).toBe(1);
      expect(summary.payoutsCreated).toBe(0);
    });
  });

  describe("mixed-rate cycle: old 5% and new 10% rewards co-exist", () => {
    it("settles each reward at its own stored rewardAmount, sums them correctly", async () => {
      const legacyReward  = { id: "r-old", referrerId: "ref-A", rewardAmount: 50_000 };  // stored at 5%
      const newReward     = { id: "r-new", referrerId: "ref-A", rewardAmount: 100_000 }; // stored at 10%

      p.referralSettlementCycle.findUnique.mockResolvedValue(null);
      p.referralSettlementCycle.create.mockResolvedValue(MOCK_CYCLE);
      p.referralSettlementCycle.updateMany.mockResolvedValue({ count: 1 });
      p.referralSettlementCycle.update.mockResolvedValue({});
      p.referralReward.findMany.mockResolvedValue([legacyReward, newReward]);
      p.referralReward.updateMany.mockResolvedValue({ count: 1 });
      p.user.findUnique.mockResolvedValue({ status: "ACTIVE" });
      p.referralPayout.upsert.mockResolvedValue({ id: "payout-1" });

      const summary = await runMonthlySettlement({ periodStart: PERIOD_START, periodEnd: PERIOD_END });

      // 50_000 + 100_000 = 150_000 — the sum of stored values, not a recalculation
      expect(summary.totalSettledAmount).toBe(150_000);
      expect(summary.claimedRewardCount).toBe(2);

      // Both amounts appear in the single combined payout for ref-A
      const upsertCall = p.referralPayout.upsert.mock.calls[0][0];
      expect(upsertCall.create.totalAmount).toBe(150_000);
    });
  });
});
