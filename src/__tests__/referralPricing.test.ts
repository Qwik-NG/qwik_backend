import { describe, it, expect } from "vitest";
import { REFERRAL_REWARD_PERCENT } from "../utils/referralPricing";

describe("REFERRAL_REWARD_PERCENT", () => {
  it("is exactly 0.10 (10%)", () => {
    expect(REFERRAL_REWARD_PERCENT).toBe(0.10);
  });

  it("is a number", () => {
    expect(typeof REFERRAL_REWARD_PERCENT).toBe("number");
  });
});
