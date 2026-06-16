"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const prisma_1 = require("../../lib/prisma");
const validation_1 = require("../../utils/validation");
const userResponse_1 = require("../../utils/userResponse");
const env_1 = require("../../config/env");
const router = (0, express_1.Router)();
const sellerSelect = {
    id: true,
    fullName: true,
    location: true,
    locationState: true,
    locationArea: true,
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
const publicSellerSelect = {
    id: true,
    fullName: true,
    location: true,
    locationState: true,
    locationArea: true,
    createdAt: true,
    profile: true,
    verificationApplications: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, paymentStatus: true },
    },
};
const publicAdInclude = { images: true, category: true, user: { select: publicSellerSelect } };
const profileInclude = {
    profile: true,
    verificationApplications: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, paymentStatus: true },
    },
    _count: {
        select: {
            ads: true,
            followers: true,
            following: true,
        },
    },
};
const notificationSettingsSchema = zod_1.z.object({
    emailNotifications: zod_1.z.boolean().optional(),
    pushNotifications: zod_1.z.boolean().optional(),
    messageNotifications: zod_1.z.boolean().optional(),
    offerNotifications: zod_1.z.boolean().optional(),
    systemNotifications: zod_1.z.boolean().optional(),
});
function viewerIdFromAuthorization(header) {
    if (!header?.startsWith("Bearer "))
        return undefined;
    try {
        const payload = jsonwebtoken_1.default.verify(header.split(" ")[1], env_1.env.jwtSecret);
        return payload.userId;
    }
    catch {
        return undefined;
    }
}
router.get("/me", auth_1.requireAuth, async (req, res, next) => {
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
            include: profileInclude,
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
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ fullName: zod_1.z.string().min(2).optional(), phone: zod_1.z.string().optional(), location: zod_1.z.string().optional(), locationState: zod_1.z.string().trim().max(100).optional(), locationArea: zod_1.z.string().trim().max(200).optional(), bio: zod_1.z.string().optional(), avatarUrl: zod_1.z.string().url().optional() }), req.body);
        const user = await prisma_1.prisma.user.update({ where: { id: req.auth.userId }, data: { fullName: b.fullName, phone: b.phone, location: b.location, locationState: b.locationState ?? undefined, locationArea: b.locationArea ?? undefined, profile: { upsert: { create: { bio: b.bio, avatarUrl: b.avatarUrl }, update: { bio: b.bio, avatarUrl: b.avatarUrl } } } }, include: profileInclude });
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
router.get("/me/notification-settings", auth_1.requireAuth, async (req, res, next) => {
    try {
        const settings = await prisma_1.prisma.notificationSettings.upsert({
            where: { userId: req.auth.userId },
            create: { userId: req.auth.userId },
            update: {},
        });
        res.json({ success: true, data: settings });
    }
    catch (e) {
        next(e);
    }
});
router.patch("/me/notification-settings", auth_1.requireAuth, async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(notificationSettingsSchema, req.body);
        const settings = await prisma_1.prisma.notificationSettings.upsert({
            where: { userId: req.auth.userId },
            create: { userId: req.auth.userId, ...b },
            update: b,
        });
        res.json({ success: true, data: settings });
    }
    catch (e) {
        next(e);
    }
});
router.post("/:id/follow", auth_1.requireAuth, async (req, res, next) => {
    try {
        const followingId = String(req.params.id);
        const followerId = req.auth.userId;
        if (followingId === followerId) {
            return res.status(400).json({ success: false, message: "You cannot follow yourself" });
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { id: followingId }, select: { id: true } });
        if (!user)
            return res.status(404).json({ success: false, message: "User not found" });
        await prisma_1.prisma.follow.upsert({
            where: { followerId_followingId: { followerId, followingId } },
            create: { followerId, followingId },
            update: {},
        });
        const [followers, following] = await Promise.all([
            prisma_1.prisma.follow.count({ where: { followingId } }),
            prisma_1.prisma.follow.count({ where: { followerId: followingId } }),
        ]);
        res.status(201).json({ success: true, data: { following: true, stats: { followers, following } } });
    }
    catch (e) {
        next(e);
    }
});
router.delete("/:id/follow", auth_1.requireAuth, async (req, res, next) => {
    try {
        const followingId = String(req.params.id);
        const followerId = req.auth.userId;
        await prisma_1.prisma.follow.deleteMany({ where: { followerId, followingId } });
        const [followers, following] = await Promise.all([
            prisma_1.prisma.follow.count({ where: { followingId } }),
            prisma_1.prisma.follow.count({ where: { followerId: followingId } }),
        ]);
        res.json({ success: true, data: { following: false, stats: { followers, following } } });
    }
    catch (e) {
        next(e);
    }
});
router.get("/:id", async (req, res, next) => {
    try {
        const viewerId = viewerIdFromAuthorization(req.headers.authorization);
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: String(req.params.id) },
            include: profileInclude,
        });
        if (!user)
            return res.status(404).json({ success: false, message: "User not found" });
        const [ads, isFollowing] = await Promise.all([
            prisma_1.prisma.ad.findMany({
                where: { userId: user.id, status: "ACTIVE" },
                include: publicAdInclude,
                orderBy: { createdAt: "desc" },
            }),
            viewerId
                ? prisma_1.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: user.id } }, select: { id: true } })
                : Promise.resolve(null),
        ]);
        res.json({ success: true, data: { ...(0, userResponse_1.toPublicUser)(user), ads, isFollowing: Boolean(isFollowing) } });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
