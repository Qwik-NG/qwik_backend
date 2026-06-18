"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OTP_LOCKOUT_MS = exports.OTP_MAX_ATTEMPTS = exports.OTP_RESEND_COOLDOWN_MS = exports.OTP_EXPIRY_MS = void 0;
exports.generateOtp = generateOtp;
exports.hashOtp = hashOtp;
exports.verifyOtp = verifyOtp;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generate a 6-digit numeric OTP
 */
function generateOtp() {
    return crypto_1.default.randomInt(0, 1000000).toString().padStart(6, "0");
}
/**
 * Hash an OTP for storage
 */
function hashOtp(otp) {
    return crypto_1.default.createHash("sha256").update(otp).digest("hex");
}
/**
 * Verify an OTP against a stored hash
 */
function verifyOtp(otp, hash) {
    return hashOtp(otp) === hash;
}
/**
 * OTP expiry time in milliseconds (10 minutes)
 */
exports.OTP_EXPIRY_MS = 10 * 60 * 1000;
/**
 * Resend cooldown in milliseconds (60 seconds)
 */
exports.OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/**
 * Max failed attempts before lockout
 */
exports.OTP_MAX_ATTEMPTS = 5;
/**
 * Lockout duration in milliseconds (15 minutes)
 */
exports.OTP_LOCKOUT_MS = 15 * 60 * 1000;
