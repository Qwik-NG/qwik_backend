import crypto from "node:crypto";
import { type AdMetricEventType, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the error is a Prisma P2021 (table does not exist).
 * Used to gracefully degrade telemetry queries before migration is applied.
 */
function isTableMissingError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021"
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Time window in which the same viewer+subject+eventType is deduped (ms). */
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Derive an anonymous viewer fingerprint from IP and User-Agent.
 * SHA-256(ip + ":" + ua) truncated to 16 hex chars (64 bits).
 * Not reversible to a real identity; used only for short-window dedup.
 */
export function deriveViewerFingerprint(ip: string, userAgent: string): string {
  return crypto
    .createHash("sha256")
    .update(`${ip}:${userAgent}`)
    .digest("hex")
    .slice(0, 16);
}

// ---------------------------------------------------------------------------
// Event recording
// ---------------------------------------------------------------------------

export type RecordAdMetricInput = {
  /** Ad being viewed or clicked. Null for PROFILE_VISIT. */
  adId?: string | null;
  /** Seller who owns the ad or the profile being visited. */
  sellerId: string;
  eventType: AdMetricEventType;
  /** Authenticated viewer ID. Null for anonymous. */
  viewerId?: string | null;
  /** Anonymous fingerprint (deriveViewerFingerprint result). */
  viewerFingerprint?: string | null;
};

/**
 * Record a single telemetry event with time-windowed dedup.
 *
 * Dedup logic:
 * - If a viewer identity (viewerId or viewerFingerprint) is available, skip
 *   duplicate events for the same viewer + subject + eventType within 5 min.
 * - Fully anonymous events (no id, no fingerprint) are always recorded.
 *   These are rare; fingerprinting is best-effort for public endpoints.
 *
 * Returns true if a new event was created, false if deduped.
 * Returns false silently if the AdMetricEvent table does not yet exist.
 */
export async function recordAdMetricEvent(input: RecordAdMetricInput): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);

  // Build the subject filter. For PROFILE_VISIT adId is null so filter by seller.
  const subjectFilter = input.adId
    ? { adId: input.adId }
    : { adId: null as null, sellerId: input.sellerId };

  // Build the viewer identity filter. Prefer viewerId over fingerprint.
  const viewerFilter: Record<string, string> | null = input.viewerId
    ? { viewerId: input.viewerId }
    : input.viewerFingerprint
    ? { viewerFingerprint: input.viewerFingerprint }
    : null;

  if (viewerFilter) {
    let existing: { id: string } | null = null;
    try {
      existing = await prisma.adMetricEvent.findFirst({
        where: {
          ...subjectFilter,
          eventType: input.eventType,
          ...viewerFilter,
          createdAt: { gte: cutoff },
        },
        select: { id: true },
      });
    } catch (err) {
      if (isTableMissingError(err)) return false;
      throw err;
    }

    if (existing) return false;
  }

  try {
    await prisma.adMetricEvent.create({
      data: {
        adId: input.adId ?? null,
        sellerId: input.sellerId,
        eventType: input.eventType,
        viewerId: input.viewerId ?? null,
        viewerFingerprint: input.viewerFingerprint ?? null,
      },
    });
  } catch (err) {
    if (isTableMissingError(err)) return false;
    throw err;
  }

  return true;
}
// ---------------------------------------------------------------------------
// Aggregation queries
// ---------------------------------------------------------------------------

export type AdTelemetryMetrics = {
  adId: string;
  views: number;
  uniqueViewers: number;
  contactClicks: number;
};

/**
 * Batch-fetch view and contact-click metrics for a set of ad IDs.
 * Two queries only — no N+1, indexed on (adId, eventType, createdAt).
 * Gracefully returns zero metrics if the AdMetricEvent table does not yet exist.
 */
export async function getAdTelemetryMetrics(
  adIds: string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, AdTelemetryMetrics>> {
  if (adIds.length === 0) return new Map();

  const periodFilter = { gte: periodStart, lt: periodEnd };

  let countRows: { adId: string | null; eventType: AdMetricEventType; _count: { _all: number } }[];
  let viewEvents: { adId: string | null; viewerId: string | null; viewerFingerprint: string | null }[];

  try {
    [countRows, viewEvents] = await Promise.all([
      prisma.adMetricEvent.groupBy({
        by: ["adId", "eventType"],
        where: {
          adId: { in: adIds },
          eventType: { in: ["AD_VIEW", "CONTACT_CLICK"] },
          createdAt: periodFilter,
        },
        _count: { _all: true },
      }),
      prisma.adMetricEvent.findMany({
        where: {
          adId: { in: adIds },
          eventType: "AD_VIEW",
          createdAt: periodFilter,
        },
        select: {
          adId: true,
          viewerId: true,
          viewerFingerprint: true,
        },
      }),
    ]);
  } catch (err) {
    if (isTableMissingError(err)) {
      return new Map(adIds.map((id) => [id, { adId: id, views: 0, uniqueViewers: 0, contactClicks: 0 }]));
    }
    throw err;
  }

  // Compute unique viewers per ad (prefer viewerId; fall back to fingerprint)
  const uniqueViewersByAd = new Map<string, Set<string>>();
  for (const ev of viewEvents) {
    if (!ev.adId) continue;
    const viewerKey = ev.viewerId ?? ev.viewerFingerprint;
    if (!viewerKey) continue;
    let set = uniqueViewersByAd.get(ev.adId);
    if (!set) {
      set = new Set();
      uniqueViewersByAd.set(ev.adId, set);
    }
    set.add(viewerKey);
  }

  // Seed result map
  const result = new Map<string, AdTelemetryMetrics>(
    adIds.map((id) => [id, { adId: id, views: 0, uniqueViewers: 0, contactClicks: 0 }]),
  );

  for (const row of countRows) {
    if (!row.adId) continue;
    const entry = result.get(row.adId);
    if (!entry) continue;
    if (row.eventType === "AD_VIEW") entry.views = row._count._all;
    if (row.eventType === "CONTACT_CLICK") entry.contactClicks = row._count._all;
  }

  for (const [adId, viewers] of uniqueViewersByAd) {
    const entry = result.get(adId);
    if (entry) entry.uniqueViewers = viewers.size;
  }

  return result;
}

/**
 * Batch-fetch profile visit counts for a set of seller IDs.
 * Single grouped query — no N+1.
 * Gracefully returns zero counts if the AdMetricEvent table does not yet exist.
 */
export async function getSellerProfileVisits(
  sellerIds: string[],
  periodStart: Date,
  periodEnd: Date,
): Promise<Map<string, number>> {
  if (sellerIds.length === 0) return new Map();

  const rows = await prisma.adMetricEvent.groupBy({
    by: ["sellerId"],
    where: {
      sellerId: { in: sellerIds },
      eventType: "PROFILE_VISIT",
      adId: null,
      createdAt: { gte: periodStart, lt: periodEnd },
    },
    _count: { _all: true },
  }).catch((err: unknown) => {
    if (isTableMissingError(err)) return [] as { sellerId: string; _count: { _all: number } }[];
    throw err;
  });

  const result = new Map<string, number>(sellerIds.map((id) => [id, 0]));
  for (const row of rows) {
    result.set(row.sellerId, row._count._all);
  }
  return result;
}
