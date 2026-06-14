import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { rateLimit } from "express-rate-limit";
import type { Request, RequestHandler } from "express";
import { env } from "../config/env";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};
type SlidingWindowDuration = Parameters<typeof Ratelimit.slidingWindow>[1];

let redisClient: Redis | null | undefined;

function getRedisClient() {
  if (redisClient !== undefined) return redisClient;
  if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) {
    redisClient = null;
    return redisClient;
  }

  redisClient = new Redis({
    url: env.upstashRedisRestUrl,
    token: env.upstashRedisRestToken,
  });
  return redisClient;
}

function clientIdentifier(req: Request) {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function windowLabel(windowMs: number): SlidingWindowDuration {
  if (windowMs % 60_000 === 0) return `${windowMs / 60_000} m` as SlidingWindowDuration;
  if (windowMs % 1000 === 0) return `${windowMs / 1000} s` as SlidingWindowDuration;
  return `${windowMs} ms` as SlidingWindowDuration;
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const redis = getRedisClient();

  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(options.max, windowLabel(options.windowMs)),
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
      } catch (error) {
        next(error);
      }
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for production rate limiting");
  }

  return rateLimit({
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
          ? (rateLimitOptions.message as { message?: string }).message ?? "Too many requests. Please try again shortly."
          : "Too many requests. Please try again shortly.",
      });
    },
  });
}
