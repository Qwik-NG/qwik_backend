"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const resend_1 = require("resend");
const zod_1 = require("zod");
const google_auth_library_1 = require("google-auth-library");
const prisma_1 = require("../../lib/prisma");
const jwt_1 = require("../../utils/jwt");
const validation_1 = require("../../utils/validation");
const auth_1 = require("../../middleware/auth");
const userResponse_1 = require("../../utils/userResponse");
const env_1 = require("../../config/env");
const router = (0, express_1.Router)();
const TERMS_VERSION = "2026-06-09";
const PRIVACY_VERSION = "2026-06-09";
const RESET_PASSWORD_MESSAGE = "If that email exists, a reset link has been sent";
const resend = env_1.env.resendApiKey ? new resend_1.Resend(env_1.env.resendApiKey) : null;
const googleClient = env_1.env.googleClientId ? new google_auth_library_1.OAuth2Client(env_1.env.googleClientId) : null;
const authUserSelect = {
    id: true,
    email: true,
    fullName: true,
    phone: true,
    location: true,
    locationState: true,
    locationArea: true,
    role: true,
    status: true,
    termsAcceptedAt: true,
    privacyAcceptedAt: true,
    termsVersion: true,
    privacyVersion: true,
    createdAt: true,
    profile: { select: { bio: true, avatarUrl: true } },
    verificationApplications: {
        select: { id: true, status: true, paymentStatus: true },
        orderBy: { createdAt: "desc" },
        take: 1,
    },
};
function resetPasswordUrl(token) {
    const frontendOrigin = env_1.env.frontendUrl.split(",")[0]?.trim().replace(/\/$/, "") || "http://localhost:5173";
    const url = new URL("/create-password", frontendOrigin);
    url.searchParams.set("token", token);
    return url.toString();
}
async function sendPasswordResetEmail(email, resetToken) {
    if (!resend) {
        if (env_1.env.isProduction) {
            throw new Error("Password reset email is not configured in production. Missing RESEND_API_KEY.");
        }
        console.error("RESEND_API_KEY is not configured; password reset email was not sent");
        return;
    }
    const link = resetPasswordUrl(resetToken);
    await resend.emails.send({
        from: env_1.env.resendFromEmail,
        to: email,
        subject: "Reset your Qwik password",
        text: `Use this link to reset your Qwik password: ${link}\n\nThis link expires in 30 minutes.`,
        html: `<p>Use this link to reset your Qwik password:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 30 minutes.</p>`,
    });
}
router.post("/register", async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            email: zod_1.z.string().email(),
            password: zod_1.z.string().min(8),
            fullName: zod_1.z.string().min(2),
            phone: zod_1.z.string().optional(),
            location: zod_1.z.string().optional(),
            termsAccepted: zod_1.z.unknown().refine((value) => value === true, "Terms of Use must be accepted"),
            privacyAccepted: zod_1.z.unknown().refine((value) => value === true, "Privacy Policy must be accepted"),
            termsVersion: zod_1.z.string().optional(),
            privacyVersion: zod_1.z.string().optional(),
        }), req.body);
        if (await prisma_1.prisma.user.findUnique({ where: { email: b.email.toLowerCase() } }))
            return res.status(409).json({ success: false, message: "Email already in use" });
        const acceptedAt = new Date();
        const user = await prisma_1.prisma.user.create({
            data: {
                email: b.email.toLowerCase(),
                passwordHash: await bcrypt_1.default.hash(b.password, 12),
                fullName: b.fullName,
                phone: b.phone,
                location: b.location,
                termsAcceptedAt: acceptedAt,
                privacyAcceptedAt: acceptedAt,
                termsVersion: TERMS_VERSION,
                privacyVersion: PRIVACY_VERSION,
                profile: { create: {} },
            },
            select: authUserSelect,
        });
        const token = (0, jwt_1.signAuthToken)({ userId: user.id, email: user.email, role: user.role });
        res.status(201).json({ success: true, data: { token, user: (0, userResponse_1.toAuthUser)(user) } });
    }
    catch (e) {
        next(e);
    }
});
router.post("/login", async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().min(6) }), req.body);
        const user = await prisma_1.prisma.user.findUnique({
            where: { email: b.email.toLowerCase() },
            select: { ...authUserSelect, passwordHash: true },
        });
        if (!user || typeof user.passwordHash !== "string" || !user.passwordHash || !(await bcrypt_1.default.compare(b.password, user.passwordHash))) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }
        if (user.status === "BANNED")
            return res.status(403).json({ success: false, message: "This account has been suspended" });
        const token = (0, jwt_1.signAuthToken)({ userId: user.id, email: user.email, role: user.role });
        res.json({ success: true, data: { token, user: (0, userResponse_1.toAuthUser)(user) } });
    }
    catch (e) {
        next(e);
    }
});
router.post("/forgot-password", async (req, res, next) => {
    try {
        if (env_1.env.isProduction && !env_1.env.resendConfigured) {
            return res.status(503).json({
                success: false,
                message: "Password reset email is not configured in production. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
            });
        }
        const { email } = (0, validation_1.parseOrThrow)(zod_1.z.object({ email: zod_1.z.string().email() }), req.body);
        const user = await prisma_1.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user)
            return res.json({ success: true, message: RESET_PASSWORD_MESSAGE });
        const resetToken = crypto_1.default.randomBytes(24).toString("hex");
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpAt: new Date(Date.now() + 1800000) } });
        try {
            await sendPasswordResetEmail(user.email, resetToken);
        }
        catch (emailError) {
            console.error("Failed to send password reset email", emailError);
        }
        res.json({ success: true, message: RESET_PASSWORD_MESSAGE });
    }
    catch (e) {
        next(e);
    }
});
router.post("/reset-password", async (req, res, next) => {
    try {
        const { token, password } = (0, validation_1.parseOrThrow)(zod_1.z.object({ token: zod_1.z.string().min(10), password: zod_1.z.string().min(8) }), req.body);
        const user = await prisma_1.prisma.user.findFirst({ where: { resetToken: token, resetTokenExpAt: { gt: new Date() } } });
        if (!user)
            return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt_1.default.hash(password, 12), resetToken: null, resetTokenExpAt: null } });
        res.json({ success: true, message: "Password reset successful" });
    }
    catch (e) {
        next(e);
    }
});
router.get("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({ where: { id: req.auth.userId }, select: authUserSelect });
        if (!user)
            return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, data: (0, userResponse_1.toAuthUser)(user) });
    }
    catch (e) {
        next(e);
    }
});
router.post("/google", async (req, res, next) => {
    try {
        if (!googleClient || !env_1.env.googleClientId) {
            return res.status(503).json({ success: false, message: "Google sign-in is not configured" });
        }
        const { credential } = (0, validation_1.parseOrThrow)(zod_1.z.object({ credential: zod_1.z.string().min(20) }), req.body);
        let ticket;
        try {
            ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env_1.env.googleClientId });
        }
        catch {
            return res.status(401).json({ success: false, message: "Invalid Google credential" });
        }
        const payload = ticket.getPayload();
        if (!payload || !payload.sub || !payload.email || payload.email_verified === false) {
            return res.status(401).json({ success: false, message: "Google account could not be verified" });
        }
        const email = payload.email.toLowerCase();
        const googleId = payload.sub;
        const fullName = payload.name?.trim() || payload.given_name?.trim() || email.split("@")[0];
        const avatarUrl = typeof payload.picture === "string" ? payload.picture : undefined;
        let user = await prisma_1.prisma.user.findFirst({
            where: { OR: [{ googleId }, { email }] },
            select: { ...authUserSelect, id: true, googleId: true },
        });
        if (user) {
            if (!user.googleId) {
                user = await prisma_1.prisma.user.update({
                    where: { id: user.id },
                    data: { googleId, authProvider: "GOOGLE" },
                    select: { ...authUserSelect, id: true, googleId: true },
                });
            }
        }
        else {
            const acceptedAt = new Date();
            user = await prisma_1.prisma.user.create({
                data: {
                    email,
                    fullName,
                    googleId,
                    authProvider: "GOOGLE",
                    termsAcceptedAt: acceptedAt,
                    privacyAcceptedAt: acceptedAt,
                    termsVersion: TERMS_VERSION,
                    privacyVersion: PRIVACY_VERSION,
                    profile: { create: avatarUrl ? { avatarUrl } : {} },
                },
                select: { ...authUserSelect, id: true, googleId: true },
            });
        }
        if (user.status === "BANNED")
            return res.status(403).json({ success: false, message: "This account has been suspended" });
        const token = (0, jwt_1.signAuthToken)({ userId: user.id, email: user.email, role: user.role });
        res.json({ success: true, data: { token, user: (0, userResponse_1.toAuthUser)(user) } });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
