"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const required = ["DATABASE_URL", "JWT_SECRET"];
for (const key of required) {
    if (!process.env[key])
        throw new Error(`Missing required environment variable: ${key}`);
}
exports.env = {
    port: Number(process.env.PORT ?? 4000),
    jwtSecret: process.env.JWT_SECRET,
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173"
};
