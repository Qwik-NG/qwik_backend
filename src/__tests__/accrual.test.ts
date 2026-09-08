/**
 * Tests for attemptReferralRewardAccrual (src/modules/referrals/accrual.ts).
 *
 * The function builds a Prisma.sql tagged template and passes it to
 * tx.$executeRaw. We call the REAL function with a mock tx that captures the
 * Prisma.Sql object, then inspect its `.values` array — the exact parameter
 * list Prisma would send to PostgreSQL. No production DB is touched.
 *
 * Prisma.Sql.values order inside accrual.ts template:
 *   index 0: ${verificationId}           ← the WHERE clause filter
 *   index 1: ${REFERRAL_REWARD_PERCENT}  ← stored as rewardPercent column
 *   index 2: ${REFERRAL_REWARD_PERCENT}  ← multiplier in ROUND(amount * rate)
 */
import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { attemptReferralRewardAccrual } from "../modules/referrals/accrual";
import { REFERRAL_REWARD_PERCENT } from "../utils/referralPricing";

function makeMockTx(rowsAffected = 0) {
  let capturedSql: Prisma.Sql | undefined;
  const $executeRaw = vi.fn(async (sql: Prisma.Sql) => {
    capturedSql = sql;
    return rowsAffected;
  });
  return {
    tx: { $executeRaw } as Parameters<typeof attemptReferralRewardAccrual>[0],
    getCaptured: () => capturedSql,
    $executeRaw,
  };
}

describe("attemptReferralRewardAccrual — real function, mock DB", () => {
  const TEST_VERIFICATION_ID = "ver-test-001";

  it("calls $executeRaw exactly once", async () => {
    const { tx, $executeRaw } = makeMockTx();
    await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    expect($executeRaw).toHaveBeenCalledOnce();
  });

  it("passes verificationId as the first SQL parameter", async () => {
    const { tx, getCaptured } = makeMockTx();
    await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    expect(getCaptured()!.values[0]).toBe(TEST_VERIFICATION_ID);
  });

  it("injects REFERRAL_REWARD_PERCENT (0.10) as the rewardPercent parameter (index 1)", async () => {
    const { tx, getCaptured } = makeMockTx();
    await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    expect(getCaptured()!.values[1]).toBe(REFERRAL_REWARD_PERCENT);
    expect(getCaptured()!.values[1]).toBe(0.10);
  });

  it("injects REFERRAL_REWARD_PERCENT (0.10) as the ROUND multiplier parameter (index 2)", async () => {
    const { tx, getCaptured } = makeMockTx();
    await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    expect(getCaptured()!.values[2]).toBe(REFERRAL_REWARD_PERCENT);
    expect(getCaptured()!.values[2]).toBe(0.10);
  });

  it("never passes the old rate 0.05 as any SQL parameter", async () => {
    const { tx, getCaptured } = makeMockTx();
    await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    const values = getCaptured()!.values;
    expect(values).not.toContain(0.05);
  });

  it("passes exactly 3 SQL parameters (verificationId, rewardPercent, multiplier)", async () => {
    const { tx, getCaptured } = makeMockTx();
    await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    expect(getCaptured()!.values).toHaveLength(3);
  });

  it("returns the row-count from $executeRaw — 1 when a row is inserted", async () => {
    const { tx } = makeMockTx(1);
    const result = await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    expect(result).toBe(1);
  });

  /**
   * Idempotency: the ON CONFLICT ("paymentId") DO NOTHING clause means
   * PostgreSQL returns 0 affected rows when the same paymentId is re-accrued.
   * This test verifies that when the DB returns 0 (conflict), the function
   * propagates 0 without throwing or retrying — i.e., the application layer
   * correctly handles the idempotency signal from the DB.
   *
   * Note: the actual UNIQUE constraint enforcement is a DB concern tested by
   * integration tests; here we verify the function's contract with the DB.
   */
  it("idempotency: when DB returns 0 (ON CONFLICT DO NOTHING), function returns 0 without error", async () => {
    const { tx } = makeMockTx(0); // simulate: conflict, nothing inserted
    const result = await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    expect(result).toBe(0);
  });

  it("idempotency: two calls with same id — first returns 1, second returns 0", async () => {
    const $executeRaw = vi.fn()
      .mockResolvedValueOnce(1)  // insert succeeds
      .mockResolvedValueOnce(0); // conflict on same paymentId
    const tx = { $executeRaw } as Parameters<typeof attemptReferralRewardAccrual>[0];

    const first = await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);
    const second = await attemptReferralRewardAccrual(tx, TEST_VERIFICATION_ID);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect($executeRaw).toHaveBeenCalledTimes(2);
  });
});
