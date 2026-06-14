
import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { Resend } from "resend";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { signAuthToken } from "../../utils/jwt";
import { parseOrThrow } from "../../utils/validation";
import { requireAuth } from "../../middleware/auth";
import { toAuthUser } from "../../utils/userResponse";
import { env } from "../../config/env";

const router = Router();
const TERMS_VERSION = "2026-06-09";
const PRIVACY_VERSION = "2026-06-09";
const RESET_PASSWORD_MESSAGE = "If that email exists, a reset link has been sent";
const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;
const authUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  location: true,
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

function resetPasswordUrl(token: string) {
  const frontendOrigin = env.frontendUrl.split(",")[0]?.trim().replace(/\/$/, "") || "http://localhost:5173";
  const url = new URL("/create-password", frontendOrigin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function sendPasswordResetEmail(email: string, resetToken: string) {
  if (!resend) {
    console.error("RESEND_API_KEY is not configured; password reset email was not sent");
    return;
  }

  const link = resetPasswordUrl(resetToken);
  await resend.emails.send({
    from: env.resendFromEmail,
    to: email,
    subject: "Reset your Qwik password",
    text: `Use this link to reset your Qwik password: ${link}\n\nThis link expires in 30 minutes.`,
    html: `<p>Use this link to reset your Qwik password:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 30 minutes.</p>`,
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
        passwordHash: await bcrypt.hash(b.password, 10),
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
    const token = signAuthToken({ userId: user.id, email: user.email, role: user.role });
    res.status(201).json({ success: true, data: { token, user: toAuthUser(user) } });
  } catch (e) { next(e); }
});

router.post("/login", async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({ email: z.string().email(), password: z.string().min(6) }), req.body);
    const user = await prisma.user.findUnique({
      where: { email: b.email.toLowerCase() },
      select: { ...authUserSelect, passwordHash: true },
    });
    if (!user || typeof user.passwordHash !== "string" || !user.passwordHash || !(await bcrypt.compare(b.password, user.passwordHash))) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }
    if (user.status === "BANNED") return res.status(403).json({ success: false, message: "This account has been suspended" });
    const token = signAuthToken({ userId: user.id, email: user.email, role: user.role });
    res.json({ success: true, data: { token, user: toAuthUser(user) } });
  } catch (e) { next(e); }
});
router.post("/forgot-password", async (req, res, next) => {
  try {
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
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10), resetToken: null, resetTokenExpAt: null } });
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

export default router;
