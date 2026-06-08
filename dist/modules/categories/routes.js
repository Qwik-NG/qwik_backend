"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const router = (0, express_1.Router)();
const categoryInclude = {
    children: {
        orderBy: {
            name: "asc",
        },
    },
};
router.get("/", async (_req, res, next) => {
    try {
        const categories = await prisma_1.prisma.category.findMany({
            where: { parentId: null },
            include: categoryInclude,
            orderBy: { name: "asc" },
        });
        res.json({ success: true, data: categories });
    }
    catch (e) {
        next(e);
    }
});
router.get("/:slug", async (req, res, next) => {
    try {
        const slug = String(req.params.slug).trim().toLowerCase();
        const category = await prisma_1.prisma.category.findUnique({
            where: { slug },
            include: {
                ...categoryInclude,
                parent: true,
            },
        });
        if (!category) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }
        res.json({ success: true, data: category });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
