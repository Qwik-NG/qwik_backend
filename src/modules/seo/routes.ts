import { Router, type Request, type Response } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();

const STATIC_SITE_BASE_URL = "https://www.qwik.ng";
const PRODUCT_PATH_PREFIX = "/product-details";
const PRODUCTS_PER_SITEMAP = 10_000;
const SITEMAP_CACHE_FRESH_MS = 5 * 60_000;
const SITEMAP_CACHE_STALE_MS = 10 * 60_000;
const SITEMAP_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600";

const STATIC_URLS = ["/", "/search", "/login", "/signup"];

type CacheEntry<T> = {
  value: T;
  freshUntil: number;
  staleUntil: number;
};

const sitemapCountCache = new Map<string, CacheEntry<number>>();
const sitemapProductsCache = new Map<string, CacheEntry<Array<{ id: string; updatedAt: Date }>>>();
const sitemapStaticCache = new Map<string, CacheEntry<string>>();
const sitemapIndexCache = new Map<string, CacheEntry<string>>();
const sitemapRefreshInFlight = new Set<string>();

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string): { value: T; isStale: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (entry.staleUntil <= now) {
    cache.delete(key);
    return null;
  }

  if (entry.freshUntil > now) {
    return { value: entry.value, isStale: false };
  }

  return { value: entry.value, isStale: true };
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T) {
  const now = Date.now();
  cache.set(key, {
    value,
    freshUntil: now + SITEMAP_CACHE_FRESH_MS,
    staleUntil: now + SITEMAP_CACHE_STALE_MS,
  });
}

function runStaleRefresh(key: string, refresh: () => Promise<void>) {
  if (sitemapRefreshInFlight.has(key)) return;
  sitemapRefreshInFlight.add(key);
  void refresh()
    .catch((error) => {
      console.error("[sitemap] stale refresh failed", error);
    })
    .finally(() => {
      sitemapRefreshInFlight.delete(key);
    });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIsoDate(value: Date) {
  return value.toISOString();
}

function xmlResponse(res: Response, body: string) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", SITEMAP_CACHE_CONTROL);
  return res.status(200).send(body);
}

function getBackendBaseUrl(req: Request) {
  const host = req.get("host") || "localhost:4000";
  const derived = `${req.protocol}://${host}`;
  return derived.replace(/\/$/, "");
}

function staticUrl(pathname: string) {
  return `${STATIC_SITE_BASE_URL}${pathname}`;
}

async function getActiveProductCount() {
  const cacheKey = "active-count";
  const cached = getCachedValue(sitemapCountCache, cacheKey);
  if (cached) {
    if (cached.isStale) {
      runStaleRefresh(cacheKey, async () => {
        const refreshed = await prisma.ad.count({
          where: {
            status: "ACTIVE",
            user: { status: "ACTIVE" },
          },
        });
        setCachedValue(sitemapCountCache, cacheKey, refreshed);
      });
    }
    return cached.value;
  }

  const count = await prisma.ad.count({
    where: {
      status: "ACTIVE",
      user: { status: "ACTIVE" },
    },
  });
  setCachedValue(sitemapCountCache, cacheKey, count);
  return count;
}

async function getProductPageRows(page: number) {
  const cacheKey = `products:${page}`;
  const cached = getCachedValue(sitemapProductsCache, cacheKey);
  if (cached) {
    if (cached.isStale) {
      runStaleRefresh(cacheKey, async () => {
        const refreshed = await prisma.ad.findMany({
          where: {
            status: "ACTIVE",
            user: { status: "ACTIVE" },
          },
          select: {
            id: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * PRODUCTS_PER_SITEMAP,
          take: PRODUCTS_PER_SITEMAP,
        });
        setCachedValue(sitemapProductsCache, cacheKey, refreshed);
      });
    }
    return cached.value;
  }

  const rows = await prisma.ad.findMany({
    where: {
      status: "ACTIVE",
      user: { status: "ACTIVE" },
    },
    select: {
      id: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * PRODUCTS_PER_SITEMAP,
    take: PRODUCTS_PER_SITEMAP,
  });

  setCachedValue(sitemapProductsCache, cacheKey, rows);
  return rows;
}

function buildStaticSitemapXml() {
  const urls = STATIC_URLS.map((pathname) => {
    const loc = escapeXml(staticUrl(pathname));
    return `  <url><loc>${loc}</loc></url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

function buildProductsSitemapXml(rows: Array<{ id: string; updatedAt: Date }>) {
  const urls = rows.map((row) => {
    const loc = escapeXml(`${STATIC_SITE_BASE_URL}${PRODUCT_PATH_PREFIX}/${encodeURIComponent(row.id)}`);
    const lastmod = escapeXml(toIsoDate(row.updatedAt));
    return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

function buildSitemapIndexXml(input: {
  backendBaseUrl: string;
  productPages: number;
  staticUpdatedAt: Date;
}) {
  const entries: string[] = [];

  entries.push(
    `  <sitemap><loc>${escapeXml(`${input.backendBaseUrl}/api/sitemaps/static.xml`)}</loc><lastmod>${escapeXml(toIsoDate(input.staticUpdatedAt))}</lastmod></sitemap>`,
  );

  for (let page = 1; page <= input.productPages; page += 1) {
    entries.push(
      `  <sitemap><loc>${escapeXml(`${input.backendBaseUrl}/api/sitemaps/products-${page}.xml`)}</loc><lastmod>${escapeXml(toIsoDate(input.staticUpdatedAt))}</lastmod></sitemap>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>`;
}

export function clearSitemapCache() {
  sitemapCountCache.clear();
  sitemapProductsCache.clear();
  sitemapStaticCache.clear();
  sitemapIndexCache.clear();
}

router.get("/sitemap.xml", async (req, res, next) => {
  try {
    const backendBaseUrl = getBackendBaseUrl(req);
    const cacheKey = `index:${backendBaseUrl}`;
    const cached = getCachedValue(sitemapIndexCache, cacheKey);
    if (cached) {
      if (cached.isStale) {
        runStaleRefresh(cacheKey, async () => {
          const count = await getActiveProductCount();
          const productPages = Math.ceil(count / PRODUCTS_PER_SITEMAP);
          const refreshed = buildSitemapIndexXml({
            backendBaseUrl,
            productPages,
            staticUpdatedAt: new Date(),
          });
          setCachedValue(sitemapIndexCache, cacheKey, refreshed);
        });
      }
      return xmlResponse(res, cached.value);
    }

    const count = await getActiveProductCount();
    const productPages = Math.ceil(count / PRODUCTS_PER_SITEMAP);
    const xml = buildSitemapIndexXml({
      backendBaseUrl,
      productPages,
      staticUpdatedAt: new Date(),
    });
    setCachedValue(sitemapIndexCache, cacheKey, xml);
    return xmlResponse(res, xml);
  } catch (error) {
    next(error);
  }
});

router.get("/sitemaps/static.xml", async (_req, res, next) => {
  try {
    const cacheKey = "static";
    const cached = getCachedValue(sitemapStaticCache, cacheKey);
    if (cached) {
      if (cached.isStale) {
        runStaleRefresh(cacheKey, async () => {
          const refreshed = buildStaticSitemapXml();
          setCachedValue(sitemapStaticCache, cacheKey, refreshed);
        });
      }
      return xmlResponse(res, cached.value);
    }

    const xml = buildStaticSitemapXml();
    setCachedValue(sitemapStaticCache, cacheKey, xml);
    return xmlResponse(res, xml);
  } catch (error) {
    next(error);
  }
});

router.get("/sitemaps/products-:page.xml", async (req, res, next) => {
  try {
    const pageRaw = String(req.params.page || "").trim();
    const page = Number.parseInt(pageRaw, 10);
    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ success: false, message: "Invalid sitemap page" });
    }

    const rows = await getProductPageRows(page);
    const xml = buildProductsSitemapXml(rows);
    return xmlResponse(res, xml);
  } catch (error) {
    next(error);
  }
});

export default router;
