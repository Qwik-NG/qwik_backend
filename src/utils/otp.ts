import crypto from "crypto";

/**
 * Generate a 6-digit numeric OTP
 */
export function generateOtp(): string {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

/**
 * Hash an OTP for storage
 */
export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

/**
 * Verify an OTP against a stored hash
 */
export function verifyOtp(otp: string, hash: string): boolean {
  return hashOtp(otp) === hash;
}

/**
 * OTP expiry time in milliseconds (10 minutes)
 */
export const OTP_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Resend cooldown in milliseconds (60 seconds)
 */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Max failed attempts before lockout
 */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Lockout duration in milliseconds (15 minutes)
 */
export const OTP_LOCKOUT_MS = 15 * 60 * 1000;
