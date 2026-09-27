import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { verifyUnsubscribeToken, resolveFrontendBaseUrl } from "../../lib/unsubscribeToken";

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

// ===== Unauthenticated Unsubscribe Endpoints (RFC 8058 & Frictionless Opt-Out) =====

router.get("/unsubscribe", async (req, res, next) => {
  try {
    const rawToken = String(req.query.token ?? "").trim();
    const verified = verifyUnsubscribeToken(rawToken);
    const frontendBase = resolveFrontendBaseUrl();

    if (!verified) {
      if (req.accepts("html")) {
        return res.status(400).send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribe Error - Qwik.ng</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f7fb; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; color: #1f2937; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 36px 28px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .btn { display: inline-block; background: #ff9715; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 9px; font-weight: 600; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <h2 style="color:#d14343;margin-top:0;">Invalid or Expired Link</h2>
    <p style="color:#6b7280;line-height:1.6;font-size:14px;">This unsubscribe link is invalid or has expired. You can manage your email notification preferences directly in your account settings.</p>
    <a href="${frontendBase}/notification-settings-email" class="btn">Manage Preferences</a>
  </div>
</body>
</html>`.trim());
      }

      return res.status(400).json({ success: false, message: "Invalid or expired unsubscribe link" });
    }

    // Explicit opt-out from "Deals on products" (emailNotifications)
    await prisma.notificationSettings.upsert({
      where: { userId: verified.userId },
      create: {
        userId: verified.userId,
        emailNotifications: false,
      },
      update: {
        emailNotifications: false,
      },
    });

    if (req.accepts("html")) {
      return res.send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Unsubscribed - Qwik.ng</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f7fb; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; color: #1f2937; }
    .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 36px 28px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .btn { display: inline-block; background: #ff9715; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 9px; font-weight: 600; font-size: 14px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="margin-bottom:20px;">
      <img src="https://www.qwik.ng/images/logo-email.png" alt="Qwik.ng" width="140" style="height:auto;max-width:140px;" />
    </div>
    <h2 style="color:#1a6035;margin-top:0;">You have been unsubscribed</h2>
    <p style="color:#374151;line-height:1.6;font-size:15px;">You will no longer receive promotional emails and marketplace deals from Qwik.ng.</p>
    <p style="color:#6b7280;font-size:13px;line-height:1.5;">You can re-enable or change your notification preferences at any time in your account settings.</p>
    <a href="${frontendBase}/notification-settings-email" class="btn">Manage Notification Settings</a>
  </div>
</body>
</html>`.trim());
    }

    return res.json({ success: true, message: "You have been successfully unsubscribed from promotional emails." });
  } catch (e) {
    next(e);
  }
});

router.post("/unsubscribe-one-click", async (req, res, next) => {
  try {
    const rawToken = String(req.query.token ?? req.body?.token ?? "").trim();
    const verified = verifyUnsubscribeToken(rawToken);

    if (!verified) {
      return res.status(400).json({ success: false, message: "Invalid or expired unsubscribe token" });
    }

    await prisma.notificationSettings.upsert({
      where: { userId: verified.userId },
      create: {
        userId: verified.userId,
        emailNotifications: false,
      },
      update: {
        emailNotifications: false,
      },
    });

    return res.json({ success: true, message: "Unsubscribed" });
  } catch (e) {
    next(e);
  }
});

export default router;
