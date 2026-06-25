"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const required = ["DATABASE_URL", "JWT_SECRET", "WEBHOOK_SECRET"];
for (const key of required) {
    if (!process.env[key])
        throw new Error(`Missing required environment variable: ${key}`);
}
function hasCloudinaryValue(value, placeholder) {
    return Boolean(value && value !== placeholder && !value.startsWith("your_"));
}
const cloudinaryEnabled = hasCloudinaryValue(process.env.CLOUDINARY_CLOUD_NAME, "your_cloud_name") &&
    hasCloudinaryValue(process.env.CLOUDINARY_API_KEY, "your_api_key") &&
    hasCloudinaryValue(process.env.CLOUDINARY_API_SECRET, "your_api_secret");
const isProduction = process.env.NODE_ENV === "production";
const frontendUrl = process.env.FRONTEND_URL?.trim() ?? "";
const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? "";
const EMAIL_FROM_NAME = "Qwik.ng";
const DEFAULT_RESEND_FROM_ADDRESS = "onboarding@resend.dev";
function extractEmailAddress(value) {
    const raw = value?.trim() ?? "";
    if (!raw)
        return DEFAULT_RESEND_FROM_ADDRESS;
    const bracketMatch = raw.match(/<\s*([^>\s]+@[^>\s]+)\s*>/);
    if (bracketMatch?.[1])
        return bracketMatch[1].trim();
    const plainMatch = raw.match(/([^\s<>"]+@[^\s<>"]+)/);
    if (plainMatch?.[1])
        return plainMatch[1].trim();
    return DEFAULT_RESEND_FROM_ADDRESS;
}
const resendFromEmailAddress = extractEmailAddress(process.env.RESEND_FROM_EMAIL);
const resendFromEmail = `${EMAIL_FROM_NAME} <${resendFromEmailAddress}>`;
const resendFromEmailLooksConfigured = resendFromEmailAddress.length > 0 &&
    resendFromEmailAddress.includes("@") &&
    resendFromEmailAddress !== DEFAULT_RESEND_FROM_ADDRESS;
const resendConfigured = resendApiKey.length > 0 && resendFromEmailLooksConfigured;
if (isProduction) {
    if (!frontendUrl) {
        throw new Error("Missing required FRONTEND_URL in production. Set FRONTEND_URL=https://qwik.ng so password reset links point to the deployed frontend.");
    }
    if (!frontendUrl.startsWith("https://")) {
        throw new Error(`Invalid FRONTEND_URL in production: ${frontendUrl}. Use an https URL such as https://qwik.ng.`);
    }
    if (!resendConfigured) {
        const missingResendVars = [
            ...(resendApiKey ? [] : ["RESEND_API_KEY"]),
            ...(resendFromEmailLooksConfigured ? [] : ["RESEND_FROM_EMAIL"]),
        ];
        throw new Error(`Missing required Resend environment variables for production password reset email: ${missingResendVars.join(", ")}. Set RESEND_API_KEY and RESEND_FROM_EMAIL (for example, Qwik.ng <no-reply@mail.qwik.ng>).`);
    }
}
if (isProduction && !cloudinaryEnabled) {
    const requiredCloudinaryVars = [
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
    ];
    const missingCloudinaryVars = requiredCloudinaryVars.filter((key) => {
        const value = process.env[key];
        if (key === "CLOUDINARY_CLOUD_NAME") {
            return !hasCloudinaryValue(value, "your_cloud_name");
        }
        if (key === "CLOUDINARY_API_KEY") {
            return !hasCloudinaryValue(value, "your_api_key");
        }
        return !hasCloudinaryValue(value, "your_api_secret");
    });
    throw new Error(`Missing required Cloudinary environment variables for production uploads: ${missingCloudinaryVars.join(", ")}. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET before starting the server in production.`);
}
const defaultAllowedOrigins = [
    "https://qwik.ng",
    "https://www.qwik.ng",
    "https://qwik-frontend-pearl.vercel.app",
    "http://localhost:5173",
].join(",");
const frontendOriginSeed = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL},${defaultAllowedOrigins}`
    : defaultAllowedOrigins;
exports.env = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    isProduction,
    port: Number(process.env.PORT ?? 4000),
    jwtSecret: process.env.JWT_SECRET,
    webhookSecret: process.env.WEBHOOK_SECRET,
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
    paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY ?? "",
    paystackCallbackUrl: process.env.PAYSTACK_CALLBACK_URL ?? "",
    freeVerifiedSellerAds: process.env.FREE_VERIFIED_SELLER_ADS === "true",
    frontendUrl: frontendUrl || "http://localhost:5173",
    appOrigins: process.env.APP_ORIGINS ?? frontendOriginSeed,
    socketOrigins: process.env.SOCKET_ORIGINS ?? frontendOriginSeed,
    publicUrl: process.env.PUBLIC_URL ?? process.env.BACKEND_URL ?? process.env.RENDER_EXTERNAL_URL ?? "",
    resendApiKey,
    resendFromEmail,
    resendConfigured,
    upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL ?? "",
    upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
    cloudinaryEnabled,
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
    cloudinaryFolder: process.env.CLOUDINARY_FOLDER ?? "qwik/ads",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
};
