"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_perf_hooks_1 = require("node:perf_hooks");
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const realtime_1 = require("../../lib/realtime");
const validation_1 = require("../../utils/validation");
const auth_1 = require("../../middleware/auth");
const paymentPricing_1 = require("../../utils/paymentPricing");
const notifications_1 = require("../../utils/notifications");
const router = (0, express_1.Router)();
const DEV_TIMING_ENABLED = process.env.NODE_ENV !== "production";
const ADS_LIST_CACHE_TTL_MS = 30000;
const AD_DETAILS_CACHE_TTL_MS = 30000;
const ADS_LIST_STALE_TTL_MS = 60000;
const AD_DETAILS_STALE_TTL_MS = 60000;
const ADS_COUNT_STALE_TTL_MS = 60000;
const ADS_CACHE_CONTROL_HEADER = "public, max-age=30, stale-while-revalidate=60";
const MAX_CACHE_ENTRIES = 100;
const adsListCache = new Map();
const adDetailsCache = new Map();
const adsCountCache = new Map();
const adsListRefreshInFlight = new Set();
const adDetailsRefreshInFlight = new Set();
const adsCountRefreshInFlight = new Set();
function getCachedValue(cache, key) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    const now = Date.now();
    if (entry.staleUntil <= now) {
        cache.delete(key);
        return null;
    }
    if (entry.freshUntil > now) {
        return { state: "fresh", value: entry.value };
    }
    return { state: "stale", value: entry.value };
}
function setCachedValue(cache, key, value, freshTtlMs, staleTtlMs) {
    const now = Date.now();
    cache.set(key, { value, freshUntil: now + freshTtlMs, staleUntil: now + staleTtlMs });
    if (cache.size <= MAX_CACHE_ENTRIES)
        return;
    const oldestKey = cache.keys().next().value;
    if (oldestKey)
        cache.delete(oldestKey);
}
function runStaleRefresh(inFlight, key, label, refresh) {
    if (inFlight.has(key))
        return;
    inFlight.add(key);
    void refresh()
        .catch((error) => {
        console.error(`[perf] stale-refresh-failed ${label}`, error);
    })
        .finally(() => {
        inFlight.delete(key);
    });
}
function clearAdCaches(adId) {
    adsListCache.clear();
    adsCountCache.clear();
    if (adId) {
        adDetailsCache.delete(adId);
        return;
    }
    adDetailsCache.clear();
}
function startRoutePerf(req, label) {
    return {
        cacheHit: false,
        cacheState: "miss",
        label: `${label} ${req.originalUrl}`,
        prismaMs: 0,
        startMs: node_perf_hooks_1.performance.now(),
    };
}
async function timePrisma(perf, operation, run) {
    const startedAt = node_perf_hooks_1.performance.now();
    try {
        return await run();
    }
    finally {
        const duration = node_perf_hooks_1.performance.now() - startedAt;
        perf.prismaMs += duration;
        if (DEV_TIMING_ENABLED) {
            console.log(`[perf] prisma ${operation} ${duration.toFixed(1)}ms`);
        }
    }
}
function sendTimedJson(perf, res, payload, status = 200, cacheControl) {
    if (cacheControl) {
        res.setHeader("Cache-Control", cacheControl);
    }
    const responseStartedAt = node_perf_hooks_1.performance.now();
    res.status(status).json(payload);
    if (!DEV_TIMING_ENABLED)
        return;
    const responseMs = node_perf_hooks_1.performance.now() - responseStartedAt;
    const totalMs = node_perf_hooks_1.performance.now() - perf.startMs;
    console.log(`[perf] ${perf.label} total=${totalMs.toFixed(1)}ms prisma=${perf.prismaMs.toFixed(1)}ms response=${responseMs.toFixed(1)}ms cache=${perf.cacheState}`);
}
const verificationApplicationsSelect = {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, status: true, paymentStatus: true },
};
const adListSellerSelect = {
    id: true,
    fullName: true,
    location: true,
    locationState: true,
    locationArea: true,
    role: true,
    profile: {
        select: {
            avatarUrl: true,
        },
    },
    verificationApplications: verificationApplicationsSelect,
};
const adDetailSellerSelect = {
    id: true,
    fullName: true,
    phone: true,
    location: true,
    locationState: true,
    locationArea: true,
    role: true,
    createdAt: true,
    profile: {
        select: {
            bio: true,
            avatarUrl: true,
        },
    },
    verificationApplications: verificationApplicationsSelect,
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
const optionalBooleanQuery = zod_1.z.preprocess((value) => {
    if (value === undefined || value === "")
        return undefined;
    if (Array.isArray(value))
        return value[0];
    return value;
}, zod_1.z.coerce.boolean().optional());
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
    includeTotal: optionalBooleanQuery,
});
const adListSelect = {
    id: true,
    title: true,
    description: true,
    price: true,
    location: true,
    locationState: true,
    locationArea: true,
    brand: true,
    model: true,
    condition: true,
    status: true,
    isPromoted: true,
    createdAt: true,
    category: {
        select: {
            id: true,
            name: true,
            slug: true,
            parentId: true,
        },
    },
    images: {
        take: 1,
        orderBy: { position: "asc" },
        select: {
            id: true,
            url: true,
            position: true,
        },
    },
    user: { select: adListSellerSelect },
};
const adDetailSelect = {
    id: true,
    userId: true,
    categoryId: true,
    title: true,
    description: true,
    price: true,
    location: true,
    locationState: true,
    locationArea: true,
    brand: true,
    model: true,
    condition: true,
    specifications: true,
    status: true,
    isPromoted: true,
    createdAt: true,
    updatedAt: true,
    category: {
        select: {
            id: true,
            name: true,
            slug: true,
            parentId: true,
        },
    },
    images: {
        orderBy: { position: "asc" },
        select: {
            id: true,
            url: true,
            position: true,
        },
    },
    user: { select: adDetailSellerSelect },
};
function asArray(value) {
    return Array.isArray(value) ? value : [];
}
function toJsonObject(value) {
    return value && typeof value === "object" ? value : {};
}
function buildWhereClause(input) {
    const params = [];
    const clauses = [];
    params.push("ACTIVE");
    clauses.push(`a."status" = CAST($${params.length}::text AS "AdStatus")`);
    if (input.search) {
        const term = `%${input.search}%`;
        params.push(term);
        const titlePlaceholder = `$${params.length}`;
        params.push(term);
        const descPlaceholder = `$${params.length}`;
        clauses.push(`(a."title" ILIKE ${titlePlaceholder} OR a."description" ILIKE ${descPlaceholder})`);
    }
    if (input.locationTerms.length > 0) {
        const locationOrs = [];
        for (const term of input.locationTerms) {
            const wildcard = `%${term}%`;
            params.push(wildcard);
            const locationPlaceholder = `$${params.length}`;
            params.push(wildcard);
            const statePlaceholder = `$${params.length}`;
            locationOrs.push(`a."location" ILIKE ${locationPlaceholder}`);
            locationOrs.push(`a."locationState" ILIKE ${statePlaceholder}`);
        }
        clauses.push(`(${locationOrs.join(" OR ")})`);
    }
    if (input.categoryIds && input.categoryIds.length > 0) {
        const placeholders = input.categoryIds.map((id) => {
            params.push(id);
            return `$${params.length}`;
        });
        clauses.push(`a."categoryId" IN (${placeholders.join(",")})`);
    }
    if (input.minPrice !== undefined) {
        params.push(input.minPrice);
        clauses.push(`a."price" >= $${params.length}`);
    }
    if (input.maxPrice !== undefined) {
        params.push(input.maxPrice);
        clauses.push(`a."price" <= $${params.length}`);
    }
    if (input.condition) {
        params.push(`%${input.condition}%`);
        clauses.push(`a."condition" ILIKE $${params.length}`);
    }
    if (input.brand) {
        params.push(`%${input.brand}%`);
        clauses.push(`a."brand" ILIKE $${params.length}`);
    }
    return {
        whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
        params,
    };
}
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
async function buildAdsListPayload(query, perf) {
    const timed = (operation, run) => (perf ? timePrisma(perf, operation, run) : run());
    const { page, pageSize, minPrice, maxPrice, imagesLimit, sort } = query;
    const search = (query.q || query.search).trim();
    const location = query.location.trim();
    const categoryId = query.categoryId.trim();
    const category = query.category.trim();
    const subcategory = query.subcategory.trim();
    const condition = query.condition.trim();
    const brand = query.brand.trim();
    const includeTotal = query.includeTotal === true;
    const locationTerms = getLocationSearchTerms(location);
    const categoryIds = await timed("getCategoryIds", () => getCategoryIds({
        categoryId: categoryId || undefined,
        category: category || undefined,
        subcategory: subcategory || undefined,
    }));
    const { whereSql, params } = buildWhereClause({
        search,
        locationTerms,
        categoryIds,
        minPrice,
        maxPrice,
        condition,
        brand,
    });
    const sortSql = sort === "price-low" ? `a."price" ASC` : sort === "price-high" ? `a."price" DESC` : `a."createdAt" DESC`;
    const listParams = [...params];
    listParams.push(Math.max(1, imagesLimit ?? 1));
    const imageLimitPlaceholder = `$${listParams.length}`;
    listParams.push(pageSize);
    const pageSizePlaceholder = `$${listParams.length}`;
    listParams.push((page - 1) * pageSize);
    const offsetPlaceholder = `$${listParams.length}`;
    const ads = await timed("ads.list", () => prisma_1.prisma.$queryRawUnsafe(`
      SELECT
        a."id",
        a."title",
        a."description",
        a."price",
        a."location",
        a."locationState",
        a."locationArea",
        a."brand",
        a."model",
        a."condition",
        a."status"::text AS "status",
        a."isPromoted",
        a."createdAt",
        jsonb_build_object(
          'id', c."id",
          'name', c."name",
          'slug', c."slug",
          'parentId', c."parentId"
        ) AS "category",
        COALESCE(img."images", '[]'::jsonb) AS "images",
        jsonb_build_object(
          'id', u."id",
          'fullName', u."fullName",
          'location', u."location",
          'locationState', u."locationState",
          'locationArea', u."locationArea",
          'role', u."role"::text,
          'profile', jsonb_build_object('avatarUrl', up."avatarUrl"),
          'verificationApplications', CASE WHEN va."id" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id', va."id", 'status', va."status"::text, 'paymentStatus', va."paymentStatus"::text)) END
        ) AS "user"
      FROM "Ad" a
      JOIN "Category" c ON c."id" = a."categoryId"
      JOIN "User" u ON u."id" = a."userId"
      LEFT JOIN "UserProfile" up ON up."userId" = u."id"
      LEFT JOIN LATERAL (
        SELECT v."id", v."status", v."paymentStatus"
        FROM "VerificationApplication" v
        WHERE v."userId" = u."id"
        ORDER BY v."createdAt" DESC
        LIMIT 1
      ) va ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object('id', i."id", 'url', i."url", 'position', i."position")
            ORDER BY i."position" ASC
          ),
          '[]'::jsonb
        ) AS "images"
        FROM (
          SELECT i."id", i."url", i."position"
          FROM "AdImage" i
          WHERE i."adId" = a."id"
          ORDER BY i."position" ASC
          LIMIT ${imageLimitPlaceholder}
        ) i
      ) img ON true
      ${whereSql}
      ORDER BY ${sortSql}
      LIMIT ${pageSizePlaceholder}
      OFFSET ${offsetPlaceholder}
      `, ...listParams));
    let total;
    if (includeTotal) {
        const countCacheKey = JSON.stringify(params);
        const cachedCount = getCachedValue(adsCountCache, countCacheKey);
        if (cachedCount) {
            total = cachedCount.value;
            if (cachedCount.state === "stale") {
                runStaleRefresh(adsCountRefreshInFlight, countCacheKey, `ads.count ${countCacheKey}`, async () => {
                    const countRows = await prisma_1.prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS total FROM "Ad" a ${whereSql}`, ...params);
                    const refreshedTotal = Number(countRows[0]?.total ?? 0);
                    setCachedValue(adsCountCache, countCacheKey, refreshedTotal, ADS_LIST_CACHE_TTL_MS, ADS_COUNT_STALE_TTL_MS);
                });
            }
        }
        else {
            const countRows = await timed("ads.count", () => prisma_1.prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS total FROM "Ad" a ${whereSql}`, ...params));
            total = Number(countRows[0]?.total ?? 0);
            setCachedValue(adsCountCache, countCacheKey, total, ADS_LIST_CACHE_TTL_MS, ADS_COUNT_STALE_TTL_MS);
        }
    }
    const normalizedAds = ads.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        price: row.price,
        location: row.location,
        locationState: row.locationState,
        locationArea: row.locationArea,
        brand: row.brand,
        model: row.model,
        condition: row.condition,
        status: row.status,
        isPromoted: row.isPromoted,
        createdAt: row.createdAt,
        category: toJsonObject(row.category),
        images: asArray(row.images),
        user: toJsonObject(row.user),
    }));
    return {
        success: true,
        data: normalizedAds,
        meta: { page, pageSize, ...(total !== undefined ? { total } : {}) },
    };
}
async function buildAdDetailsPayload(id, perf) {
    const rows = perf
        ? await timePrisma(perf, "ads.detail", () => prisma_1.prisma.$queryRawUnsafe(`
          SELECT
            a."id",
            a."userId",
            a."categoryId",
            a."title",
            a."description",
            a."price",
            a."location",
            a."locationState",
            a."locationArea",
            a."brand",
            a."model",
            a."condition",
            a."specifications",
            a."status"::text AS "status",
            a."isPromoted",
            a."createdAt",
            a."updatedAt",
            jsonb_build_object(
              'id', c."id",
              'name', c."name",
              'slug', c."slug",
              'parentId', c."parentId"
            ) AS "category",
            COALESCE(img."images", '[]'::jsonb) AS "images",
            jsonb_build_object(
              'id', u."id",
              'fullName', u."fullName",
              'phone', u."phone",
              'location', u."location",
              'locationState', u."locationState",
              'locationArea', u."locationArea",
              'role', u."role"::text,
              'createdAt', u."createdAt",
              'profile', jsonb_build_object('bio', up."bio", 'avatarUrl', up."avatarUrl"),
              'verificationApplications', CASE WHEN va."id" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id', va."id", 'status', va."status"::text, 'paymentStatus', va."paymentStatus"::text)) END
            ) AS "user"
          FROM "Ad" a
          JOIN "Category" c ON c."id" = a."categoryId"
          JOIN "User" u ON u."id" = a."userId"
          LEFT JOIN "UserProfile" up ON up."userId" = u."id"
          LEFT JOIN LATERAL (
            SELECT v."id", v."status", v."paymentStatus"
            FROM "VerificationApplication" v
            WHERE v."userId" = u."id"
            ORDER BY v."createdAt" DESC
            LIMIT 1
          ) va ON true
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object('id', i."id", 'url', i."url", 'position', i."position")
                ORDER BY i."position" ASC
              ),
              '[]'::jsonb
            ) AS "images"
            FROM "AdImage" i
            WHERE i."adId" = a."id"
          ) img ON true
          WHERE a."id" = $1
          LIMIT 1
          `, id))
        : await prisma_1.prisma.$queryRawUnsafe(`
        SELECT
          a."id",
          a."userId",
          a."categoryId",
          a."title",
          a."description",
          a."price",
          a."location",
          a."locationState",
          a."locationArea",
          a."brand",
          a."model",
          a."condition",
          a."specifications",
          a."status"::text AS "status",
          a."isPromoted",
          a."createdAt",
          a."updatedAt",
          jsonb_build_object('id', c."id", 'name', c."name", 'slug', c."slug", 'parentId', c."parentId") AS "category",
          COALESCE(img."images", '[]'::jsonb) AS "images",
          jsonb_build_object(
            'id', u."id",
            'fullName', u."fullName",
            'phone', u."phone",
            'location', u."location",
            'locationState', u."locationState",
            'locationArea', u."locationArea",
            'role', u."role"::text,
            'createdAt', u."createdAt",
            'profile', jsonb_build_object('bio', up."bio", 'avatarUrl', up."avatarUrl"),
            'verificationApplications', CASE WHEN va."id" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('id', va."id", 'status', va."status"::text, 'paymentStatus', va."paymentStatus"::text)) END
          ) AS "user"
        FROM "Ad" a
        JOIN "Category" c ON c."id" = a."categoryId"
        JOIN "User" u ON u."id" = a."userId"
        LEFT JOIN "UserProfile" up ON up."userId" = u."id"
        LEFT JOIN LATERAL (
          SELECT v."id", v."status", v."paymentStatus"
          FROM "VerificationApplication" v
          WHERE v."userId" = u."id"
          ORDER BY v."createdAt" DESC
          LIMIT 1
        ) va ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object('id', i."id", 'url', i."url", 'position', i."position")
              ORDER BY i."position" ASC
            ),
            '[]'::jsonb
          ) AS "images"
          FROM "AdImage" i
          WHERE i."adId" = a."id"
        ) img ON true
        WHERE a."id" = $1
        LIMIT 1
        `, id);
    const ad = rows[0];
    if (!ad)
        return null;
    return {
        success: true,
        data: {
            id: ad.id,
            userId: ad.userId,
            categoryId: ad.categoryId,
            title: ad.title,
            description: ad.description,
            price: ad.price,
            location: ad.location,
            locationState: ad.locationState,
            locationArea: ad.locationArea,
            brand: ad.brand,
            model: ad.model,
            condition: ad.condition,
            specifications: ad.specifications,
            status: ad.status,
            isPromoted: ad.isPromoted,
            createdAt: ad.createdAt,
            updatedAt: ad.updatedAt,
            category: toJsonObject(ad.category),
            images: asArray(ad.images),
            user: toJsonObject(ad.user),
        },
    };
}
router.get("/", async (req, res, next) => {
    const perf = startRoutePerf(req, "GET /api/ads");
    try {
        const query = (0, validation_1.parseOrThrow)(adsListQuerySchema, req.query);
        const cacheKey = req.originalUrl;
        const cachedResponse = getCachedValue(adsListCache, cacheKey);
        if (cachedResponse) {
            perf.cacheHit = true;
            perf.cacheState = cachedResponse.state;
            if (cachedResponse.state === "stale") {
                runStaleRefresh(adsListRefreshInFlight, cacheKey, `ads.list ${cacheKey}`, async () => {
                    const refreshed = await buildAdsListPayload(query);
                    setCachedValue(adsListCache, cacheKey, refreshed, ADS_LIST_CACHE_TTL_MS, ADS_LIST_STALE_TTL_MS);
                });
            }
            return sendTimedJson(perf, res, cachedResponse.value, 200, ADS_CACHE_CONTROL_HEADER);
        }
        perf.cacheState = "miss";
        const payload = await buildAdsListPayload(query, perf);
        setCachedValue(adsListCache, cacheKey, payload, ADS_LIST_CACHE_TTL_MS, ADS_LIST_STALE_TTL_MS);
        return sendTimedJson(perf, res, payload, 200, ADS_CACHE_CONTROL_HEADER);
    }
    catch (e) {
        next(e);
    }
});
router.get("/:id", async (req, res, next) => {
    const perf = startRoutePerf(req, "GET /api/ads/:id");
    try {
        const id = String(req.params.id);
        const cachedResponse = getCachedValue(adDetailsCache, id);
        if (cachedResponse) {
            perf.cacheHit = true;
            perf.cacheState = cachedResponse.state;
            if (cachedResponse.state === "stale") {
                runStaleRefresh(adDetailsRefreshInFlight, id, `ads.detail ${id}`, async () => {
                    const refreshed = await buildAdDetailsPayload(id);
                    if (refreshed) {
                        setCachedValue(adDetailsCache, id, refreshed, AD_DETAILS_CACHE_TTL_MS, AD_DETAILS_STALE_TTL_MS);
                    }
                    else {
                        adDetailsCache.delete(id);
                    }
                });
            }
            return sendTimedJson(perf, res, cachedResponse.value, 200, ADS_CACHE_CONTROL_HEADER);
        }
        perf.cacheState = "miss";
        const payload = await buildAdDetailsPayload(id, perf);
        if (!payload)
            return res.status(404).json({ success: false, message: "Ad not found" });
        setCachedValue(adDetailsCache, id, payload, AD_DETAILS_CACHE_TTL_MS, AD_DETAILS_STALE_TTL_MS);
        return sendTimedJson(perf, res, payload, 200, ADS_CACHE_CONTROL_HEADER);
    }
    catch (e) {
        next(e);
    }
});
router.post("/", auth_1.requireAuth, auth_1.requireActiveUser, auth_1.requireVerifiedEmail, async (req, res, next) => {
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
            select: adDetailSelect,
        });
        clearAdCaches(ad.id);
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
                    select: adDetailSelect,
                });
            }),
        });
        clearAdCaches(id);
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
        clearAdCaches(id);
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
            select: adDetailSelect,
        });
        clearAdCaches(id);
        res.json({ success: true, message: "Ad marked unavailable", data: updated });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
