import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { parseOrThrow } from "../../utils/validation";
import { requireActiveUser, requireAuth } from "../../middleware/auth";
import { getPromotionPaymentAmountKobo, PROMOTION_PLAN_VALUES } from "../../utils/paymentPricing";
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

const optionalStringQuery = z.preprocess(
  (value) => (Array.isArray(value) ? value[0] : value),
  z.string().optional().default(""),
);
const optionalNumberQuery = z.preprocess(
  (value) => (value === undefined || value === "" ? undefined : Array.isArray(value) ? value[0] : value),
  z.coerce.number().optional(),
);
const cappedPageSizeQuery = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  const rawValue = Array.isArray(value) ? value[0] : value;
  const numericValue = Number(rawValue);
  return Number.isNaN(numericValue) ? rawValue : Math.min(numericValue, 100);
}, z.coerce.number().int().min(1).default(24));
const optionalLimitedIntegerQuery = (max: number) => z.preprocess(
  (value) => (value === undefined || value === "" ? undefined : Array.isArray(value) ? value[0] : value),
  z.coerce.number().int().min(1).max(max).optional(),
);

const adSpecificationsSchema = z.record(
  z.string().min(1).max(100),
  z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
).refine((value) => Object.keys(value).length <= 50, "Specifications cannot include more than 50 fields");

const adImageUrlsSchema = z.array(z.string().url().max(2048)).min(4, "Please upload at least 4 product photos.").max(10);
const adTitleSchema = z.string().trim().min(3).max(200);
const adDescriptionSchema = z.string().trim().min(1).max(5000);
const adLocationSchema = z.string().trim().min(2).max(200);
const adShortTextSchema = z.string().trim().max(100);

const adsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: cappedPageSizeQuery,
  q: optionalStringQuery,
  search: optionalStringQuery,
  location: optionalStringQuery,
  categoryId: optionalStringQuery,
  category: optionalStringQuery,
  subcategory: optionalStringQuery,
  minPrice: optionalNumberQuery,
  maxPrice: optionalNumberQuery,
  sort: z.enum(["newest", "price-low", "price-high"]).optional().default("newest"),
  condition: optionalStringQuery,
  brand: optionalStringQuery,
  imagesLimit: optionalLimitedIntegerQuery(10),
});

const adInclude = {
  images: true,
  category: true,
  user: { select: sellerSelect },
};

const categoryAliases: Record<string, string> = {
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

function normalizeSlug(value: string) {
  const slug = value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return categoryAliases[slug] ?? slug;
}

function getLocationSearchTerms(value: string) {
  const location = value.trim();
  if (!location || location.toLowerCase() === "all nigeria") return [];
  if (/^(fct\s+abuja|abuja)$/i.test(location)) return ["FCT Abuja", "Abuja"];
  return [location];
}

async function getCategoryIds(input: {
  categoryId?: string;
  category?: string;
  subcategory?: string;
}) {
  if (input.subcategory) {
    const subcategory = await prisma.category.findUnique({
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

  const category = await prisma.category.findUnique({
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
    const query = parseOrThrow(adsListQuerySchema, req.query);
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
          { title: { contains: search, mode: "insensitive" as const } },
          {
            description: { contains: search, mode: "insensitive" as const },
          },
        ]
      : [];
    const locationFilters = locationTerms.flatMap((term) => [
      { location:      { contains: term, mode: "insensitive" as const } },
      { locationState: { contains: term, mode: "insensitive" as const } },
    ]);
    const categoryIds = await getCategoryIds({
      categoryId: categoryId || undefined,
      category: category || undefined,
      subcategory: subcategory || undefined,
    });

    const where = {
      status: "ACTIVE" as const,
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
      ...(condition ? { condition: { contains: condition, mode: "insensitive" as const } } : {}),
      ...(brand ? { brand: { contains: brand, mode: "insensitive" as const } } : {}),
    };
    const [total, ads] = await prisma.$transaction([
      prisma.ad.count({ where }),
      prisma.ad.findMany({
        where,
        include: {
          images: { take: imagesLimit ?? 1, orderBy: { createdAt: "asc" } },
          category: true,
          user: { select: sellerSelect },
        },
        orderBy: sort === "price-low" ? { price: "asc" } : sort === "price-high" ? { price: "desc" } : { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({ success: true, data: ads, meta: { page, pageSize, total } });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({
      where: { id },
      include: adInclude,
    });
    if (!ad)
      return res.status(404).json({ success: false, message: "Ad not found" });
    res.json({ success: true, data: ad });
  } catch (e) {
    next(e);
  }
});
router.post("/", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const b = parseOrThrow(
      z.object({
        categoryId: z.string().min(1),
        title: adTitleSchema,
        description: adDescriptionSchema,
        price: z.number().nonnegative(),
        location: adLocationSchema,
        locationState: z.string().trim().max(100).optional(),
        locationArea: z.string().trim().max(200).optional(),
        brand: adShortTextSchema.optional(),
        model: adShortTextSchema.optional(),
        condition: adShortTextSchema.optional(),
        specifications: adSpecificationsSchema.optional(),
        imageUrls: adImageUrlsSchema,
      }),
      req.body,
    );
    const category = await prisma.category.findUnique({
      where: { id: b.categoryId },
      select: { id: true },
    });
    if (!category) {
      return res.status(400).json({ success: false, message: "Selected category is invalid. Please choose another category." });
    }

    const ad = await prisma.ad.create({
      data: {
        userId: req.auth!.userId,
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
        specifications: b.specifications as any,
        images: { createMany: { data: b.imageUrls.map((url) => ({ url })) } },
      },
      include: adInclude,
    });
    res.status(201).json({ success: true, data: ad });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({ where: { id } });
    if (!ad)
      return res.status(404).json({ success: false, message: "Ad not found" });
    if (ad.userId !== req.auth!.userId)
      return res.status(403).json({ success: false, message: "Forbidden" });
    const b = parseOrThrow(
      z.object({
        title: adTitleSchema.optional(),
        description: adDescriptionSchema.optional(),
        price: z.number().nonnegative().optional(),
        location: adLocationSchema.optional(),
        locationState: z.string().trim().max(100).optional(),
        locationArea: z.string().trim().max(200).optional(),
        brand: adShortTextSchema.optional(),
        model: adShortTextSchema.optional(),
        condition: adShortTextSchema.optional(),
        specifications: adSpecificationsSchema.optional(),
        imageUrls: adImageUrlsSchema.optional(),
        status: z.enum(["ACTIVE", "SOLD", "DRAFT", "ARCHIVED"]).optional(),
      }),
      req.body,
    );
    const { imageUrls, ...adFields } = b;
    const data = { ...adFields, specifications: b.specifications as any } as any;
    res.json({
      success: true,
      data: await prisma.$transaction(async (tx) => {
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
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({ where: { id } });
    if (!ad)
      return res.status(404).json({ success: false, message: "Ad not found" });
    if (ad.userId !== req.auth!.userId)
      return res.status(403).json({ success: false, message: "Forbidden" });
    await prisma.ad.delete({ where: { id } });
    res.json({ success: true, data: null, message: "Ad deleted" });
  } catch (e) {
    next(e);
  }
});
router.post("/:id/save", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!(await prisma.ad.findUnique({ where: { id }, select: { id: true } })))
      return res.status(404).json({ success: false, message: "Ad not found" });
    await prisma.savedAd.upsert({
      where: { userId_adId: { userId: req.auth!.userId, adId: id } },
      update: {},
      create: { userId: req.auth!.userId, adId: id },
    });
    res.json({ success: true, message: "Ad saved" });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/saved", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const saved = await prisma.savedAd.findUnique({
      where: { userId_adId: { userId: req.auth!.userId, adId: id } },
      select: { id: true },
    });
    res.json({ success: true, data: { saved: Boolean(saved) } });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id/save", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await prisma.savedAd.deleteMany({
      where: { userId: req.auth!.userId, adId: id },
    });
    res.json({ success: true, message: "Ad removed from saved" });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/promotions", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({ where: { id }, select: { id: true, userId: true } });
    if (!ad) return res.status(404).json({ success: false, message: "Ad not found" });
    if (ad.userId !== req.auth!.userId) return res.status(403).json({ success: false, message: "Forbidden" });

    const b = parseOrThrow(
      z.object({
        plan: z.enum(PROMOTION_PLAN_VALUES).default("top-1-month"),
      }),
      req.body,
    );

    const payment = await prisma.paymentTransaction.create({
      data: {
        userId: req.auth!.userId,
        adId: id,
        purpose: "AD_PROMOTION",
        amount: getPromotionPaymentAmountKobo(b.plan),
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
  } catch (e) {
    next(e);
  }
});

// Reviews endpoints
router.get("/:id/reviews", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const reviews = await prisma.review.findMany({
      where: { adId: id },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ success: true, data: reviews });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/reviews", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!(await prisma.ad.findUnique({ where: { id }, select: { id: true } })))
      return res.status(404).json({ success: false, message: "Ad not found" });
    
    const b = parseOrThrow(
      z.object({
        rating: z.number().int().min(1).max(5),
        text: z.string().min(1),
      }),
      req.body,
    );
    const existingReview = await prisma.review.findFirst({
      where: { adId: id, userId: req.auth!.userId },
      select: { id: true },
    });
    if (existingReview) return res.status(409).json({ success: false, message: "You have already reviewed this ad" });

    const review = await prisma.review.create({
      data: {
        adId: id,
        userId: req.auth!.userId,
        rating: b.rating,
        text: b.text,
      },
      include: { user: { select: { id: true, fullName: true } } },
    });
    res.status(201).json({ success: true, data: review });
  } catch (e) {
    next(e);
  }
});

// Report endpoint
router.post("/:id/report", requireAuth, requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!(await prisma.ad.findUnique({ where: { id }, select: { id: true } })))
      return res.status(404).json({ success: false, message: "Ad not found" });
    
    const b = parseOrThrow(
      z.object({
        reason: z.string().min(5),
      }),
      req.body,
    );
    const existingReport = await prisma.report.findFirst({
      where: { adId: id, userId: req.auth!.userId, status: "PENDING" },
      select: { id: true },
    });
    if (existingReport) return res.status(409).json({ success: false, message: "You have already reported this ad" });

    const report = await prisma.report.create({
      data: {
        adId: id,
        userId: req.auth!.userId,
        reason: b.reason,
      },
    });
    res.status(201).json({ success: true, message: "Report submitted", data: report });
  } catch (e) {
    next(e);
  }
});

// Mark unavailable endpoint
router.patch("/:id/mark-unavailable", requireAuth, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const ad = await prisma.ad.findUnique({ where: { id } });
    if (!ad)
      return res.status(404).json({ success: false, message: "Ad not found" });
    if (ad.userId !== req.auth!.userId)
      return res.status(403).json({ success: false, message: "Forbidden" });
    
    const updated = await prisma.ad.update({
      where: { id },
      data: { status: "ARCHIVED" },
      include: adInclude,
    });
    res.json({ success: true, message: "Ad marked unavailable", data: updated });
  } catch (e) {
    next(e);
  }
});

export default router;
