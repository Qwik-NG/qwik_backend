"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
router.get("/unread-count", auth_1.requireAuth, async (req, res, next) => {
    try {
        const count = await prisma_1.prisma.notification.count({
            where: {
                userId: req.auth.userId,
                read: false,
            },
        });
        res.json({ success: true, data: { count } });
    }
    catch (e) {
        next(e);
    }
});
router.get("/", auth_1.requireAuth, async (req, res, next) => {
    try {
        const unreadOnly = String(req.query.unread ?? "").toLowerCase() === "true";
        const notifications = await prisma_1.prisma.notification.findMany({
            where: {
                userId: req.auth.userId,
                ...(unreadOnly ? { read: false } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 100,
        });
        res.json({ success: true, data: notifications });
    }
    catch (e) {
        next(e);
    }
});
router.patch("/read-all", auth_1.requireAuth, async (req, res, next) => {
    try {
        await prisma_1.prisma.notification.updateMany({
            where: {
                userId: req.auth.userId,
                read: false,
            },
            data: { read: true },
        });
        res.json({ success: true, data: null, message: "Notifications marked as read" });
    }
    catch (e) {
        next(e);
    }
});
router.patch("/:id/read", auth_1.requireAuth, async (req, res, next) => {
    try {
        const notification = await prisma_1.prisma.notification.findFirst({
            where: {
                id: String(req.params.id),
                userId: req.auth.userId,
            },
        });
        if (!notification) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        const updated = await prisma_1.prisma.notification.update({
            where: { id: notification.id },
            data: { read: true },
        });
        res.json({ success: true, data: updated });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
