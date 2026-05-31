"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const routes_1 = __importDefault(require("./modules/auth/routes"));
const routes_2 = __importDefault(require("./modules/users/routes"));
const routes_3 = __importDefault(require("./modules/categories/routes"));
const routes_4 = __importDefault(require("./modules/ads/routes"));
const routes_5 = __importDefault(require("./modules/uploads/routes"));
const router = (0, express_1.Router)();
router.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));
router.use("/auth", routes_1.default);
router.use("/users", routes_2.default);
router.use("/categories", routes_3.default);
router.use("/ads", routes_4.default);
router.use("/uploads", routes_5.default);
exports.default = router;
