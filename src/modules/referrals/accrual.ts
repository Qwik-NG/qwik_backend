import { Prisma } from "@prisma/client";
import { REFERRAL_REWARD_PERCENT } from "../../utils/referralPricing";

type ReferralAccrualClient = Pick<Prisma.TransactionClient, "$executeRaw">;

export function attemptReferralRewardAccrual(tx: ReferralAccrualClient, verificationId: string) {
  return tx.$executeRaw(Prisma.sql`
    WITH qualifying AS (
      SELECT
        referral."id" AS "referralId",
        referral."referrerId",
        payment."id" AS "paymentId",
        payment."amount"
      FROM "VerificationApplication" verification
      JOIN "PaymentTransaction" payment
        ON payment."verificationId" = verification."id"
        AND payment."purpose" = 'VERIFICATION'::"PaymentPurpose"
        AND payment."status" = 'PAID'::"PaymentStatus"
      JOIN "Referral" referral
        ON referral."referredUserId" = verification."userId"
        AND referral."status" <> 'REVOKED'::"ReferralStatus"
      WHERE verification."id" = ${verificationId}
        AND verification."status" = 'APPROVED'::"VerificationStatus"
      ORDER BY payment."createdAt" DESC
      LIMIT 1
    ),
    activated AS (
      UPDATE "Referral" referral
      SET "status" = 'ACTIVE'::"ReferralStatus", "activatedAt" = COALESCE(referral."activatedAt", CURRENT_TIMESTAMP)
      FROM qualifying
      WHERE referral."id" = qualifying."referralId"
        AND referral."status" = 'PENDING_VERIFICATION'::"ReferralStatus"
    )
    INSERT INTO "ReferralReward" (
      "id", "referralId", "paymentId", "referrerId", "qualifyingAmount", "rewardPercent", "rewardAmount"
    )
    SELECT
      gen_random_uuid()::text,
      qualifying."referralId",
      qualifying."paymentId",
      qualifying."referrerId",
      qualifying."amount",
      ${REFERRAL_REWARD_PERCENT},
      ROUND(qualifying."amount" * ${REFERRAL_REWARD_PERCENT})::integer
    FROM qualifying
    ON CONFLICT ("paymentId") DO NOTHING
  `);
}