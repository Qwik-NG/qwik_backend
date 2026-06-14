"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRateLimiter = createRateLimiter;
const ratelimit_1 = require("@upstash/ratelimit");
const redis_1 = require("@upstash/redis");
const express_rate_limit_1 = require("express-rate-limit");
const env_1 = require("../config/env");
let redisClient;
function getRedisClient() {
    if (redisClient !== undefined)
        return redisClient;
    if (!env_1.env.upstashRedisRestUrl || !env_1.env.upstashRedisRestToken) {
        redisClient = null;
        return redisClient;
    }
    redisClient = new redis_1.Redis({
        url: env_1.env.upstashRedisRestUrl,
        token: env_1.env.upstashRedisRestToken,
    });
    return redisClient;
}
function clientIdentifier(req) {
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
function windowLabel(windowMs) {
    if (windowMs % 60000 === 0)
        return `${windowMs / 60000} m`;
    if (windowMs % 1000 === 0)
        return `${windowMs / 1000} s`;
    return `${windowMs} ms`;
}
function createRateLimiter(options) {
    const redis = getRedisClient();
    if (redis) {
        const limiter = new ratelimit_1.Ratelimit({
            redis,
            limiter: ratelimit_1.Ratelimit.slidingWindow(options.max, windowLabel(options.windowMs)),
            prefix: `qwik:${options.keyPrefix}`,
            analytics: false,
        });
        return async (req, res, next) => {
            try {
                const result = await limiter.limit(clientIdentifier(req));
                res.setHeader("X-RateLimit-Limit", result.limit);
                res.setHeader("X-RateLimit-Remaining", result.remaining);
                res.setHeader("X-RateLimit-Reset", result.reset);
                if (!result.success) {
                    res.setHeader("Retry-After", Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)));
                    return res.status(429).json({
                        success: false,
                        message: "Too many requests. Please try again shortly.",
                    });
                }
                next();
            }
            catch (error) {
                next(error);
            }
        };
    }
    if (process.env.NODE_ENV === "production") {
        throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for production rate limiting");
    }
    return (0, express_rate_limit_1.rateLimit)({
        windowMs: options.windowMs,
        limit: options.max,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        message: {
            success: false,
            message: "Too many requests. Please try again shortly.",
        },
        handler: (_req, res, _next, rateLimitOptions) => {
            res.setHeader("Retry-After", Math.ceil(options.windowMs / 1000));
            return res.status(429).json({
                success: false,
                message: typeof rateLimitOptions.message === "object" && rateLimitOptions.message !== null
                    ? rateLimitOptions.message.message ?? "Too many requests. Please try again shortly."
                    : "Too many requests. Please try again shortly.",
            });
        },
    });
}
