import { Router } from "express";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";

const router = Router();

router.use(requireAuth);

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;
const MAX_CREATE_ATTEMPTS = 5;

function generateReferralCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

router.get("/me", async (req, res, next) => {
  try {
    const userId = req.auth!.userId;

    const existing = await prisma.referralCode.findUnique({ where: { userId } });
    if (existing) {
      return res.json({ success: true, data: { code: existing.code } });
    }

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      try {
        const created = await prisma.referralCode.create({
          data: { userId, code: generateReferralCode() },
        });
        return res.status(201).json({ success: true, data: { code: created.code } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const target = (e.meta?.target as string[] | undefined) ?? [];
          if (target.includes("userId")) {
            // Another concurrent request already created this user's code first.
            const winner = await prisma.referralCode.findUnique({ where: { userId } });
            if (winner) return res.json({ success: true, data: { code: winner.code } });
          }
          // Otherwise a code collision occurred; retry with a freshly generated code.
          continue;
        }
        throw e;
      }
    }

    return res.status(500).json({ success: false, message: "Failed to generate referral code" });
  } catch (e) {
    next(e);
  }
});

router.get("/summary", async (req, res, next) => {
  try {
    const userId = req.auth!.userId;

    const [referralCode, referralCounts, rewardTotals] = await Promise.all([
      prisma.referralCode.findUnique({ where: { userId } }),
      prisma.referral.groupBy({
        by: ["status"],
        where: { referrerId: userId },
        _count: { _all: true },
      }),
      prisma.referralReward.groupBy({
        by: ["status"],
        where: { referrerId: userId },
        _sum: { rewardAmount: true },
      }),
    ]);

    const referralsByStatus: Record<string, number> = { PENDING_VERIFICATION: 0, ACTIVE: 0, REVOKED: 0 };
    for (const row of referralCounts) referralsByStatus[row.status] = row._count._all;
    const totalReferrals = referralCounts.reduce((sum, row) => sum + row._count._all, 0);

    const earningsByStatus: Record<string, number> = { PENDING: 0, SETTLED: 0, PAID: 0, REVERSED: 0 };
    for (const row of rewardTotals) earningsByStatus[row.status] = row._sum.rewardAmount ?? 0;

    res.json({
      success: true,
      data: {
        code: referralCode?.code ?? null,
        totalReferrals,
        referralsByStatus,
        earnings: {
          pending: earningsByStatus.PENDING,
          settled: earningsByStatus.SETTLED,
          paid: earningsByStatus.PAID,
          reversed: earningsByStatus.REVERSED,
        },
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/list", async (req, res, next) => {
  try {
    const userId = req.auth!.userId;
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "20"), 10) || 20));

    const [referrals, total] = await prisma.$transaction([
      prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          createdAt: true,
          activatedAt: true,
          referredUser: { select: { id: true, fullName: true, email: true } },
          rewards: { select: { rewardAmount: true, status: true } },
        },
      }),
      prisma.referral.count({ where: { referrerId: userId } }),
    ]);

    const data = referrals.map((referral) => ({
      id: referral.id,
      status: referral.status,
      createdAt: referral.createdAt,
      activatedAt: referral.activatedAt,
      referredUser: referral.referredUser,
      totalRewardAmount: referral.rewards.reduce((sum, reward) => sum + reward.rewardAmount, 0),
    }));

    res.json({ success: true, data, meta: { page, pageSize, total } });
  } catch (e) {
    next(e);
  }
});

export default router;
