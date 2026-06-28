
import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { z } from "zod";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../../lib/prisma";
import { signAuthToken } from "../../utils/jwt";
import { parseOrThrow } from "../../utils/validation";
import { requireAuth } from "../../middleware/auth";
import { toAuthUser } from "../../utils/userResponse";
import { env } from "../../config/env";
import { generateOtp, hashOtp, verifyOtp, OTP_EXPIRY_MS, OTP_RESEND_COOLDOWN_MS, OTP_MAX_ATTEMPTS, OTP_LOCKOUT_MS } from "../../utils/otp";

const router = Router();
const TERMS_VERSION = "2026-06-09";
const PRIVACY_VERSION = "2026-06-09";
const RESET_PASSWORD_MESSAGE = "If that email exists, a reset link has been sent";
const WELCOME_URL = "https://qwik.ng";
const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;
const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;
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
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
};

function getRequestIp(req: { ip?: string; socket?: { remoteAddress?: string | null }; headers: Record<string, unknown> }) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0]?.trim() || req.ip || req.socket?.remoteAddress || "unknown";
  }
  if (Array.isArray(forwardedFor) && typeof forwardedFor[0] === "string") {
    return forwardedFor[0].split(",")[0]?.trim() || req.ip || req.socket?.remoteAddress || "unknown";
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function getRequestUserAgent(req: { headers: Record<string, unknown> }) {
  const userAgent = req.headers["user-agent"];
  if (typeof userAgent === "string") return userAgent;
  if (Array.isArray(userAgent) && typeof userAgent[0] === "string") return userAgent[0];
  return "unknown";
}

let cachedFallbackAdminId: string | null | undefined;

async function getFallbackAdminId() {
  if (cachedFallbackAdminId !== undefined) return cachedFallbackAdminId;
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  cachedFallbackAdminId = admin?.id ?? null;
  return cachedFallbackAdminId;
}

async function createAdminAuthAuditEntry(input: {
  adminId?: string | null;
  action: "ADMIN_LOGIN_SUCCESS" | "ADMIN_LOGIN_FAILED" | "ADMIN_LOGOUT";
  targetId?: string | null;
  metadata: Prisma.InputJsonValue;
}) {
  try {
    const adminId = input.adminId ?? (await getFallbackAdminId());
    if (!adminId) return;

    await prisma.adminAuditLog.create({
      data: {
        adminId,
        action: input.action,
        targetType: "AUTH",
        targetId: input.targetId ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error("Failed to write admin auth audit entry", error);
  }
}

function resetPasswordUrl(token: string) {
  const frontendOrigin = env.frontendUrl.split(",")[0]?.trim().replace(/\/$/, "") || "http://localhost:5173";
  const url = new URL("/create-password", frontendOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function sendPasswordResetEmail(email: string, resetToken: string) {
  if (!resend) {
    if (env.isProduction) {
      throw new Error("Password reset email is not configured in production. Missing RESEND_API_KEY.");
    }
    console.error("RESEND_API_KEY is not configured; password reset email was not sent");
    return;
  }

  const link = resetPasswordUrl(resetToken);
  await resend.emails.send({
    from: env.resendFromEmail,
    to: email,
    subject: "Reset your Qwik.ng password",
    text: `Use this link to reset your Qwik.ng password: ${link}\n\nThis link expires in 30 minutes.`,
    html: `<p>Use this link to reset your Qwik.ng password:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 30 minutes.</p>`,
  });
}

async function sendVerificationOtpEmail(email: string, fullName: string, otp: string) {
  if (!resend) {
    console.error("RESEND_API_KEY is not configured; verification OTP email was not sent");
    throw new Error("Verification email is not configured. Please try again later.");
  }

  const safeName = fullName.trim() || "there";

  const result = await resend.emails.send({
    from: env.resendFromEmail,
    to: email,
    subject: "Verify your Qwik.ng email",
    text: `Hi ${safeName},\n\nYour Qwik.ng verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nDo not share this code with anyone.`,
    html: `<p>Hi ${safeName},</p><p>Your Qwik.ng verification code is:</p><p style="font-size: 24px; font-weight: bold; letter-spacing: 2px; font-family: monospace;">${otp}</p><p>This code expires in 10 minutes.</p><p><strong>Do not share this code with anyone.</strong></p>`,
  });

  if (result.error) {
    throw new Error(result.error.message || "Failed to send verification OTP email");
  }
}

async function sendWelcomeEmail(email: string, fullName: string) {
  if (!resend) {
    console.error("Welcome email skipped because Resend is not configured", { email });
    return;
  }

  await resend.emails.send({
    from: env.resendFromEmail,
    to: email,
    subject: "Welcome to Qwik.ng! 🎉",
    text: `Hi there,

Welcome to Qwik.ng — Nigeria's trusted online marketplace.

Your account has been successfully created, and you're now ready to buy, sell, and connect with thousands of users across the country.

🚀 Start by posting your first ad or explore great deals near you.

Thank you for choosing Qwik.ng. We're excited to have you in our growing community!

Happy buying & selling!

— The Qwik.ng Team`,
    html: `<p>Hi there,</p>

<p>Welcome to Qwik.ng — Nigeria's trusted online marketplace.</p>

<p>Your account has been successfully created, and you're now ready to buy, sell, and connect with thousands of users across the country.</p>

<p>🚀 Start by posting your first ad or explore great deals near you.</p>

<p>Thank you for choosing Qwik.ng. We're excited to have you in our growing community!</p>

<p>Happy buying & selling!</p>

<p>— The Qwik.ng Team</p>`,
  });
}

function queueWelcomeEmail(email: string, fullName: string, userId: string) {
  void sendWelcomeEmail(email, fullName).catch((error) => {
    console.error("Failed to send welcome email", {
      userId,
      email,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  });
}

router.post("/register", async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({
      email: z.string().email(),
      password: z.string().min(8),
      fullName: z.string().min(2),
      phone: z.string().optional(),
      location: z.string().optional(),
      termsAccepted: z.unknown().refine((value) => value === true, "Terms of Use must be accepted"),
      privacyAccepted: z.unknown().refine((value) => value === true, "Privacy Policy must be accepted"),
      termsVersion: z.string().optional(),
      privacyVersion: z.string().optional(),
    }), req.body);
    if (await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } })) return res.status(409).json({ success: false, message: "Email already in use" });
    const acceptedAt = new Date();
    const user = await prisma.user.create({
      data: {
        email: b.email.toLowerCase(),
        passwordHash: await bcrypt.hash(b.password, 12),
        fullName: b.fullName,
        phone: b.phone,
        location: b.location,
        termsAcceptedAt: acceptedAt,
        privacyAcceptedAt: acceptedAt,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        emailVerifiedAt: null,
        profile: { create: {} },
      },
      select: authUserSelect,
    });
    const token = signAuthToken({ userId: user.id, email: user.email, role: user.role });
    res.status(201).json({ success: true, data: { token, user: toAuthUser(user) } });
    queueWelcomeEmail(user.email, user.fullName, user.id);
  } catch (e) { next(e); }
});

router.post("/login", async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({ email: z.string().email(), password: z.string().min(6) }), req.body);
    const normalizedEmail = b.email.toLowerCase();
    const authContext = String(req.headers["x-auth-context"] ?? "").trim().toLowerCase();
    const isAdminContext = authContext === "admin";
    const requestIp = getRequestIp(req);
    const userAgent = getRequestUserAgent(req);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { ...authUserSelect, passwordHash: true },
    });

    const hasPasswordHash = typeof user?.passwordHash === "string" && user.passwordHash.length > 0;
    const passwordMatches = hasPasswordHash ? await bcrypt.compare(b.password, user.passwordHash as string) : false;
    const isAdminUser = user?.role === "ADMIN";
    const shouldAuditAsAdmin = isAdminContext || isAdminUser;

    if (!user || !hasPasswordHash || !passwordMatches) {
      if (shouldAuditAsAdmin) {
        await createAdminAuthAuditEntry({
          adminId: isAdminUser ? user?.id : undefined,
          action: "ADMIN_LOGIN_FAILED",
          targetId: null,
          metadata: {
            attemptedEmail: normalizedEmail,
            reason: !user ? "INVALID_CREDENTIALS" : !hasPasswordHash ? "INVALID_CREDENTIALS" : "INVALID_CREDENTIALS",
            ipAddress: requestIp,
            userAgent,
            authContext: isAdminContext ? "admin" : "standard",
            timestamp: new Date().toISOString(),
          },
        });
      }
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    if (user.status === "BANNED") {
      if (shouldAuditAsAdmin) {
        await createAdminAuthAuditEntry({
          adminId: isAdminUser ? user.id : undefined,
          action: "ADMIN_LOGIN_FAILED",
          targetId: null,
          metadata: {
            attemptedEmail: normalizedEmail,
            reason: "ACCOUNT_SUSPENDED",
            ipAddress: requestIp,
            userAgent,
            authContext: isAdminContext ? "admin" : "standard",
            timestamp: new Date().toISOString(),
          },
        });
      }
      return res.status(403).json({ success: false, message: "This account has been suspended" });
    }

    const token = signAuthToken({ userId: user.id, email: user.email, role: user.role });

    if (isAdminUser) {
      await createAdminAuthAuditEntry({
        adminId: user.id,
        action: "ADMIN_LOGIN_SUCCESS",
        targetId: user.id,
        metadata: {
          email: user.email,
          role: user.role,
          ipAddress: requestIp,
          userAgent,
          timestamp: new Date().toISOString(),
        },
      });
    }

    res.json({ success: true, data: { token, user: toAuthUser(user) } });
  } catch (e) { next(e); }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, role: true },
    });

    if (user?.role === "ADMIN") {
      await createAdminAuthAuditEntry({
        adminId: user.id,
        action: "ADMIN_LOGOUT",
        targetId: user.id,
        metadata: {
          email: user.email,
          role: user.role,
          ipAddress: getRequestIp(req),
          userAgent: getRequestUserAgent(req),
          timestamp: new Date().toISOString(),
        },
      });
    }

    res.json({ success: true, message: "Logged out" });
  } catch (e) {
    next(e);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    if (env.isProduction && !env.resendConfigured) {
      return res.status(503).json({
        success: false,
        message: "Password reset email is not configured in production. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
      });
    }

    const { email } = parseOrThrow(z.object({ email: z.string().email() }), req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.json({ success: true, message: RESET_PASSWORD_MESSAGE });
    const resetToken = crypto.randomBytes(24).toString("hex");
    await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpAt: new Date(Date.now() + 1800000) } });
    try {
      await sendPasswordResetEmail(user.email, resetToken);
    } catch (emailError) {
      console.error("Failed to send password reset email", emailError);
    }
    res.json({ success: true, message: RESET_PASSWORD_MESSAGE });
  } catch (e) { next(e); }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = parseOrThrow(z.object({ token: z.string().min(10), password: z.string().min(8) }), req.body);
    const user = await prisma.user.findFirst({ where: { resetToken: token, resetTokenExpAt: { gt: new Date() } } });
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 12), resetToken: null, resetTokenExpAt: null } });
    res.json({ success: true, message: "Password reset successful" });
  } catch (e) { next(e); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: authUserSelect });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: toAuthUser(user) });
  }
  catch (e) { next(e); }
});

router.post("/google", async (req, res, next) => {
  try {
    if (!googleClient || !env.googleClientId) {
      return res.status(503).json({ success: false, message: "Google sign-in is not configured" });
    }
    const { credential, termsAccepted, privacyAccepted } = parseOrThrow(z.object({
      credential: z.string().min(20),
      termsAccepted: z.boolean().optional(),
      privacyAccepted: z.boolean().optional(),
    }), req.body);

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    } catch {
      return res.status(401).json({ success: false, message: "Invalid Google credential" });
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email || payload.email_verified === false) {
      return res.status(401).json({ success: false, message: "Google account could not be verified" });
    }

    const email = payload.email.toLowerCase();
    const googleId = payload.sub;
    const fullName = payload.name?.trim() || payload.given_name?.trim() || email.split("@")[0]!;
    const avatarUrl = typeof payload.picture === "string" ? payload.picture : undefined;

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId }, { email }] },
      select: { ...authUserSelect, id: true, googleId: true },
    });

    let createdUser = false;

    if (user) {
      if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { googleId, authProvider: "GOOGLE" },
          select: { ...authUserSelect, id: true, googleId: true },
        });
      }

      if (!user.termsAcceptedAt || !user.privacyAcceptedAt) {
        if (termsAccepted !== true || privacyAccepted !== true) {
          return res.status(400).json({ success: false, message: "Terms of Use and Privacy Policy must be accepted" });
        }

        const acceptedAt = new Date();
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            termsAcceptedAt: user.termsAcceptedAt ?? acceptedAt,
            privacyAcceptedAt: user.privacyAcceptedAt ?? acceptedAt,
            termsVersion: user.termsVersion ?? TERMS_VERSION,
            privacyVersion: user.privacyVersion ?? PRIVACY_VERSION,
          },
          select: { ...authUserSelect, id: true, googleId: true },
        });
      }
    } else {
      if (termsAccepted !== true || privacyAccepted !== true) {
        return res.status(400).json({ success: false, message: "Terms of Use and Privacy Policy must be accepted" });
      }

      const acceptedAt = new Date();
      user = await prisma.user.create({
        data: {
          email,
          fullName,
          googleId,
          authProvider: "GOOGLE",
          termsAcceptedAt: acceptedAt,
          privacyAcceptedAt: acceptedAt,
          termsVersion: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
          emailVerifiedAt: acceptedAt,
          profile: { create: avatarUrl ? { avatarUrl } : {} },
        },
        select: { ...authUserSelect, id: true, googleId: true },
      });
      createdUser = true;
    }

    if (user.status === "BANNED") return res.status(403).json({ success: false, message: "This account has been suspended" });

    const token = signAuthToken({ userId: user.id, email: user.email, role: user.role });
    res.json({ success: true, data: { token, user: toAuthUser(user) } });
    if (createdUser) {
      queueWelcomeEmail(user.email, user.fullName, user.id);
    }
  } catch (e) { next(e); }
});

router.post("/send-verification-otp", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, fullName: true, emailVerifiedAt: true, emailVerificationOtpLastSentAt: true, emailVerificationOtpLockedUntil: true },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.emailVerifiedAt) return res.status(409).json({ success: false, message: "Email is already verified" });

    const now = new Date();
    if (user.emailVerificationOtpLockedUntil && user.emailVerificationOtpLockedUntil > now) {
      const retrySeconds = Math.ceil((user.emailVerificationOtpLockedUntil.getTime() - now.getTime()) / 1000);
      return res.status(429).json({ success: false, message: "Too many failed attempts. Please try again later.", retrySeconds });
    }

    if (user.emailVerificationOtpLastSentAt) {
      const timeSinceLastSend = now.getTime() - user.emailVerificationOtpLastSentAt.getTime();
      if (timeSinceLastSend < OTP_RESEND_COOLDOWN_MS) {
        const retrySeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - timeSinceLastSend) / 1000);
        return res.status(429).json({ success: false, message: "Please wait before requesting a new code.", retrySeconds });
      }
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationOtpHash: otpHash,
        emailVerificationOtpExpiresAt: expiresAt,
        emailVerificationOtpAttempts: 0,
        emailVerificationOtpLastSentAt: now,
        emailVerificationOtpLockedUntil: null,
      },
    });

    try {
      await sendVerificationOtpEmail(user.email, user.fullName, otp);
    } catch (emailError) {
      console.error("Failed to send verification OTP email", { userId: user.id, email: user.email, error: emailError instanceof Error ? emailError.message : "Unknown error" });
      return res.status(500).json({ success: false, message: "Failed to send verification code. Please try again later." });
    }

    res.json({ success: true, message: "Verification code sent to your email" });
  } catch (e) { next(e); }
});

router.post("/resend-verification-otp", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, fullName: true, emailVerifiedAt: true, emailVerificationOtpLastSentAt: true, emailVerificationOtpLockedUntil: true },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.emailVerifiedAt) return res.status(409).json({ success: false, message: "Email is already verified" });

    const now = new Date();
    if (user.emailVerificationOtpLockedUntil && user.emailVerificationOtpLockedUntil > now) {
      const retrySeconds = Math.ceil((user.emailVerificationOtpLockedUntil.getTime() - now.getTime()) / 1000);
      return res.status(429).json({ success: false, message: "Too many failed attempts. Please try again later.", retrySeconds });
    }

    if (user.emailVerificationOtpLastSentAt) {
      const timeSinceLastSend = now.getTime() - user.emailVerificationOtpLastSentAt.getTime();
      if (timeSinceLastSend < OTP_RESEND_COOLDOWN_MS) {
        const retrySeconds = Math.ceil((OTP_RESEND_COOLDOWN_MS - timeSinceLastSend) / 1000);
        return res.status(429).json({ success: false, message: "Please wait before requesting a new code.", retrySeconds });
      }
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationOtpHash: otpHash,
        emailVerificationOtpExpiresAt: expiresAt,
        emailVerificationOtpAttempts: 0,
        emailVerificationOtpLastSentAt: now,
        emailVerificationOtpLockedUntil: null,
      },
    });

    try {
      await sendVerificationOtpEmail(user.email, user.fullName, otp);
    } catch (emailError) {
      console.error("Failed to send verification OTP email", { userId: user.id, email: user.email, error: emailError instanceof Error ? emailError.message : "Unknown error" });
      return res.status(500).json({ success: false, message: "Failed to send verification code. Please try again later." });
    }

    res.json({ success: true, message: "Verification code resent to your email" });
  } catch (e) { next(e); }
});

router.post("/verify-email-otp", requireAuth, async (req, res, next) => {
  try {
    const { otp } = parseOrThrow(z.object({ otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits") }), req.body);

    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerifiedAt: true,
        emailVerificationOtpHash: true,
        emailVerificationOtpExpiresAt: true,
        emailVerificationOtpAttempts: true,
        emailVerificationOtpLockedUntil: true,
      },
    });

    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (user.emailVerifiedAt) return res.status(409).json({ success: false, message: "Email is already verified" });

    const now = new Date();

    if (user.emailVerificationOtpLockedUntil && user.emailVerificationOtpLockedUntil > now) {
      const retrySeconds = Math.ceil((user.emailVerificationOtpLockedUntil.getTime() - now.getTime()) / 1000);
      return res.status(429).json({ success: false, message: "Too many failed attempts. Please try again later.", retrySeconds });
    }

    if (!user.emailVerificationOtpHash || !user.emailVerificationOtpExpiresAt) {
      return res.status(400).json({ success: false, message: "Verification code not found or expired. Please request a new code." });
    }

    if (user.emailVerificationOtpExpiresAt < now) {
      return res.status(400).json({ success: false, message: "Verification code has expired. Please request a new code." });
    }

    if (!verifyOtp(otp, user.emailVerificationOtpHash)) {
      const newAttempts = user.emailVerificationOtpAttempts + 1;
      const updateData: any = { emailVerificationOtpAttempts: newAttempts };

      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        updateData.emailVerificationOtpLockedUntil = new Date(now.getTime() + OTP_LOCKOUT_MS);
      }

      await prisma.user.update({ where: { id: user.id }, data: updateData });

      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        const retrySeconds = Math.ceil(OTP_LOCKOUT_MS / 1000);
        return res.status(429).json({ success: false, message: "Too many failed attempts. Please try again later.", retrySeconds });
      }

      return res.status(400).json({ success: false, message: "Invalid verification code. Please try again." });
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: now,
        emailVerificationOtpHash: null,
        emailVerificationOtpExpiresAt: null,
        emailVerificationOtpAttempts: 0,
        emailVerificationOtpLastSentAt: null,
        emailVerificationOtpLockedUntil: null,
      },
      select: authUserSelect,
    });

    res.json({ success: true, message: "Email verified successfully", data: toAuthUser(updatedUser) });
  } catch (e) { next(e); }
});

export default router;
