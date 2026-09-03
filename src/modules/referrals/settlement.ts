import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getPreviousWatMonthPeriod } from "../../utils/settlementPeriod";

export type MonthlySettlementSummary = {
  cycleId: string;
  periodStart: Date;
  periodEnd: Date;
  claimed: boolean;
  claimedRewardCount: number;
  payoutsCreated: number;
  bannedReferrerRewardCount: number;
  totalSettledAmount: number;
};

async function findOrCreateCycle(periodStart: Date, periodEnd: Date) {
  const existing = await prisma.referralSettlementCycle.findUnique({
    where: { periodStart_periodEnd: { periodStart, periodEnd } },
  });
  if (existing) return existing;

  try {
    return await prisma.referralSettlementCycle.create({ data: { periodStart, periodEnd } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Another concurrent invocation created this period's cycle first.
      return prisma.referralSettlementCycle.findUniqueOrThrow({
        where: { periodStart_periodEnd: { periodStart, periodEnd } },
      });
    }
    throw error;
  }
}

export async function runMonthlySettlement(options: { periodStart?: Date; periodEnd?: Date; workerId?: string } = {}): Promise<MonthlySettlementSummary> {
  const { periodStart, periodEnd } = options.periodStart && options.periodEnd
    ? { periodStart: options.periodStart, periodEnd: options.periodEnd }
    : getPreviousWatMonthPeriod();
  const workerId = options.workerId ?? `internal-endpoint:${Date.now()}`;
  const now = new Date();

  const cycle = await findOrCreateCycle(periodStart, periodEnd);

  const claim = await prisma.referralSettlementCycle.updateMany({
    where: { id: cycle.id, status: "OPEN", lockedAt: null },
    data: { status: "PROCESSING", lockedAt: now, lockedBy: workerId },
  });

  if (claim.count === 0) {
    return {
      cycleId: cycle.id,
      periodStart,
      periodEnd,
      claimed: false,
      claimedRewardCount: 0,
      payoutsCreated: 0,
      bannedReferrerRewardCount: 0,
      totalSettledAmount: 0,
    };
  }

  const candidates = await prisma.referralReward.findMany({
    where: { status: "PENDING", payment: { createdAt: { gte: periodStart, lt: periodEnd } } },
    select: { id: true, referrerId: true, rewardAmount: true },
  });

  const claimedByReferrer = new Map<string, { rewardIds: string[]; total: number }>();
  for (const candidate of candidates) {
    const claimedReward = await prisma.referralReward.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "SETTLED", cycleId: cycle.id },
    });
    if (claimedReward.count === 0) continue;

    const bucket = claimedByReferrer.get(candidate.referrerId) ?? { rewardIds: [], total: 0 };
    bucket.rewardIds.push(candidate.id);
    bucket.total += candidate.rewardAmount;
    claimedByReferrer.set(candidate.referrerId, bucket);
  }

  let payoutsCreated = 0;
  let bannedReferrerRewardCount = 0;
  let totalSettledAmount = 0;

  for (const [referrerId, bucket] of claimedByReferrer) {
    totalSettledAmount += bucket.total;

    const referrer = await prisma.user.findUnique({ where: { id: referrerId }, select: { status: true } });
    if (referrer?.status === "BANNED") {
      bannedReferrerRewardCount += bucket.rewardIds.length;
      continue;
    }

    const payout = await prisma.referralPayout.upsert({
      where: { cycleId_referrerId: { cycleId: cycle.id, referrerId } },
      create: { cycleId: cycle.id, referrerId, totalAmount: bucket.total },
      update: { totalAmount: bucket.total },
    });
    payoutsCreated += 1;

    await prisma.referralReward.updateMany({
      where: { id: { in: bucket.rewardIds } },
      data: { payoutId: payout.id },
    });
  }

  await prisma.referralSettlementCycle.update({
    where: { id: cycle.id },
    data: { status: "CLOSED", lockedAt: null, lockedBy: null },
  });

  return {
    cycleId: cycle.id,
    periodStart,
    periodEnd,
    claimed: true,
    claimedRewardCount: candidates.length,
    payoutsCreated,
    bannedReferrerRewardCount,
    totalSettledAmount,
  };
}
