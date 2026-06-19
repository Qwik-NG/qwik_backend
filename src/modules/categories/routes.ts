import { performance } from "node:perf_hooks";
import { Router, type Request, type Response } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();
const DEV_TIMING_ENABLED = process.env.NODE_ENV !== "production";
const CATEGORIES_CACHE_TTL_MS = 5 * 60_000;
const CATEGORIES_STALE_TTL_MS = 10 * 60_000;
const CATEGORIES_CACHE_CONTROL_HEADER = "public, max-age=300, stale-while-revalidate=600";

type CacheEntry<T> = {
  freshUntil: number;
  staleUntil: number;
  value: T;
};

type CacheState = "miss" | "fresh" | "stale";

type RoutePerf = {
  cacheHit: boolean;
  cacheState: CacheState;
  label: string;
  prismaMs: number;
  startMs: number;
};

const categoriesListCache = new Map<string, CacheEntry<{ success: true; data: unknown }>>();
const categoryBySlugCache = new Map<string, CacheEntry<{ success: true; data: unknown }>>();
const categoryRefreshInFlight = new Set<string>();

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): { state: Exclude<CacheState, "miss">; value: T } | null {
  const entry = cache.get(key);
  if (!entry) return null;
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

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, freshTtlMs: number, staleTtlMs: number) {
  const now = Date.now();
  cache.set(key, { value, freshUntil: now + freshTtlMs, staleUntil: now + staleTtlMs });
}

function runStaleRefresh(key: string, label: string, refresh: () => Promise<void>) {
  if (categoryRefreshInFlight.has(key)) return;
  categoryRefreshInFlight.add(key);
  void refresh()
    .catch((error) => {
      console.error(`[perf] stale-refresh-failed ${label}`, error);
    })
    .finally(() => {
      categoryRefreshInFlight.delete(key);
    });
}

function startRoutePerf(req: Request, label: string): RoutePerf {
  return {
    cacheHit: false,
    cacheState: "miss",
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

function sendTimedJson(
  perf: RoutePerf,
  res: Response,
  payload: { success: true; data: unknown },
  status = 200,
  cacheControl?: string,
) {
  if (cacheControl) {
    res.setHeader("Cache-Control", cacheControl);
  }
  const responseStartedAt = performance.now();
  res.status(status).json(payload);
  if (!DEV_TIMING_ENABLED) return;
  const responseMs = performance.now() - responseStartedAt;
  const totalMs = performance.now() - perf.startMs;
  console.log(
    `[perf] ${perf.label} total=${totalMs.toFixed(1)}ms prisma=${perf.prismaMs.toFixed(1)}ms response=${responseMs.toFixed(1)}ms cache=${perf.cacheState}`,
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
      perf.cacheState = cachedResponse.state;
      if (cachedResponse.state === "stale") {
        runStaleRefresh("root", "categories.list", async () => {
          const categories = await prisma.category.findMany({
            where: { parentId: null },
            select: categorySelect,
            orderBy: { name: "asc" },
          });
          const refreshed = { success: true as const, data: categories };
          setCachedValue(categoriesListCache, "root", refreshed, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
        });
      }
      return sendTimedJson(perf, res, cachedResponse.value, 200, CATEGORIES_CACHE_CONTROL_HEADER);
    }

    const categories = await timePrisma(perf, "categories.list", () =>
      prisma.category.findMany({
        where: { parentId: null },
        select: categorySelect,
        orderBy: { name: "asc" },
      }),
    );

    const payload = { success: true as const, data: categories };
    setCachedValue(categoriesListCache, "root", payload, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
    return sendTimedJson(perf, res, payload, 200, CATEGORIES_CACHE_CONTROL_HEADER);
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
      perf.cacheState = cachedResponse.state;
      if (cachedResponse.state === "stale") {
        runStaleRefresh(`slug:${slug}`, `categories.detail ${slug}`, async () => {
          const category = await prisma.category.findUnique({
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
          const refreshed = { success: true as const, data: category };
          setCachedValue(categoryBySlugCache, slug, refreshed, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
        });
      }
      return sendTimedJson(perf, res, cachedResponse.value, 200, CATEGORIES_CACHE_CONTROL_HEADER);
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
    setCachedValue(categoryBySlugCache, slug, payload, CATEGORIES_CACHE_TTL_MS, CATEGORIES_STALE_TTL_MS);
    return sendTimedJson(perf, res, payload, 200, CATEGORIES_CACHE_CONTROL_HEADER);
  } catch (e) {
    next(e);
  }
});

export default router;
