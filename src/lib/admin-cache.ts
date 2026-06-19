/**
 * Admin endpoint caching utility
 * - Server-side only (never public)
 * - Short TTLs due to frequent admin mutations
 * - Automatic invalidation on related mutations
 * - No public cache headers added
 */

interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number; // in ms
}

interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
}

const adminCache = new Map<string, CacheEntry>();
const stats: CacheStats = { hits: 0, misses: 0, invalidations: 0 };

export const CACHE_TTLS = {
  STATS: 30 * 1000, // 30 seconds
  USERS: 45 * 1000, // 45 seconds
  ADS: 45 * 1000, // 45 seconds
  REPORTS: 30 * 1000, // 30 seconds
  REVIEWS: 45 * 1000, // 45 seconds
  VERIFICATIONS: 60 * 1000, // 60 seconds (less frequent changes)
  AUDIT_LOG: 10 * 1000, // 10 seconds (must be fresh for audit trail)
};

/**
 * Generate cache key from endpoint and query params
 */
export function getCacheKey(endpoint: string, params?: Record<string, any>): string {
  if (!params || Object.keys(params).length === 0) {
    return endpoint;
  }

  const sortedParams = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k])}`)
    .join("&");

  return `${endpoint}?${sortedParams}`;
}

/**
 * Get cached data if still valid
 */
export function getCached(key: string): any | null {
  const entry = adminCache.get(key);
  if (!entry) {
    stats.misses++;
    return null;
  }

  const isExpired = Date.now() - entry.timestamp > entry.ttl;
  if (isExpired) {
    adminCache.delete(key);
    stats.misses++;
    return null;
  }

  stats.hits++;
  return entry.data;
}

/**
 * Set cache entry with TTL
 */
export function setCached(key: string, data: any, ttl: number): void {
  adminCache.set(key, {
    data,
    timestamp: Date.now(),
    ttl,
  });
}

/**
 * Invalidate specific cache keys by pattern
 */
export function invalidateCache(...patterns: string[]): void {
  let count = 0;
  for (const [key] of adminCache.entries()) {
    if (patterns.some((p) => key.startsWith(p))) {
      adminCache.delete(key);
      count++;
    }
  }
  stats.invalidations += count;
}

/**
 * Invalidate all admin caches
 */
export function clearAdminCache(): void {
  const size = adminCache.size;
  adminCache.clear();
  stats.invalidations += size;
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    ...stats,
    size: adminCache.size,
    hitRate: stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + "%" : "N/A",
  };
}
