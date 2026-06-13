"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const validation_1 = require("../../utils/validation");
const auth_1 = require("../../middleware/auth");
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
const adInclude = {
    images: true,
    category: true,
    user: { select: sellerSelect },
};
const categoryAliases = {
    car: "vehicles",
    cars: "vehicles",
    vehicle: "vehicles",
    vehicles: "vehicles",
    phone: "phones-tablets",
    phones: "phones-tablets",
    tablet: "phones-tablets",
    tablets: "phones-tablets",
    "phones-tablet": "phones-tablets",
    "phones-tablets": "phones-tablets",
    "phones-and-tablets": "phones-tablets",
    electronics: "electronics",
    laptop: "laptops",
    laptops: "laptops",
    "desktop-computer": "desktop-computers",
    "desktop-computers": "desktop-computers",
    server: "servers",
    servers: "servers",
    furniture: "furniture-appliances",
    furnitures: "furniture-appliances",
    appliances: "furniture-appliances",
    "furniture-appliances": "furniture-appliances",
    "furniture-and-appliances": "furniture-appliances",
    home: "properties",
    property: "properties",
    properties: "properties",
    fashion: "fashion",
    beauty: "beauty",
    job: "jobs",
    jobs: "jobs",
};
function normalizeSlug(value) {
    const slug = value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return categoryAliases[slug] ?? slug;
}
function getLocationSearchTerms(value) {
    const location = value.trim();
    if (!location || location.toLowerCase() === "all nigeria")
        return [];
    if (/^(fct\s+abuja|abuja)$/i.test(location))
        return ["FCT Abuja", "Abuja"];
    return [location];
}
async function getCategoryIds(input) {
    if (input.subcategory) {
        const subcategory = await prisma_1.prisma.category.findUnique({
            where: { slug: normalizeSlug(input.subcategory) },
            select: { id: true },
        });
        return subcategory ? [subcategory.id] : [];
    }
    if (input.categoryId) {
        return [input.categoryId];
    }
    if (!input.category) {
        return undefined;
    }
    const category = await prisma_1.prisma.category.findUnique({
        where: { slug: normalizeSlug(input.category) },
        include: { children: { select: { id: true } } },
    });
    if (!category) {
        return [];
    }
    return [category.id, ...category.children.map((child) => child.id)];
}
router.get("/", async (req, res, next) => {
    try {
        const page = Number(req.query.page ?? 1);
        const pageSize = Number(req.query.pageSize ?? 24);
        const search = String(req.query.q ?? req.query.search ?? "").trim();
        const location = String(req.query.location ?? "").trim();
        const categoryId = String(req.query.categoryId ?? "").trim();
        const category = String(req.query.category ?? "").trim();
        const subcategory = String(req.query.subcategory ?? "").trim();
        const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
        const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;
        const imagesLimit = req.query.imagesLimit ? Number(req.query.imagesLimit) : undefined;
        const locationTerms = getLocationSearchTerms(location);
        const searchFilters = search
            ? [
                { title: { contains: search, mode: "insensitive" } },
                {
                    description: { contains: search, mode: "insensitive" },
                },
            ]
            : [];
        const locationFilters = locationTerms.map((term) => ({ location: { contains: term, mode: "insensitive" } }));
        const categoryIds = await getCategoryIds({
            categoryId: categoryId || undefined,
            category: category || undefined,
            subcategory: subcategory || undefined,
        });
        const where = {
            status: "ACTIVE",
            ...(searchFilters.length || locationFilters.length
                ? {
                    AND: [
                        ...(searchFilters.length ? [{ OR: searchFilters }] : []),
                        ...(locationFilters.length ? [{ OR: locationFilters }] : []),
                    ],
                }
                : {}),
            ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
            ...(minPrice !== undefined || maxPrice !== undefined
                ? {
                    price: {
                        ...(minPrice !== undefined ? { gte: minPrice } : {}),
                        ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
                    },
                }
                : {}),
        };
        const [total, ads] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.ad.count({ where }),
            prisma_1.prisma.ad.findMany({
                where,
                include: {
                    images: imagesLimit
                        ? { take: imagesLimit, orderBy: { createdAt: "asc" } }
                        : true,
                    category: true,
                    user: { select: sellerSelect },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        res.json({ success: true, data: ads, meta: { page, pageSize, total } });
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
            include: adInclude,
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
        const category = await prisma_1.prisma.category.findUnique({
            where: { id: b.categoryId },
            select: { id: true },
        });
        if (!category) {
            return res.status(400).json({ success: false, message: "Selected category is invalid. Please choose another category." });
        }
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
            include: adInclude,
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
            imageUrls: zod_1.z.array(zod_1.z.string()).min(1).optional(),
            status: zod_1.z.enum(["ACTIVE", "SOLD", "DRAFT", "ARCHIVED"]).optional(),
            isPromoted: zod_1.z.boolean().optional(),
        }), req.body);
        const { imageUrls, ...adFields } = b;
        const data = { ...adFields, specifications: b.specifications };
        res.json({
            success: true,
            data: await prisma_1.prisma.$transaction(async (tx) => {
                if (imageUrls) {
                    await tx.adImage.deleteMany({ where: { adId: id } });
                }
                return tx.ad.update({
                    where: { id },
                    data: {
                        ...data,
                        ...(imageUrls ? { images: { createMany: { data: imageUrls.map((url) => ({ url })) } } } : {}),
                    },
                    include: adInclude,
                });
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
        if (!(await prisma_1.prisma.ad.findUnique({ where: { id }, select: { id: true } })))
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
router.get("/:id/saved", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const saved = await prisma_1.prisma.savedAd.findUnique({
            where: { userId_adId: { userId: req.auth.userId, adId: id } },
            select: { id: true },
        });
        res.json({ success: true, data: { saved: Boolean(saved) } });
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
router.post("/:id/promotions", auth_1.requireAuth, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({ where: { id }, select: { id: true, userId: true } });
        if (!ad)
            return res.status(404).json({ success: false, message: "Ad not found" });
        if (ad.userId !== req.auth.userId)
            return res.status(403).json({ success: false, message: "Forbidden" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            plan: zod_1.z.enum(["top-7", "premium-30"]).default("top-7"),
        }), req.body);
        const payment = await prisma_1.prisma.paymentTransaction.create({
            data: {
                userId: req.auth.userId,
                adId: id,
                purpose: "AD_PROMOTION",
                amount: b.plan === "premium-30" ? 430000 : 161250,
                currency: "NGN",
                status: "PENDING",
                provider: "manual",
                metadata: { plan: b.plan },
            },
        });
        res.status(201).json({
            success: true,
            data: {
                paymentId: payment.id,
                checkoutUrl: payment.checkoutUrl,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                providerReady: false,
            },
            message: "Promotion payment record created. Promotion activates after payment confirmation.",
        });
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
        if (!(await prisma_1.prisma.ad.findUnique({ where: { id }, select: { id: true } })))
            return res.status(404).json({ success: false, message: "Ad not found" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            rating: zod_1.z.number().int().min(1).max(5),
            text: zod_1.z.string().min(1),
        }), req.body);
        const existingReview = await prisma_1.prisma.review.findFirst({
            where: { adId: id, userId: req.auth.userId },
            select: { id: true },
        });
        if (existingReview)
            return res.status(409).json({ success: false, message: "You have already reviewed this ad" });
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
        if (!(await prisma_1.prisma.ad.findUnique({ where: { id }, select: { id: true } })))
            return res.status(404).json({ success: false, message: "Ad not found" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            reason: zod_1.z.string().min(5),
        }), req.body);
        const existingReport = await prisma_1.prisma.report.findFirst({
            where: { adId: id, userId: req.auth.userId, status: "PENDING" },
            select: { id: true },
        });
        if (existingReport)
            return res.status(409).json({ success: false, message: "You have already reported this ad" });
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
            include: adInclude,
        });
        res.json({ success: true, message: "Ad marked unavailable", data: updated });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
