"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const required = ["DATABASE_URL", "JWT_SECRET"];
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
exports.env = {
    port: Number(process.env.PORT ?? 4000),
    jwtSecret: process.env.JWT_SECRET,
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
    publicUrl: process.env.PUBLIC_URL ?? process.env.BACKEND_URL ?? process.env.RENDER_EXTERNAL_URL ?? "",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "Qwik <onboarding@resend.dev>",
    cloudinaryEnabled,
    cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
    cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
    cloudinaryFolder: process.env.CLOUDINARY_FOLDER ?? "qwik/ads"
};
