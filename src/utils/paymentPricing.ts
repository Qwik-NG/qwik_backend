export const VERIFICATION_PAYMENT_AMOUNT_KOBO = 1_075_000;

export const PROMOTION_PLAN_VALUES = ["top-1-month", "top-30-days", "premium-1-month", "premium-3-months"] as const;

export type PromotionPlan = (typeof PROMOTION_PLAN_VALUES)[number];

const PROMOTION_PAYMENT_AMOUNTS_KOBO: Record<PromotionPlan, number> = {
  "top-1-month": 1_069_625,
  "top-30-days": 2_778_875,
  "premium-1-month": 2_666_000,
  "premium-3-months": 7_460_500,
};

export function isPromotionPlan(plan: string | undefined): plan is PromotionPlan {
  return PROMOTION_PLAN_VALUES.includes(plan as PromotionPlan);
}

export function getPromotionPaymentAmountKobo(plan: PromotionPlan) {
  return PROMOTION_PAYMENT_AMOUNTS_KOBO[plan];
}