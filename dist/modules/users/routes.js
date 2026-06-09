"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const prisma_1 = require("../../lib/prisma");
const validation_1 = require("../../utils/validation");
const userResponse_1 = require("../../utils/userResponse");
const router = (0, express_1.Router)();
const sellerSelect = {
    id: true,
    email: true,
    fullName: true,
    phone: true,
    location: true,
    role: true,
    createdAt: true,
    profile: true,
    verificationApplications: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, paymentStatus: true },
    },
};
const adInclude = { images: true, category: true, user: { select: sellerSelect } };
router.get("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
            include: {
                profile: true,
                verificationApplications: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { id: true, status: true, paymentStatus: true },
                },
            },
        });
        if (!user)
            return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, data: (0, userResponse_1.toAuthUser)(user) });
    }
    catch (e) {
        next(e);
    }
});
router.patch("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ fullName: zod_1.z.string().min(2).optional(), phone: zod_1.z.string().optional(), location: zod_1.z.string().optional(), bio: zod_1.z.string().optional(), avatarUrl: zod_1.z.string().url().optional() }), req.body);
        const user = await prisma_1.prisma.user.update({ where: { id: req.auth.userId }, data: { fullName: b.fullName, phone: b.phone, location: b.location, profile: { upsert: { create: { bio: b.bio, avatarUrl: b.avatarUrl }, update: { bio: b.bio, avatarUrl: b.avatarUrl } } } }, include: { profile: true } });
        res.json({ success: true, data: (0, userResponse_1.toAuthUser)(user) });
    }
    catch (e) {
        next(e);
    }
});
router.get("/me/ads", auth_1.requireAuth, async (req, res, next) => {
    try {
        const status = String(req.query.status ?? "").trim();
        const ads = await prisma_1.prisma.ad.findMany({
            where: {
                userId: req.auth.userId,
                ...(status ? { status: status } : {}),
            },
            include: adInclude,
            orderBy: { createdAt: "desc" },
        });
        res.json({ success: true, data: ads });
    }
    catch (e) {
        next(e);
    }
});
router.get("/me/saved", auth_1.requireAuth, async (req, res, next) => { try {
    const s = await prisma_1.prisma.savedAd.findMany({ where: { userId: req.auth.userId }, include: { ad: { include: adInclude } }, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data: s.map((x) => ({ ...x.ad, isSaved: true })) });
}
catch (e) {
    next(e);
} });
router.get("/:id", async (req, res, next) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: String(req.params.id) },
            include: {
                profile: true,
                verificationApplications: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { id: true, status: true, paymentStatus: true },
                },
            },
        });
        if (!user)
            return res.status(404).json({ success: false, message: "User not found" });
        res.json({ success: true, data: (0, userResponse_1.toPublicUser)(user) });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
