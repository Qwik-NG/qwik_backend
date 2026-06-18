"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const realtime_1 = require("../../lib/realtime");
const validation_1 = require("../../utils/validation");
const auth_1 = require("../../middleware/auth");
const paymentPricing_1 = require("../../utils/paymentPricing");
const notifications_1 = require("../../utils/notifications");
const router = (0, express_1.Router)();
const sellerSelect = {
    id: true,
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
const optionalStringQuery = zod_1.z.preprocess((value) => (Array.isArray(value) ? value[0] : value), zod_1.z.string().optional().default(""));
const optionalNumberQuery = zod_1.z.preprocess((value) => (value === undefined || value === "" ? undefined : Array.isArray(value) ? value[0] : value), zod_1.z.coerce.number().optional());
const cappedPageSizeQuery = zod_1.z.preprocess((value) => {
    if (value === undefined || value === "")
        return undefined;
    const rawValue = Array.isArray(value) ? value[0] : value;
    const numericValue = Number(rawValue);
    return Number.isNaN(numericValue) ? rawValue : Math.min(numericValue, 100);
}, zod_1.z.coerce.number().int().min(1).default(24));
const optionalLimitedIntegerQuery = (max) => zod_1.z.preprocess((value) => (value === undefined || value === "" ? undefined : Array.isArray(value) ? value[0] : value), zod_1.z.coerce.number().int().min(1).max(max).optional());
const adSpecificationsSchema = zod_1.z.record(zod_1.z.string().min(1).max(100), zod_1.z.union([zod_1.z.string().max(500), zod_1.z.number(), zod_1.z.boolean(), zod_1.z.null()])).refine((value) => Object.keys(value).length <= 50, "Specifications cannot include more than 50 fields");
const adImageUrlsSchema = (0, validation_1.createImageUrlSchema)();
const adTitleSchema = zod_1.z.string().trim().min(3).max(200);
const adDescriptionSchema = zod_1.z.string().trim().min(1).max(5000);
const adLocationSchema = zod_1.z.string().trim().min(2).max(200);
const adShortTextSchema = zod_1.z.string().trim().max(100);
const adsListQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    pageSize: cappedPageSizeQuery,
    q: optionalStringQuery,
    search: optionalStringQuery,
    location: optionalStringQuery,
    categoryId: optionalStringQuery,
    category: optionalStringQuery,
    subcategory: optionalStringQuery,
    minPrice: optionalNumberQuery,
    maxPrice: optionalNumberQuery,
    sort: zod_1.z.enum(["newest", "price-low", "price-high"]).optional().default("newest"),
    condition: optionalStringQuery,
    brand: optionalStringQuery,
    imagesLimit: optionalLimitedIntegerQuery(10),
});
const adInclude = {
    images: { orderBy: { position: "asc" } },
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
        const query = (0, validation_1.parseOrThrow)(adsListQuerySchema, req.query);
        const { page, pageSize, minPrice, maxPrice, imagesLimit, sort } = query;
        const search = (query.q || query.search).trim();
        const location = query.location.trim();
        const categoryId = query.categoryId.trim();
        const category = query.category.trim();
        const subcategory = query.subcategory.trim();
        const condition = query.condition.trim();
        const brand = query.brand.trim();
        const locationTerms = getLocationSearchTerms(location);
        const searchFilters = search
            ? [
                { title: { contains: search, mode: "insensitive" } },
                {
                    description: { contains: search, mode: "insensitive" },
                },
            ]
            : [];
        const locationFilters = locationTerms.flatMap((term) => [
            { location: { contains: term, mode: "insensitive" } },
            { locationState: { contains: term, mode: "insensitive" } },
        ]);
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
            ...(condition ? { condition: { contains: condition, mode: "insensitive" } } : {}),
            ...(brand ? { brand: { contains: brand, mode: "insensitive" } } : {}),
        };
        const [total, ads] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.ad.count({ where }),
            prisma_1.prisma.ad.findMany({
                where,
                include: {
                    images: { take: imagesLimit ?? 1, orderBy: { position: "asc" } },
                    category: true,
                    user: { select: sellerSelect },
                },
                orderBy: sort === "price-low" ? { price: "asc" } : sort === "price-high" ? { price: "desc" } : { createdAt: "desc" },
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
router.post("/", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
    try {
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            categoryId: zod_1.z.string().min(1),
            title: adTitleSchema,
            description: adDescriptionSchema,
            price: zod_1.z.number().nonnegative(),
            location: adLocationSchema,
            locationState: zod_1.z.string().trim().max(100).optional(),
            locationArea: zod_1.z.string().trim().max(200).optional(),
            brand: adShortTextSchema.optional(),
            model: adShortTextSchema.optional(),
            condition: adShortTextSchema.optional(),
            specifications: adSpecificationsSchema.optional(),
            imageUrls: adImageUrlsSchema,
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
                locationState: b.locationState ?? null,
                locationArea: b.locationArea ?? null,
                brand: b.brand,
                model: b.model,
                condition: b.condition,
                specifications: b.specifications,
                images: { createMany: { data: b.imageUrls.map((url, index) => ({ url, position: index })) } },
            },
            include: adInclude,
        });
        void (0, notifications_1.createSellerNewAdNotifications)({
            sellerId: req.auth.userId,
            sellerName: ad.user.fullName,
            adId: ad.id,
            adTitle: ad.title,
        })
            .then((notifications) => {
            notifications.forEach((notification) => {
                (0, realtime_1.emitNotificationNew)(notification.userId, notification);
            });
        })
            .catch((notificationError) => {
            console.error("Failed to notify followers about new ad", notificationError);
        });
        res.status(201).json({ success: true, data: ad });
    }
    catch (e) {
        next(e);
    }
});
router.patch("/:id", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({ where: { id } });
        if (!ad)
            return res.status(404).json({ success: false, message: "Ad not found" });
        if (ad.userId !== req.auth.userId)
            return res.status(403).json({ success: false, message: "Forbidden" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            title: adTitleSchema.optional(),
            description: adDescriptionSchema.optional(),
            price: zod_1.z.number().nonnegative().optional(),
            location: adLocationSchema.optional(),
            locationState: zod_1.z.string().trim().max(100).optional(),
            locationArea: zod_1.z.string().trim().max(200).optional(),
            brand: adShortTextSchema.optional(),
            model: adShortTextSchema.optional(),
            condition: adShortTextSchema.optional(),
            specifications: adSpecificationsSchema.optional(),
            imageUrls: adImageUrlsSchema.optional(),
            status: zod_1.z.enum(["ACTIVE", "SOLD", "DRAFT", "ARCHIVED"]).optional(),
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
                        ...(imageUrls ? { images: { createMany: { data: imageUrls.map((url, index) => ({ url, position: index })) } } } : {}),
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
router.delete("/:id", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
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
router.post("/:id/save", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
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
router.delete("/:id/save", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
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
router.post("/:id/promotions", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const ad = await prisma_1.prisma.ad.findUnique({ where: { id }, select: { id: true, userId: true } });
        if (!ad)
            return res.status(404).json({ success: false, message: "Ad not found" });
        if (ad.userId !== req.auth.userId)
            return res.status(403).json({ success: false, message: "Forbidden" });
        const b = (0, validation_1.parseOrThrow)(zod_1.z.object({
            plan: zod_1.z.enum(paymentPricing_1.PROMOTION_PLAN_VALUES).default("top-1-month"),
        }), req.body);
        const payment = await prisma_1.prisma.paymentTransaction.create({
            data: {
                userId: req.auth.userId,
                adId: id,
                purpose: "AD_PROMOTION",
                amount: (0, paymentPricing_1.getPromotionPaymentAmountKobo)(b.plan),
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
            take: 50,
        });
        res.json({ success: true, data: reviews });
    }
    catch (e) {
        next(e);
    }
});
router.post("/:id/reviews", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
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
router.post("/:id/report", auth_1.requireAuth, auth_1.requireActiveUser, async (req, res, next) => {
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
