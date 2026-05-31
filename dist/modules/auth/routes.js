"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const jwt_1 = require("../../utils/jwt");
const validation_1 = require("../../utils/validation");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.post("/register", async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().min(6), fullName: zod_1.z.string().min(2), phone: zod_1.z.string().optional(), location: zod_1.z.string().optional() }), req.body);
        if (await prisma_1.prisma.user.findUnique({ where: { email: b.email.toLowerCase() } }))
            return res.status(409).json({ success: false, message: "Email already in use" });
        const user = await prisma_1.prisma.user.create({ data: { email: b.email.toLowerCase(), passwordHash: await bcrypt_1.default.hash(b.password, 10), fullName: b.fullName, phone: b.phone, location: b.location, profile: { create: {} } } });
        const token = (0, jwt_1.signAuthToken)({ userId: user.id, email: user.email });
        res.status(201).json({ success: true, data: { token, user: { id: user.id, email: user.email, fullName: user.fullName } } });
    }
    catch (e) {
        next(e);
    }
});
router.post("/login", async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().min(6) }), req.body);
        const user = await prisma_1.prisma.user.findUnique({ where: { email: b.email.toLowerCase() } });
        if (!user || !(await bcrypt_1.default.compare(b.password, user.passwordHash)))
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        const token = (0, jwt_1.signAuthToken)({ userId: user.id, email: user.email });
        res.json({ success: true, data: { token, user: { id: user.id, email: user.email, fullName: user.fullName } } });
    }
    catch (e) {
        next(e);
    }
});
router.post("/forgot-password", async (req, res, next) => {
    try {
        const { email } = (0, validation_1.parseOrThrow)(zod_1.z.object({ email: zod_1.z.string().email() }), req.body);
        const user = await prisma_1.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user)
            return res.json({ success: true, message: "If that email exists, a reset link has been prepared" });
        const resetToken = crypto_1.default.randomBytes(24).toString("hex");
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { resetToken, resetTokenExpAt: new Date(Date.now() + 1800000) } });
        res.json({ success: true, data: { resetToken }, message: "Reset token generated" });
    }
    catch (e) {
        next(e);
    }
});
router.post("/reset-password", async (req, res, next) => {
    try {
        const { token, password } = (0, validation_1.parseOrThrow)(zod_1.z.object({ token: zod_1.z.string().min(10), password: zod_1.z.string().min(6) }), req.body);
        const user = await prisma_1.prisma.user.findFirst({ where: { resetToken: token, resetTokenExpAt: { gt: new Date() } } });
        if (!user)
            return res.status(400).json({ success: false, message: "Invalid or expired reset token" });
        await prisma_1.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt_1.default.hash(password, 10), resetToken: null, resetTokenExpAt: null } });
        res.json({ success: true, message: "Password reset successful" });
    }
    catch (e) {
        next(e);
    }
});
router.get("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        res.json({ success: true, data: await prisma_1.prisma.user.findUnique({ where: { id: req.auth.userId }, include: { profile: true } }) });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
