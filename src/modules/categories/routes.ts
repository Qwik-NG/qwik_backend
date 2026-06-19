import { performance } from "node:perf_hooks";
import { Router, type Request, type Response } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();
const DEV_TIMING_ENABLED = process.env.NODE_ENV !== "production";
const CATEGORIES_CACHE_TTL_MS = 5 * 60_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type RoutePerf = {
  cacheHit: boolean;
  label: string;
  prismaMs: number;
  startMs: number;
};

const categoriesListCache = new Map<string, CacheEntry<{ success: true; data: unknown }>>();
const categoryBySlugCache = new Map<string, CacheEntry<{ success: true; data: unknown }>>();

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function startRoutePerf(req: Request, label: string): RoutePerf {
  return {
    cacheHit: false,
    label: `${label} ${req.originalUrl}`,
    prismaMs: 0,
    startMs: performance.now(),
  };
}

async function timePrisma<T>(perf: RoutePerf, operation: string, run: () => Promise<T>) {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    const duration = performance.now() - startedAt;
    perf.prismaMs += duration;
    if (DEV_TIMING_ENABLED) {
      console.log(`[perf] prisma ${operation} ${duration.toFixed(1)}ms`);
    }
  }
}

function sendTimedJson(perf: RoutePerf, res: Response, payload: { success: true; data: unknown }, status = 200) {
  const responseStartedAt = performance.now();
  res.status(status).json(payload);
  if (!DEV_TIMING_ENABLED) return;
  const responseMs = performance.now() - responseStartedAt;
  const totalMs = performance.now() - perf.startMs;
  console.log(
    `[perf] ${perf.label} total=${totalMs.toFixed(1)}ms prisma=${perf.prismaMs.toFixed(1)}ms response=${responseMs.toFixed(1)}ms cache=${perf.cacheHit ? "hit" : "miss"}`,
  );
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
      name: "asc" as const,
    },
  },
};

router.get("/", async (req, res, next) => {
  const perf = startRoutePerf(req, "GET /api/categories");
  try {
    const cachedResponse = getCachedValue(categoriesListCache, "root");
    if (cachedResponse) {
      perf.cacheHit = true;
      return sendTimedJson(perf, res, cachedResponse);
    }

    const categories = await timePrisma(perf, "categories.list", () =>
      prisma.category.findMany({
        where: { parentId: null },
        select: categorySelect,
        orderBy: { name: "asc" },
      }),
    );

    const payload = { success: true as const, data: categories };
    setCachedValue(categoriesListCache, "root", payload, CATEGORIES_CACHE_TTL_MS);
    return sendTimedJson(perf, res, payload);
  } catch (e) {
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
      return sendTimedJson(perf, res, cachedResponse);
    }

    const category = await timePrisma(perf, "categories.detail", () =>
      prisma.category.findUnique({
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
      }),
    );

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const payload = { success: true as const, data: category };
    setCachedValue(categoryBySlugCache, slug, payload, CATEGORIES_CACHE_TTL_MS);
    return sendTimedJson(perf, res, payload);
  } catch (e) {
    next(e);
  }
});

export default router;
