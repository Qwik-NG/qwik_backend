"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const env_1 = require("./config/env");
const requestLogger_1 = require("./middleware/requestLogger");
const errors_1 = require("./middleware/errors");
const routes_1 = __importDefault(require("./routes"));
exports.app = (0, express_1.default)();
const frontendOrigins = env_1.env.frontendUrl
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
const cspConnectSources = ["'self'", ...frontendOrigins, env_1.env.publicUrl.replace(/\/$/, "")]
    .filter(Boolean)
    .join(" ");
const contentSecurityPolicy = [
    "default-src 'self'",
    `connect-src ${cspConnectSources}`,
    "img-src 'self' https://res.cloudinary.com data: blob:",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
].join("; ");
exports.app.disable("x-powered-by");
exports.app.set("trust proxy", 1);
exports.app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    next();
});
exports.app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow same-origin server checks, any local dev origin, and the configured frontend origin.
        if (!origin ||
            /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
            frontendOrigins.includes(origin.replace(/\/$/, ""))) {
            callback(null, true);
        }
        else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
}));
exports.app.use(express_1.default.json({ limit: "2mb" }));
exports.app.use(requestLogger_1.requestLogger);
exports.app.use("/uploads", express_1.default.static(path_1.default.resolve("uploads"), {
    immutable: true,
    maxAge: "7d",
    setHeaders: (res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
}));
exports.app.use("/api", routes_1.default);
exports.app.use(errors_1.notFound);
exports.app.use(errors_1.errorHandler);
