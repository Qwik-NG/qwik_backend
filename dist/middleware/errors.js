"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = notFound;
exports.errorHandler = errorHandler;
function notFound(_req, res) {
    res.status(404).json({ success: false, message: "Route not found" });
}
function errorHandler(err, _req, res, _next) {
    console.error(err);
    const isDatabaseError = err.name.startsWith("Prisma") ||
        err.message.includes("Can't reach database server") ||
        err.message.includes("Invalid `prisma");
    res.status(err.status ?? 500).json({
        success: false,
        message: isDatabaseError ? "Database unavailable" : err.message || "Internal server error",
        ...(err.errors ? { errors: err.errors } : {}),
    });
}
