"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const validation_1 = require("../../utils/validation");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get("/", async (req, res, next) => {
    try {
        const page = Number(req.query.page ?? 1);
        const pageSize = Number(req.query.pageSize ?? 12);
        const search = String(req.query.search ?? "").trim();
        const location = String(req.query.location ?? "").trim();
        const categoryId = String(req.query.categoryId ?? "").trim();
        const where = { status: "ACTIVE", ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}), ...(location ? { location: { contains: location, mode: "insensitive" } } : {}), ...(categoryId ? { categoryId } : {}) };
        const [total, ads] = await Promise.all([prisma_1.prisma.ad.count({ where }), prisma_1.prisma.ad.findMany({ where, include: { images: true, category: true, user: true }, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
        res.json({ success: true, data: ads, meta: { page, pageSize, total } });
    }
    catch (e) {
        next(e);
    }
});
router.get("/:id", async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({ where: { id }, include: { images: true, category: true, user: true } });
        if (!ad)
            return res.status(404).json({ success: false, message: "Ad not found" });
        res.json({ success: true, data: ad });
    }
    catch (e) {
        next(e);
    }
});
router.post("/", auth_1.requireAuth, async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ categoryId: zod_1.z.string().min(1), title: zod_1.z.string().min(3), description: zod_1.z.string().min(10), price: zod_1.z.number().nonnegative(), location: zod_1.z.string().min(2), imageUrls: zod_1.z.array(zod_1.z.string()).min(1) }), req.body);
        const ad = await prisma_1.prisma.ad.create({ data: { userId: req.auth.userId, categoryId: b.categoryId, title: b.title, description: b.description, price: b.price, location: b.location, images: { createMany: { data: b.imageUrls.map((url) => ({ url })) } } }, include: { images: true, category: true } });
        res.status(201).json({ success: true, data: ad });
    }
    catch (e) {
        next(e);
    }
});
router.patch("/:id", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({ where: { id } });
        if (!ad)
            return res.status(404).json({ success: false, message: "Ad not found" });
        if (ad.userId !== req.auth.userId)
            return res.status(403).json({ success: false, message: "Forbidden" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({ title: zod_1.z.string().min(3).optional(), description: zod_1.z.string().min(10).optional(), price: zod_1.z.number().nonnegative().optional(), location: zod_1.z.string().min(2).optional(), status: zod_1.z.enum(["ACTIVE", "SOLD", "DRAFT", "ARCHIVED"]).optional(), isPromoted: zod_1.z.boolean().optional() }), req.body);
        res.json({ success: true, data: await prisma_1.prisma.ad.update({ where: { id }, data: b, include: { images: true, category: true } }) });
    }
    catch (e) {
        next(e);
    }
});
router.delete("/:id", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({ where: { id } });
        if (!ad)
            return res.status(404).json({ success: false, message: "Ad not found" });
        if (ad.userId !== req.auth.userId)
            return res.status(403).json({ success: false, message: "Forbidden" });
        await prisma_1.prisma.ad.delete({ where: { id } });
        res.json({ success: true, data: null, message: "Ad deleted" });
    }
    catch (e) {
        next(e);
    }
});
router.post("/:id/save", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        if (!await prisma_1.prisma.ad.findUnique({ where: { id } }))
            return res.status(404).json({ success: false, message: "Ad not found" });
        await prisma_1.prisma.savedAd.upsert({ where: { userId_adId: { userId: req.auth.userId, adId: id } }, update: {}, create: { userId: req.auth.userId, adId: id } });
        res.json({ success: true, message: "Ad saved" });
    }
    catch (e) {
        next(e);
    }
});
router.delete("/:id/save", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        await prisma_1.prisma.savedAd.deleteMany({ where: { userId: req.auth.userId, adId: id } });
        res.json({ success: true, message: "Ad removed from saved" });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
