"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const prisma_1 = require("../../lib/prisma");
const validation_1 = require("../../utils/validation");
const router = (0, express_1.Router)();
router.get("/me", auth_1.requireAuth, async (req, res, next) => { try {
    res.json({ success: true, data: await prisma_1.prisma.user.findUnique({ where: { id: req.auth.userId }, include: { profile: true } }) });
}
catch (e) {
    next(e);
} });
router.patch("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ fullName: zod_1.z.string().min(2).optional(), phone: zod_1.z.string().optional(), location: zod_1.z.string().optional(), bio: zod_1.z.string().optional(), avatarUrl: zod_1.z.string().url().optional() }), req.body);
        const user = await prisma_1.prisma.user.update({ where: { id: req.auth.userId }, data: { fullName: b.fullName, phone: b.phone, location: b.location, profile: { upsert: { create: { bio: b.bio, avatarUrl: b.avatarUrl }, update: { bio: b.bio, avatarUrl: b.avatarUrl } } } }, include: { profile: true } });
        res.json({ success: true, data: user });
    }
    catch (e) {
        next(e);
    }
});
router.get("/me/saved", auth_1.requireAuth, async (req, res, next) => { try {
    const s = await prisma_1.prisma.savedAd.findMany({ where: { userId: req.auth.userId }, include: { ad: { include: { images: true, category: true } } }, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data: s.map((x) => x.ad) });
}
catch (e) {
    next(e);
} });
exports.default = router;
