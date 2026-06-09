import { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

type Hit = {
  count: number;
  resetAt: number;
};

const hits = new Map<string, Hit>();

function clientKey(req: Request, keyPrefix: string) {
  return `${keyPrefix}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}

export function createRateLimiter(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = clientKey(req, options.keyPrefix);
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (current.count >= options.max) {
      res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again shortly.",
      });
    }

    current.count += 1;
    hits.set(key, current);
    next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of hits.entries()) {
    if (hit.resetAt <= now) hits.delete(key);
  }
}, 60_000).unref();
