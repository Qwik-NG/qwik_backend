
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { parseOrThrow } from "../../utils/validation";
import { requireAuth } from "../../middleware/auth";
const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const page = Number(req.query.page ?? 1);
    const pageSize = Number(req.query.pageSize ?? 12);
    const search = String(req.query.search ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const categoryId = String(req.query.categoryId ?? "").trim();
    const where = { status: "ACTIVE" as const, ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" as const } }, { description: { contains: search, mode: "insensitive" as const } }] } : {}), ...(location ? { location: { contains: location, mode: "insensitive" as const } } : {}), ...(categoryId ? { categoryId } : {}) };
    const [total, ads] = await Promise.all([prisma.ad.count({ where }), prisma.ad.findMany({ where, include: { images: true, category: true, user: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
    res.json({ success: true, data: ads, meta: { page, pageSize, total } });
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({ where: { id }, include: { images: true, category: true, user: true } });
    if (!ad) return res.status(404).json({ success: false, message: "Ad not found" });
    res.json({ success: true, data: ad });
  } catch (e) { next(e); }
});
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const b = parseOrThrow(z.object({ categoryId: z.string().min(1), title: z.string().min(3), description: z.string().min(10), price: z.number().nonnegative(), location: z.string().min(2), imageUrls: z.array(z.string()).min(1) }), req.body);
    const ad = await prisma.ad.create({ data: { userId: req.auth!.userId, categoryId: b.categoryId, title: b.title, description: b.description, price: b.price, location: b.location, images: { createMany: { data: b.imageUrls.map((url) => ({ url })) } } }, include: { images: true, category: true } });
    res.status(201).json({ success: true, data: ad });
  } catch (e) { next(e); }
});

router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({ where: { id } });
    if (!ad) return res.status(404).json({ success: false, message: "Ad not found" });
    if (ad.userId !== req.auth!.userId) return res.status(403).json({ success: false, message: "Forbidden" });
    const b = parseOrThrow(z.object({ title: z.string().min(3).optional(), description: z.string().min(10).optional(), price: z.number().nonnegative().optional(), location: z.string().min(2).optional(), status: z.enum(["ACTIVE", "SOLD", "DRAFT", "ARCHIVED"]).optional(), isPromoted: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await prisma.ad.update({ where: { id }, data: b, include: { images: true, category: true } }) });
  } catch (e) { next(e); }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({ where: { id } });
    if (!ad) return res.status(404).json({ success: false, message: "Ad not found" });
    if (ad.userId !== req.auth!.userId) return res.status(403).json({ success: false, message: "Forbidden" });
    await prisma.ad.delete({ where: { id } });
    res.json({ success: true, data: null, message: "Ad deleted" });
  } catch (e) { next(e); }
});
router.post("/:id/save", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!await prisma.ad.findUnique({ where: { id } })) return res.status(404).json({ success: false, message: "Ad not found" });
    await prisma.savedAd.upsert({ where: { userId_adId: { userId: req.auth!.userId, adId: id } }, update: {}, create: { userId: req.auth!.userId, adId: id } });
    res.json({ success: true, message: "Ad saved" });
  } catch (e) { next(e); }
});

router.delete("/:id/save", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await prisma.savedAd.deleteMany({ where: { userId: req.auth!.userId, adId: id } });
    res.json({ success: true, message: "Ad removed from saved" });
  } catch (e) { next(e); }
});

export default router;
