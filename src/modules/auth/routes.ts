
import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { signAuthToken } from "../../utils/jwt";
import { parseOrThrow } from "../../utils/validation";
import { requireAuth } from "../../middleware/auth";
import { toAuthUser } from "../../utils/userResponse";

const router = Router();
router.post("/register", async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({ email: z.string().email(), password: z.string().min(6), fullName: z.string().min(2), phone: z.string().optional(), location: z.string().optional() }), req.body);
    if (await prisma.user.findUnique({ where: { email: b.email.toLowerCase() } })) return res.status(409).json({ success: false, message: "Email already in use" });
    const user = await prisma.user.create({ data: { email: b.email.toLowerCase(), passwordHash: await bcrypt.hash(b.password, 10), fullName: b.fullName, phone: b.phone, location: b.location, profile: { create: {} } }, include: { profile: true } });
    const token = signAuthToken({ userId: user.id, email: user.email });
    res.status(201).json({ success: true, data: { token, user: toAuthUser(user) } });
  } catch (e) { next(e); }
});

router.post("/login", async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({ email: z.string().email(), password: z.string().min(6) }), req.body);
    const user = await prisma.user.findUnique({ where: { email: b.email.toLowerCase() }, include: { profile: true } });
    if (!user || !(await bcrypt.compare(b.password, user.passwordHash))) return res.status(401).json({ success: false, message: "Invalid credentials" });
    const token = signAuthToken({ userId: user.id, email: user.email });
    res.json({ success: true, data: { token, user: toAuthUser(user) } });
  } catch (e) { next(e); }
});
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = parseOrThrow(z.object({ email: z.string().email() }), req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.json({ success: true, message: "If that email exists, a reset link has been prepared" });
    const resetToken = crypto.randomBytes(24).toString("hex");
    await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpAt: new Date(Date.now() + 1800000) } });
    res.json({ success: true, data: { resetToken }, message: "Reset token generated" });
  } catch (e) { next(e); }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = parseOrThrow(z.object({ token: z.string().min(10), password: z.string().min(6) }), req.body);
    const user = await prisma.user.findFirst({ where: { resetToken: token, resetTokenExpAt: { gt: new Date() } } });
    if (!user) return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(password, 10), resetToken: null, resetTokenExpAt: null } });
    res.json({ success: true, message: "Password reset successful" });
  } catch (e) { next(e); }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, include: { profile: true } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: toAuthUser(user) });
  }
  catch (e) { next(e); }
});

export default router;
