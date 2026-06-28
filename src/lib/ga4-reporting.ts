import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { env } from "../config/env";

type SourceBucket = "direct" | "googleSearch" | "facebook" | "instagram" | "tiktok" | "whatsapp" | "other";

export interface AdminTrafficMetrics {
  totalVisits: number;
  activeUsers: number;
  uniqueVisitors: number;
  topLandingPages: Array<{ path: string; count: number }>;
  pageTitleViews: Array<{ title: string; count: number }>;
  deviceBreakdown: {
    mobile: number;
    desktop: number;
    tablet: number;
  };
  sourceSummary: Record<SourceBucket, number>;
}

const DEFAULT_TIMEOUT_MS = 4_000;

function parseIntSafe(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLandingPath(value: string | undefined) {
  const raw = (value ?? "").trim();
  if (!raw || raw === "(not set)") return "/";
  return raw;
}

function normalizePageTitle(value: string | undefined) {
  const raw = (value ?? "").trim();
  if (!raw || raw === "(not set)") return "Untitled";
  return raw;
}

function getSourceBucket(sourceValue: string | undefined): SourceBucket {
  const source = (sourceValue ?? "").trim().toLowerCase();
  if (!source || source === "(direct)" || source === "direct") return "direct";
  if (source.includes("google")) return "googleSearch";
  if (source.includes("facebook") || source === "fb") return "facebook";
  if (source.includes("instagram") || source === "ig") return "instagram";
  if (source.includes("tiktok")) return "tiktok";
  if (source.includes("whatsapp") || source.includes("wa.me")) return "whatsapp";
  return "other";
}

function createClient() {
  if (env.googleServiceAccountJson) {
    const parsedCredentials = JSON.parse(env.googleServiceAccountJson);
    if (typeof parsedCredentials?.private_key === "string") {
      parsedCredentials.private_key = parsedCredentials.private_key.replace(/\\n/g, "\n");
    }
    return new BetaAnalyticsDataClient({ credentials: parsedCredentials });
  }

  if (env.googleApplicationCredentials) {
    return new BetaAnalyticsDataClient({ keyFilename: env.googleApplicationCredentials });
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("GA4 reporting timed out")), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function fetchGa4TrafficMetrics(): Promise<AdminTrafficMetrics | null> {
  if (!env.ga4ReportingEnabled || !env.ga4PropertyId) {
    return null;
  }

  const client = createClient();
  if (!client) {
    return null;
  }

  const property = `properties/${env.ga4PropertyId}`;
  const dateRanges = [{ startDate: "30daysAgo", endDate: "today" }];

  try {
    const reportPromise = Promise.all([
      client.runReport({
        property,
        dateRanges,
        metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "totalUsers" }],
      }),
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8,
      }),
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }],
      }),
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 12,
      }),
      client.runReport({
        property,
        dateRanges,
        dimensions: [{ name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 8,
      }),
    ]);

    const [totalsResult, landingPagesResult, deviceResult, sourcesResult, pageTitleResult] = await withTimeout(
      reportPromise,
      env.ga4TimeoutMs || DEFAULT_TIMEOUT_MS,
    );

    const totalsRow = totalsResult[0].rows?.[0];
    const totalVisits = parseIntSafe(totalsRow?.metricValues?.[0]?.value);
    const activeUsers = parseIntSafe(totalsRow?.metricValues?.[1]?.value);
    const uniqueVisitors = parseIntSafe(totalsRow?.metricValues?.[2]?.value);

    const topLandingPages = (landingPagesResult[0].rows ?? []).map((row) => ({
      path: normalizeLandingPath(row.dimensionValues?.[0]?.value),
      count: parseIntSafe(row.metricValues?.[0]?.value),
    }));

    const pageTitleViews = (pageTitleResult[0].rows ?? []).map((row) => ({
      title: normalizePageTitle(row.dimensionValues?.[0]?.value),
      count: parseIntSafe(row.metricValues?.[0]?.value),
    }));

    const deviceBreakdown = {
      mobile: 0,
      desktop: 0,
      tablet: 0,
    };

    for (const row of deviceResult[0].rows ?? []) {
      const device = (row.dimensionValues?.[0]?.value ?? "").toLowerCase();
      const count = parseIntSafe(row.metricValues?.[0]?.value);
      if (device === "mobile") {
        deviceBreakdown.mobile += count;
      } else if (device === "tablet") {
        deviceBreakdown.tablet += count;
      } else {
        deviceBreakdown.desktop += count;
      }
    }

    const sourceSummary: Record<SourceBucket, number> = {
      direct: 0,
      googleSearch: 0,
      facebook: 0,
      instagram: 0,
      tiktok: 0,
      whatsapp: 0,
      other: 0,
    };

    for (const row of sourcesResult[0].rows ?? []) {
      const source = row.dimensionValues?.[0]?.value;
      const count = parseIntSafe(row.metricValues?.[0]?.value);
      const bucket = getSourceBucket(source);
      sourceSummary[bucket] += count;
    }

    return {
      totalVisits,
      activeUsers,
      uniqueVisitors,
      topLandingPages,
      pageTitleViews,
      deviceBreakdown,
      sourceSummary,
    };
  } catch (error) {
    console.warn("GA4 reporting fetch failed", error instanceof Error ? error.message : error);
    return null;
  }
}