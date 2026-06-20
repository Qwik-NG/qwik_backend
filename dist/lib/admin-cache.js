"use strict";
/**
 * Admin endpoint caching utility
 * - Server-side only (never public)
 * - Short TTLs due to frequent admin mutations
 * - Automatic invalidation on related mutations
 * - No public cache headers added
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTLS = void 0;
exports.getCacheKey = getCacheKey;
exports.getCached = getCached;
exports.setCached = setCached;
exports.invalidateCache = invalidateCache;
exports.clearAdminCache = clearAdminCache;
exports.getCacheStats = getCacheStats;
const adminCache = new Map();
const stats = { hits: 0, misses: 0, invalidations: 0 };
exports.CACHE_TTLS = {
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
function getCacheKey(endpoint, params) {
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
function getCached(key) {
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
function setCached(key, data, ttl) {
    adminCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl,
    });
}
/**
 * Invalidate specific cache keys by pattern
 */
function invalidateCache(...patterns) {
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
function clearAdminCache() {
    const size = adminCache.size;
    adminCache.clear();
    stats.invalidations += size;
}
/**
 * Get cache statistics
 */
function getCacheStats() {
    return {
        ...stats,
        size: adminCache.size,
        hitRate: stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + "%" : "N/A",
    };
}
