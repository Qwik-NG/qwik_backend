import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { parseOrThrow } from "../../utils/validation";
import { toAuthUser, toPublicUser } from "../../utils/userResponse";

const router = Router();
const sellerSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  location: true,
  role: true,
  createdAt: true,
  profile: true,
};
const adInclude = { images: true, category: true, user: { select: sellerSelect } };
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, include: { profile: true } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: toAuthUser(user) });
  } catch (e) { next(e); }
});
router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({ fullName: z.string().min(2).optional(), phone: z.string().optional(), location: z.string().optional(), bio: z.string().optional(), avatarUrl: z.string().url().optional() }), req.body);
    const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: { fullName: b.fullName, phone: b.phone, location: b.location, profile: { upsert: { create: { bio: b.bio, avatarUrl: b.avatarUrl }, update: { bio: b.bio, avatarUrl: b.avatarUrl } } } }, include: { profile: true } });
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
router.get("/:id", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: { profile: true } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: toPublicUser(user) });
  } catch (e) { next(e); }
});
export default router;
