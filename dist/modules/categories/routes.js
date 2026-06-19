"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_perf_hooks_1 = require("node:perf_hooks");
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const router = (0, express_1.Router)();
const DEV_TIMING_ENABLED = process.env.NODE_ENV !== "production";
const CATEGORIES_CACHE_TTL_MS = 5 * 60000;
const CATEGORIES_STALE_TTL_MS = 10 * 60000;
const CATEGORIES_CACHE_CONTROL_HEADER = "public, max-age=300, stale-while-revalidate=600";
const categoriesListCache = new Map();
const categoryBySlugCache = new Map();
const categoryRefreshInFlight = new Set();
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
}
function runStaleRefresh(key, label, refresh) {
    if (categoryRefreshInFlight.has(key))
        return;
    categoryRefreshInFlight.add(key);
    void refresh()
        .catch((error) => {
        console.error(`[perf] stale-refresh-failed ${label}`, error);
    })
        .finally(() => {
        categoryRefreshInFlight.delete(key);
    });
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
const categorySelect = {
    id: true,
    name: true,
    slug: true,
    parentId: true,
    children: {
        select: {
            id: true,
            name: true,
            slug: true,
            parentId: true,
        },
        orderBy: {
            name: "asc",
        },
    },
};
router.get("/", async (req, res, next) => {
    const perf = startRoutePerf(req, "GET /api/categories");
    try {
        const cachedResponse = getCachedValue(categoriesListCache, "root");
        if (cachedResponse) {
            perf.cacheHit = true;
            perf.cacheState = cachedResponse.state;
            if (cachedResponse.state === "stale") {
                runStaleRefresh("root", "categories.list", async () => {
                    const categories = await prisma_1.prisma.category.findMany({
                        where: { parentId: null },
                        select: categorySelect,
                        orderBy: { name: "asc" },
                    });
                    const refreshed = { success: true, data: categories };
                    setCachedValue(categoriesListCache, "root", refreshed, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
                });
            }
            return sendTimedJson(perf, res, cachedResponse.value, 200, CATEGORIES_CACHE_CONTROL_HEADER);
        }
        const categories = await timePrisma(perf, "categories.list", () => prisma_1.prisma.category.findMany({
            where: { parentId: null },
            select: categorySelect,
            orderBy: { name: "asc" },
        }));
        const payload = { success: true, data: categories };
        setCachedValue(categoriesListCache, "root", payload, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
        return sendTimedJson(perf, res, payload, 200, CATEGORIES_CACHE_CONTROL_HEADER);
    }
    catch (e) {
        next(e);
    }
});
router.get("/:slug", async (req, res, next) => {
    const perf = startRoutePerf(req, "GET /api/categories/:slug");
    try {
        const slug = String(req.params.slug).trim().toLowerCase();
        const cachedResponse = getCachedValue(categoryBySlugCache, slug);
        if (cachedResponse) {
            perf.cacheHit = true;
            perf.cacheState = cachedResponse.state;
            if (cachedResponse.state === "stale") {
                runStaleRefresh(`slug:${slug}`, `categories.detail ${slug}`, async () => {
                    const category = await prisma_1.prisma.category.findUnique({
                        where: { slug },
                        select: {
                            ...categorySelect,
                            parent: {
                                select: {
                                    id: true,
                                    name: true,
                                    slug: true,
                                    parentId: true,
                                },
                            },
                        },
                    });
                    if (!category) {
                        categoryBySlugCache.delete(slug);
                        return;
                    }
                    const refreshed = { success: true, data: category };
                    setCachedValue(categoryBySlugCache, slug, refreshed, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
                });
            }
            return sendTimedJson(perf, res, cachedResponse.value, 200, CATEGORIES_CACHE_CONTROL_HEADER);
        }
        const category = await timePrisma(perf, "categories.detail", () => prisma_1.prisma.category.findUnique({
            where: { slug },
            select: {
                ...categorySelect,
                parent: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        parentId: true,
                    },
                },
            },
        }));
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }
        const payload = { success: true, data: category };
        setCachedValue(categoryBySlugCache, slug, payload, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
        return sendTimedJson(perf, res, payload, 200, CATEGORIES_CACHE_CONTROL_HEADER);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
