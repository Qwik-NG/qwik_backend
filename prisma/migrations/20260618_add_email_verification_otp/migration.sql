-- Add email verification OTP fields to User table
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN "emailVerificationOtpHash" TEXT,
ADD COLUMN "emailVerificationOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN "emailVerificationOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "emailVerificationOtpLastSentAt" TIMESTAMP(3),
ADD COLUMN "emailVerificationOtpLockedUntil" TIMESTAMP(3);
