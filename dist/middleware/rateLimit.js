"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRateLimiter = createRateLimiter;
const hits = new Map();
function clientKey(req, keyPrefix) {
    return `${keyPrefix}:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}
function createRateLimiter(options) {
    return (req, res, next) => {
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
        if (hit.resetAt <= now)
            hits.delete(key);
    }
}, 60000).unref();
