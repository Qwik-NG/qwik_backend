"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const router = (0, express_1.Router)();
router.get("/", async (_req, res, next) => { try {
    res.json({ success: true, data: await prisma_1.prisma.category.findMany({ orderBy: { name: "asc" } }) });
}
catch (e) {
    next(e);
} });
exports.default = router;
