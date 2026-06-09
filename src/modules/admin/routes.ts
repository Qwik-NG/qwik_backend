import { NextFunction, Request, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { parseOrThrow } from "../../utils/validation";

const router = Router();

const reportStatusSchema = z.object({
  status: z.enum(["PENDING", "RESOLVED", "DISMISSED"]),
});

const verificationReviewSchema = z.object({
  status: z.enum(["IN_REVIEW", "APPROVED", "REJECTED"]),
  rejectionReason: z.string().trim().max(1000).optional(),
});

const banUserSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const safeAdminUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  location: true,
  role: true,
  status: true,
  bannedAt: true,
  banReason: true,
  createdAt: true,
  updatedAt: true,
  profile: {
    select: { bio: true, avatarUrl: true },
  },
  _count: {
    select: { ads: true, reviews: true },
  },
} satisfies Prisma.UserSelect;

function getPage(req: Request) {
  const parsed = pageQuerySchema.parse(req.query);
  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    skip: (parsed.page - 1) * parsed.pageSize,
  };
}

async function auditAdminAction(req: Request, action: string, targetType: string, targetId?: string, metadata?: Prisma.InputJsonValue) {
  if (!req.auth?.userId) return;

  await prisma.adminAuditLog.create({
    data: {
      adminId: req.auth.userId,
      action,
      targetType,
      targetId,
      metadata,
    },
  });
}

function notFound(res: Response, message: string) {
  return res.status(404).json({ success: false, message });
}

const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { id: true, role: true, status: true },
    });

    if (!user || user.role !== "ADMIN" || user.status === "BANNED") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }

    next();
  } catch {
    res.status(500).json({ success: false, message: "Failed to verify admin access" });
  }
};

router.use(requireAuth);
router.use(requireAdmin);

router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const [totalUsers, bannedUsers, totalAds, totalReports, pendingReports, pendingVerifications] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { status: "BANNED" } }),
      prisma.ad.count(),
      prisma.report.count(),
      prisma.report.count({ where: { status: "PENDING" } }),
      prisma.verificationApplication.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        bannedUsers,
        totalAds,
        totalReports,
        pendingReports,
        pendingVerifications,
      },
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch admin stats" });
  }
});

router.get("/users", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        select: safeAdminUserSelect,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.user.count(),
    ]);

    res.json({ success: true, data: users, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
});

router.get("/ads", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const [ads, total] = await prisma.$transaction([
      prisma.ad.findMany({
        include: {
          user: {
            select: { id: true, fullName: true, email: true, status: true },
          },
          category: true,
          _count: {
            select: { images: true, reviews: true, reports: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.ad.count(),
    ]);

    res.json({ success: true, data: ads, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch ads" });
  }
});

router.get("/reports", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const [reports, total] = await prisma.$transaction([
      prisma.report.findMany({
        include: {
          ad: {
            select: { id: true, title: true },
          },
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.report.count(),
    ]);

    res.json({ success: true, data: reports, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch reports" });
  }
});

router.patch("/reports/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = parseOrThrow(reportStatusSchema, req.body);
    const existing = await prisma.report.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) return notFound(res, "Report not found");

    const report = await prisma.report.update({
      where: { id },
      data: { status: body.status },
      include: {
        ad: { select: { id: true, title: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    await auditAdminAction(req, "REPORT_STATUS_UPDATED", "Report", id, {
      previousStatus: existing.status,
      status: body.status,
    });

    res.json({ success: true, data: report, message: "Report updated" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update report";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.get("/verifications", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const status = String(req.query.status ?? "").trim();
    const where = status ? { status: status as any } : {};

    const [verifications, total] = await prisma.$transaction([
      prisma.verificationApplication.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              phone: true,
              location: true,
              role: true,
              status: true,
              profile: true,
            },
          },
          documents: { orderBy: { createdAt: "desc" } },
          payments: { orderBy: { createdAt: "desc" }, take: 5 },
          reviewer: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.verificationApplication.count({ where }),
    ]);

    res.json({ success: true, data: verifications, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch verifications" });
  }
});

router.patch("/verifications/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = parseOrThrow(verificationReviewSchema, req.body);

    if (body.status === "REJECTED" && !body.rejectionReason?.trim()) {
      return res.status(400).json({ success: false, message: "Rejection reason is required" });
    }

    const existing = await prisma.verificationApplication.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) return notFound(res, "Verification application not found");

    const verification = await prisma.verificationApplication.update({
      where: { id },
      data: {
        status: body.status,
        rejectionReason: body.status === "REJECTED" ? body.rejectionReason : null,
        reviewedAt: body.status === "APPROVED" || body.status === "REJECTED" ? new Date() : null,
        reviewerId: req.auth!.userId,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            phone: true,
            location: true,
            role: true,
            status: true,
            profile: true,
          },
        },
        documents: true,
        payments: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    await auditAdminAction(req, "VERIFICATION_REVIEWED", "VerificationApplication", id, {
      previousStatus: existing.status,
      status: body.status,
    });

    res.json({ success: true, data: verification, message: "Verification updated" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update verification";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.delete("/ads/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.ad.findUnique({ where: { id }, select: { id: true, title: true, userId: true } });
    if (!existing) return notFound(res, "Ad not found");

    await prisma.ad.delete({ where: { id } });
    await auditAdminAction(req, "AD_DELETED", "Ad", id, {
      title: existing.title,
      userId: existing.userId,
    });

    res.json({ success: true, data: null, message: "Ad deleted successfully" });
  } catch {
    res.status(500).json({ success: false, message: "Failed to delete ad" });
  }
});

router.post("/users/:id/ban", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (id === req.auth?.userId) {
      return res.status(400).json({ success: false, message: "Admins cannot ban their own account" });
    }

    const body = parseOrThrow(banUserSchema, req.body ?? {});
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
    if (!existing) return notFound(res, "User not found");
    if (existing.role === "ADMIN") return res.status(400).json({ success: false, message: "Admin accounts cannot be banned here" });

    const user = await prisma.user.update({
      where: { id },
      data: {
        status: "BANNED",
        bannedAt: new Date(),
        banReason: body.reason ?? "Policy violation",
      },
      select: safeAdminUserSelect,
    });

    await auditAdminAction(req, "USER_BANNED", "User", id, { reason: user.banReason });
    res.json({ success: true, message: "User banned successfully", data: user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ban user";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.post("/users/:id/unban", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!existing) return notFound(res, "User not found");

    const user = await prisma.user.update({
      where: { id },
      data: { status: "ACTIVE", bannedAt: null, banReason: null },
      select: safeAdminUserSelect,
    });

    await auditAdminAction(req, "USER_UNBANNED", "User", id);
    res.json({ success: true, message: "User restored successfully", data: user });
  } catch {
    res.status(500).json({ success: false, message: "Failed to restore user" });
  }
});

router.get("/audit-log", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const [logs, total] = await prisma.$transaction([
      prisma.adminAuditLog.findMany({
        include: {
          admin: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.adminAuditLog.count(),
    ]);

    res.json({ success: true, data: logs, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch audit log" });
  }
});

export default router;
