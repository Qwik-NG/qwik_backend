"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireActiveUser = requireActiveUser;
exports.requireVerifiedEmail = requireVerifiedEmail;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const prisma_1 = require("../lib/prisma");
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
        return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
        const token = header.split(" ")[1];
        req.auth = jsonwebtoken_1.default.verify(token, env_1.env.jwtSecret);
        next();
    }
    catch {
        return res.status(401).json({ success: false, message: "Invalid token" });
    }
}
async function requireActiveUser(req, res, next) {
    if (!req.auth)
        return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: { status: true },
        });
        if (!user || user.status === "BANNED") {
            return res.status(403).json({ success: false, message: "Account suspended" });
        }
        next();
    }
    catch (e) {
        next(e);
    }
}
async function requireVerifiedEmail(req, res, next) {
    if (!req.auth)
        return res.status(401).json({ success: false, message: "Unauthorized" });
    try {
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: { emailVerifiedAt: true },
        });
        if (!user || !user.emailVerifiedAt) {
            return res.status(403).json({ success: false, message: "Email verification required" });
        }
        next();
    }
    catch (e) {
        next(e);
    }
}
