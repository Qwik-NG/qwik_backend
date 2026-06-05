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
        const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
        const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;
        const imagesLimit = req.query.imagesLimit ? Number(req.query.imagesLimit) : undefined;
        const where = {
            status: "ACTIVE",
            ...(search
                ? {
                    OR: [
                        { title: { contains: search, mode: "insensitive" } },
                        {
                            description: { contains: search, mode: "insensitive" },
                        },
                    ],
                }
                : {}),
            ...(location
                ? { location: { contains: location, mode: "insensitive" } }
                : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(minPrice !== undefined || maxPrice !== undefined
                ? {
                    price: {
                        ...(minPrice !== undefined ? { gte: minPrice } : {}),
                        ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
                    },
                }
                : {}),
        };
        const [total, ads] = await Promise.all([
            prisma_1.prisma.ad.count({ where }),
            prisma_1.prisma.ad.findMany({
                where,
                include: { images: true, category: true, user: true },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        // Limit images if requested to reduce payload size
        const processedAds = imagesLimit
            ? ads.map(ad => ({
                ...ad,
                images: ad.images.slice(0, imagesLimit)
            }))
            : ads;
        res.json({ success: true, data: processedAds, meta: { page, pageSize, total } });
    }
    catch (e) {
        next(e);
    }
});
router.get("/:id", async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({
            where: { id },
            include: { images: true, category: true, user: true },
        });
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
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            categoryId: zod_1.z.string().min(1),
            title: zod_1.z.string().min(3),
            description: zod_1.z.string().min(1),
            price: zod_1.z.number().nonnegative(),
            location: zod_1.z.string().min(2),
            brand: zod_1.z.string().optional(),
            model: zod_1.z.string().optional(),
            condition: zod_1.z.string().optional(),
            specifications: zod_1.z.unknown().optional(),
            imageUrls: zod_1.z.array(zod_1.z.string()).min(1),
        }), req.body);
        const ad = await prisma_1.prisma.ad.create({
            data: {
                userId: req.auth.userId,
                categoryId: b.categoryId,
                title: b.title,
                description: b.description,
                price: b.price,
                location: b.location,
                brand: b.brand,
                model: b.model,
                condition: b.condition,
                specifications: b.specifications,
                images: { createMany: { data: b.imageUrls.map((url) => ({ url })) } },
            },
            include: { images: true, category: true },
        });
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
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            title: zod_1.z.string().min(3).optional(),
            description: zod_1.z.string().min(1).optional(),
            price: zod_1.z.number().nonnegative().optional(),
            location: zod_1.z.string().min(2).optional(),
            brand: zod_1.z.string().optional(),
            model: zod_1.z.string().optional(),
            condition: zod_1.z.string().optional(),
            specifications: zod_1.z.unknown().optional(),
            status: zod_1.z.enum(["ACTIVE", "SOLD", "DRAFT", "ARCHIVED"]).optional(),
            isPromoted: zod_1.z.boolean().optional(),
        }), req.body);
        const data = { ...b, specifications: b.specifications };
        res.json({
            success: true,
            data: await prisma_1.prisma.ad.update({
                where: { id },
                data,
                include: { images: true, category: true },
            }),
        });
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
        if (!(await prisma_1.prisma.ad.findUnique({ where: { id } })))
            return res.status(404).json({ success: false, message: "Ad not found" });
        await prisma_1.prisma.savedAd.upsert({
            where: { userId_adId: { userId: req.auth.userId, adId: id } },
            update: {},
            create: { userId: req.auth.userId, adId: id },
        });
        res.json({ success: true, message: "Ad saved" });
    }
    catch (e) {
        next(e);
    }
});
router.delete("/:id/save", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        await prisma_1.prisma.savedAd.deleteMany({
            where: { userId: req.auth.userId, adId: id },
        });
        res.json({ success: true, message: "Ad removed from saved" });
    }
    catch (e) {
        next(e);
    }
});
// Reviews endpoints
router.get("/:id/reviews", async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const reviews = await prisma_1.prisma.review.findMany({
            where: { adId: id },
            include: { user: { select: { id: true, fullName: true } } },
            orderBy: { createdAt: "desc" },
        });
        res.json({ success: true, data: reviews });
    }
    catch (e) {
        next(e);
    }
});
router.post("/:id/reviews", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        if (!(await prisma_1.prisma.ad.findUnique({ where: { id } })))
            return res.status(404).json({ success: false, message: "Ad not found" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            rating: zod_1.z.number().int().min(1).max(5),
            text: zod_1.z.string().min(1),
        }), req.body);
        const review = await prisma_1.prisma.review.create({
            data: {
                adId: id,
                userId: req.auth.userId,
                rating: b.rating,
                text: b.text,
            },
            include: { user: { select: { id: true, fullName: true } } },
        });
        res.status(201).json({ success: true, data: review });
    }
    catch (e) {
        next(e);
    }
});
// Report endpoint
router.post("/:id/report", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        if (!(await prisma_1.prisma.ad.findUnique({ where: { id } })))
            return res.status(404).json({ success: false, message: "Ad not found" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            reason: zod_1.z.string().min(5),
        }), req.body);
        const report = await prisma_1.prisma.report.create({
            data: {
                adId: id,
                userId: req.auth.userId,
                reason: b.reason,
            },
        });
        res.status(201).json({ success: true, message: "Report submitted", data: report });
    }
    catch (e) {
        next(e);
    }
});
// Mark unavailable endpoint
router.patch("/:id/mark-unavailable", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({ where: { id } });
        if (!ad)
            return res.status(404).json({ success: false, message: "Ad not found" });
        if (ad.userId !== req.auth.userId)
            return res.status(403).json({ success: false, message: "Forbidden" });
        const updated = await prisma_1.prisma.ad.update({
            where: { id },
            data: { status: "ARCHIVED" },
            include: { images: true, category: true },
        });
        res.json({ success: true, message: "Ad marked unavailable", data: updated });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
