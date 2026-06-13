"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMOTION_PLAN_VALUES = exports.VERIFICATION_PAYMENT_AMOUNT_KOBO = void 0;
exports.isPromotionPlan = isPromotionPlan;
exports.getPromotionPaymentAmountKobo = getPromotionPaymentAmountKobo;
exports.VERIFICATION_PAYMENT_AMOUNT_KOBO = 1075000;
exports.PROMOTION_PLAN_VALUES = ["top-1-month", "top-30-days", "premium-1-month", "premium-3-months"];
const PROMOTION_PAYMENT_AMOUNTS_KOBO = {
    "top-1-month": 1069625,
    "top-30-days": 2778875,
    "premium-1-month": 2666000,
    "premium-3-months": 7460500,
};
function isPromotionPlan(plan) {
    return exports.PROMOTION_PLAN_VALUES.includes(plan);
}
function getPromotionPaymentAmountKobo(plan) {
    return PROMOTION_PAYMENT_AMOUNTS_KOBO[plan];
}
