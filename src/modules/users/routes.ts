import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { parseOrThrow } from "../../utils/validation";
import { toAuthUser, toPublicUser } from "../../utils/userResponse";
import { env } from "../../config/env";

const router = Router();
const sellerSelect = {
  id: true,
  fullName: true,
  location: true,
  role: true,
  createdAt: true,
  profile: true,
  verificationApplications: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, status: true, paymentStatus: true },
  },
};
const adInclude = { images: true, category: true, user: { select: sellerSelect } };
const publicSellerSelect = {
  id: true,
  fullName: true,
  location: true,
  createdAt: true,
  profile: true,
  verificationApplications: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, status: true, paymentStatus: true },
  },
};
const publicAdInclude = { images: true, category: true, user: { select: publicSellerSelect } };
const profileInclude = {
  profile: true,
  verificationApplications: {
    orderBy: { createdAt: "desc" as const },
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
const notificationSettingsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  messageNotifications: z.boolean().optional(),
  offerNotifications: z.boolean().optional(),
  systemNotifications: z.boolean().optional(),
});

function viewerIdFromAuthorization(header?: string) {
  if (!header?.startsWith("Bearer ")) return undefined;
  try {
    const payload = jwt.verify(header.split(" ")[1], env.jwtSecret) as { userId?: string };
    return payload.userId;
  } catch {
    return undefined;
  }
}

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      include: profileInclude,
    });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: toAuthUser(user) });
  } catch (e) { next(e); }
});
router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({ fullName: z.string().min(2).optional(), phone: z.string().optional(), location: z.string().optional(), bio: z.string().optional(), avatarUrl: z.string().url().optional() }), req.body);
    const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: { fullName: b.fullName, phone: b.phone, location: b.location, profile: { upsert: { create: { bio: b.bio, avatarUrl: b.avatarUrl }, update: { bio: b.bio, avatarUrl: b.avatarUrl } } } }, include: profileInclude });
    res.json({ success: true, data: toAuthUser(user) });
  } catch (e) { next(e); }
});
router.get("/me/ads", requireAuth, async (req, res, next) => {
  try {
    const status = String(req.query.status ?? "").trim();
    const ads = await prisma.ad.findMany({
      where: {
        userId: req.auth!.userId,
        ...(status ? { status: status as any } : {}),
      },
      include: adInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: ads });
  } catch (e) { next(e); }
});
router.get("/me/saved", requireAuth, async (req, res, next) => { try { const s = await prisma.savedAd.findMany({ where: { userId: req.auth!.userId }, include: { ad: { include: adInclude } }, orderBy: { createdAt: "desc" } }); res.json({ success: true, data: s.map((x) => ({ ...x.ad, isSaved: true })) }); } catch (e) { next(e); } });
router.get("/me/notification-settings", requireAuth, async (req, res, next) => {
  try {
    const settings = await prisma.notificationSettings.upsert({
      where: { userId: req.auth!.userId },
      create: { userId: req.auth!.userId },
      update: {},
    });
    res.json({ success: true, data: settings });
  } catch (e) { next(e); }
});
router.patch("/me/notification-settings", requireAuth, async (req, res, next) => {
  try {
    const b = parseOrThrow(notificationSettingsSchema, req.body);
    const settings = await prisma.notificationSettings.upsert({
      where: { userId: req.auth!.userId },
      create: { userId: req.auth!.userId, ...b },
      update: b,
    });
    res.json({ success: true, data: settings });
  } catch (e) { next(e); }
});
router.post("/:id/follow", requireAuth, async (req, res, next) => {
  try {
    const followingId = String(req.params.id);
    const followerId = req.auth!.userId;

    if (followingId === followerId) {
      return res.status(400).json({ success: false, message: "You cannot follow yourself" });
    }

    const user = await prisma.user.findUnique({ where: { id: followingId }, select: { id: true } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });

    const [followers, following] = await Promise.all([
      prisma.follow.count({ where: { followingId } }),
      prisma.follow.count({ where: { followerId: followingId } }),
    ]);

    res.status(201).json({ success: true, data: { following: true, stats: { followers, following } } });
  } catch (e) { next(e); }
});
router.delete("/:id/follow", requireAuth, async (req, res, next) => {
  try {
    const followingId = String(req.params.id);
    const followerId = req.auth!.userId;

    await prisma.follow.deleteMany({ where: { followerId, followingId } });

    const [followers, following] = await Promise.all([
      prisma.follow.count({ where: { followingId } }),
      prisma.follow.count({ where: { followerId: followingId } }),
    ]);

    res.json({ success: true, data: { following: false, stats: { followers, following } } });
  } catch (e) { next(e); }
});
router.get("/:id", async (req, res, next) => {
  try {
    const viewerId = viewerIdFromAuthorization(req.headers.authorization);
    const user = await prisma.user.findUnique({
      where: { id: String(req.params.id) },
      include: profileInclude,
    });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const [ads, isFollowing] = await Promise.all([
      prisma.ad.findMany({
        where: { userId: user.id, status: "ACTIVE" },
        include: publicAdInclude,
        orderBy: { createdAt: "desc" },
      }),
      viewerId
        ? prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: user.id } }, select: { id: true } })
        : Promise.resolve(null),
    ]);

    res.json({ success: true, data: { ...toPublicUser(user), ads, isFollowing: Boolean(isFollowing) } });
  } catch (e) { next(e); }
});
export default router;
