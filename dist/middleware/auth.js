"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
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
