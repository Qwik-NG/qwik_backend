import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";

const router = Router();

router.get("/unread-count", requireAuth, async (req, res, next) => {
  try {
    const count = await prisma.notification.count({
      where: {
        userId: req.auth!.userId,
        read: false,
      },
    });

    res.json({ success: true, data: { count } });
  } catch (e) {
    next(e);
  }
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const unreadOnly = String(req.query.unread ?? "").toLowerCase() === "true";
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.auth!.userId,
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    res.json({ success: true, data: notifications });
  } catch (e) {
    next(e);
  }
});

router.patch("/read-all", requireAuth, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: {
        userId: req.auth!.userId,
        read: false,
      },
      data: { read: true },
    });

    res.json({ success: true, data: null, message: "Notifications marked as read" });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/read", requireAuth, async (req, res, next) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: {
        id: String(req.params.id),
        userId: req.auth!.userId,
      },
    });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { read: true },
    });

    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

export default router;
