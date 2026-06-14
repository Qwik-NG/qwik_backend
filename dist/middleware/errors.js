"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = notFound;
exports.errorHandler = errorHandler;
const client_1 = require("@prisma/client");
function notFound(_req, res) {
    res.status(404).json({ success: false, message: "Route not found" });
}
function errorHandler(err, _req, res, _next) {
    console.error(err);
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
            return res.status(409).json({ success: false, message: "A record with these details already exists" });
        }
        if (err.code === "P2025") {
            return res.status(404).json({ success: false, message: "Record not found" });
        }
        if (err.code === "P2024") {
            return res.status(503).json({ success: false, message: "Database unavailable. Please try again shortly." });
        }
    }
    const isDatabaseError = err.name.startsWith("Prisma") ||
        err.message.includes("Can't reach database server") ||
        err.message.includes("Invalid `prisma");
    const statusCode = err.status ?? (isDatabaseError ? 503 : 500);
    const isClientError = statusCode >= 400 && statusCode < 500;
    res.status(statusCode).json({
        success: false,
        message: isClientError ? err.message || "Request error" : isDatabaseError ? "Database unavailable" : "Internal server error",
        ...(err.errors ? { errors: err.errors } : {}),
    });
}
