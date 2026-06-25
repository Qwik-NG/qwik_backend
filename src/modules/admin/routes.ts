import { NextFunction, Request, Response, Router } from "express";
import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";
import { parseOrThrow } from "../../utils/validation";
import { getCached, setCached, getCacheKey, invalidateCache, CACHE_TTLS } from "../../lib/admin-cache";
import { env } from "../../config/env";

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

const router = Router();
const ADMIN_ACCESS_CACHE_TTL_MS = 10_000;
const adminAccessCache = new Map<string, { role: string; status: string; expiresAt: number }>();

const reportStatusSchema = z.object({
  status: z.enum(["PENDING", "RESOLVED", "DISMISSED"]),
  note: z.string().trim().min(3).max(500).optional(),
  unlistAd: z.boolean().optional().default(false),
});

const verificationReviewSchema = z.object({
  status: z.enum(["IN_REVIEW", "APPROVED", "REJECTED"]),
  rejectionReason: z.string().trim().max(1000).optional(),
  decisionNote: z.string().trim().max(1000).optional(),
});

const banUserSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const deleteUserSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const adModerationSchema = z.object({
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  reason: z.string().trim().min(3).max(500).optional(),
});

const adDeleteSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const reviewModerationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const adminUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  status: z.enum(["ACTIVE", "BANNED"]).optional(),
});

const adminAdsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "SOLD", "DRAFT"]).optional(),
});

const adminReportsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["PENDING", "RESOLVED", "DISMISSED"]).optional(),
});

const adminReviewsQuerySchema = z.object({
  search: z.string().trim().optional(),
});

const adminVerificationsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED"]).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
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

    const cached = adminAccessCache.get(req.auth.userId);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.role !== "ADMIN" || cached.status === "BANNED") {
        return res.status(403).json({ success: false, message: "Admin access required" });
      }
      return next();
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { id: true, role: true, status: true },
    });

    if (user) {
      adminAccessCache.set(req.auth.userId, {
        role: user.role,
        status: user.status,
        expiresAt: Date.now() + ADMIN_ACCESS_CACHE_TTL_MS,
      });
    }

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
    const cacheKey = getCacheKey("/admin/stats");
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached, _cached: true });
    }

    const [totalUsers, bannedUsers, totalAds, totalReports, pendingReports, pendingVerifications] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { status: "BANNED" } }),
      prisma.ad.count(),
      prisma.report.count(),
      prisma.report.count({ where: { status: "PENDING" } }),
      prisma.verificationApplication.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
    ]);

    const data = {
      totalUsers,
      bannedUsers,
      totalAds,
      totalReports,
      pendingReports,
      pendingVerifications,
    };

    setCached(cacheKey, data, CACHE_TTLS.STATS);

    res.json({
      success: true,
      data,
    });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch admin stats" });
  }
});

router.get("/users", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const query = parseOrThrow(adminUsersQuerySchema, req.query);
    const search = query.search?.toLowerCase();

    const where: Prisma.UserWhereInput = {};
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    const cacheKey = getCacheKey("/admin/users", {
      page,
      pageSize,
      search: query.search,
      role: query.role,
      status: query.status,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
    }

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select: safeAdminUserSelect,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    const cacheData = { data: users, meta: { page, pageSize, total } };
    setCached(cacheKey, cacheData, CACHE_TTLS.USERS);

    res.json({ success: true, data: users, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch users" });
  }
});

router.get("/ads", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const query = parseOrThrow(adminAdsQuerySchema, req.query);
    const search = query.search?.toLowerCase();

    const params: unknown[] = [];
    const whereClauses: string[] = [];

    if (query.status) {
      params.push(query.status);
      whereClauses.push(`a."status" = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      const titleParam = `$${params.length}`;
      params.push(`%${search}%`);
      const nameParam = `$${params.length}`;
      params.push(`%${search}%`);
      const catParam = `$${params.length}`;
      whereClauses.push(`(a."title" ILIKE ${titleParam} OR u."fullName" ILIKE ${nameParam} OR c."name" ILIKE ${catParam})`);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    params.push(pageSize);
    const pageSizeParam = `$${params.length}`;
    params.push(skip);
    const skipParam = `$${params.length}`;

    const cacheKey = getCacheKey("/admin/ads", {
      page,
      pageSize,
      search: query.search,
      status: query.status,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
    }

    const [adsRows, countResult] = await prisma.$transaction([
      prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
          a."id",
          a."title",
          a."status"::text,
          a."isPromoted",
          a."createdAt",
          jsonb_build_object(
            'id', u."id",
            'fullName', u."fullName",
            'email', u."email",
            'status', u."status"::text
          ) AS "user",
          jsonb_build_object(
            'id', c."id",
            'name', c."name",
            'slug', c."slug"
          ) AS "category",
          COALESCE(img."images", '[]'::jsonb) AS "images",
          c2."count" AS "imageCount",
          r."count" AS "reviewCount",
          rp."count" AS "reportCount"
        FROM "Ad" a
        JOIN "User" u ON u."id" = a."userId"
        JOIN "Category" c ON c."id" = a."categoryId"
        LEFT JOIN LATERAL (
          SELECT COALESCE(
            jsonb_agg(
              jsonb_build_object('id', i."id", 'url', i."url", 'position', i."position")
              ORDER BY i."position" ASC
            ),
            '[]'::jsonb
          ) AS "images"
          FROM (
            SELECT i."id", i."url", i."position"
            FROM "AdImage" i
            WHERE i."adId" = a."id"
            ORDER BY i."position" ASC
            LIMIT 1
          ) i
        ) img ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "count"
          FROM "AdImage"
          WHERE "adId" = a."id"
        ) c2 ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "count"
          FROM "Review"
          WHERE "adId" = a."id"
        ) r ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS "count"
          FROM "Report"
          WHERE "adId" = a."id"
        ) rp ON true
        ${whereClause}
        ORDER BY
          CASE WHEN a."isPromoted" = true AND (a."promotedUntil" IS NULL OR a."promotedUntil" > now()) THEN 0 ELSE 1 END,
          a."createdAt" DESC,
          a."id" ASC
        LIMIT ${pageSizeParam}
        OFFSET ${skipParam}
        `,
        ...params,
      ),
      prisma.$queryRawUnsafe<[{ count: number }]>(
        `
        SELECT COUNT(*)::int AS "count"
        FROM "Ad" a
        JOIN "User" u ON u."id" = a."userId"
        JOIN "Category" c ON c."id" = a."categoryId"
        ${whereClause}
        `,
        ...(whereClause ? params.slice(0, params.length - 2) : []),
      ),
    ]);

    const ads = adsRows.map((row) => ({
      ...row,
      _count: {
        images: row.imageCount || 0,
        reviews: row.reviewCount || 0,
        reports: row.reportCount || 0,
      },
    }));

    const total = countResult[0]?.count || 0;

    const cacheData = { data: ads, meta: { page, pageSize, total } };
    setCached(cacheKey, cacheData, CACHE_TTLS.ADS);

    res.json({ success: true, data: ads, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch ads" });
  }
});

router.patch("/ads/:id/status", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = parseOrThrow(adModerationSchema, req.body ?? {});
    const existing = await prisma.ad.findUnique({
      where: { id },
      select: { id: true, title: true, userId: true, status: true },
    });
    if (!existing) return notFound(res, "Ad not found");

    const ad = await prisma.ad.update({
      where: { id },
      data: { status: body.status },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, status: true },
        },
        category: true,
        images: {
          select: { id: true, url: true, position: true },
          orderBy: { position: "asc" },
          take: 1,
        },
        _count: {
          select: { images: true, reviews: true, reports: true },
        },
      },
    });

    // Invalidate related caches
    invalidateCache("/admin/ads", "/admin/reports", "/admin/stats", "/admin/audit-log");

    await auditAdminAction(req, "AD_STATUS_UPDATED", "Ad", id, {
      title: existing.title,
      userId: existing.userId,
      previousStatus: existing.status,
      status: body.status,
      reason: body.reason ?? null,
    });

    res.json({
      success: true,
      data: ad,
      message: body.status === "ARCHIVED" ? "Ad unlisted successfully" : "Ad reinstated successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update ad status";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.get("/reports", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const query = parseOrThrow(adminReportsQuerySchema, req.query);
    const search = query.search?.toLowerCase();

    const where: Prisma.ReportWhereInput = {};
    if (query.status) where.status = query.status;
    if (search) {
      where.OR = [
        { reason: { contains: search, mode: "insensitive" } },
        { ad: { is: { title: { contains: search, mode: "insensitive" } } } },
        { user: { is: { fullName: { contains: search, mode: "insensitive" } } } },
        { user: { is: { email: { contains: search, mode: "insensitive" } } } },
        { ad: { is: { user: { is: { fullName: { contains: search, mode: "insensitive" } } } } } },
        { ad: { is: { user: { is: { email: { contains: search, mode: "insensitive" } } } } } },
      ];
    }

    const cacheKey = getCacheKey("/admin/reports", {
      page,
      pageSize,
      search: query.search,
      status: query.status,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
    }

    const [reports, total] = await prisma.$transaction([
      prisma.report.findMany({
        where,
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
      prisma.report.count({ where }),
    ]);

    const cacheData = { data: reports, meta: { page, pageSize, total } };
    setCached(cacheKey, cacheData, CACHE_TTLS.REPORTS);

    res.json({ success: true, data: reports, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch reports" });
  }
});

router.get("/reviews", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const query = parseOrThrow(adminReviewsQuerySchema, req.query);
    const search = query.search?.toLowerCase();

    const where: Prisma.ReviewWhereInput = {};
    if (search) {
      where.OR = [
        { text: { contains: search, mode: "insensitive" } },
        { user: { is: { fullName: { contains: search, mode: "insensitive" } } } },
        { user: { is: { email: { contains: search, mode: "insensitive" } } } },
        { ad: { is: { title: { contains: search, mode: "insensitive" } } } },
        { ad: { is: { user: { is: { fullName: { contains: search, mode: "insensitive" } } } } } },
        { ad: { is: { user: { is: { email: { contains: search, mode: "insensitive" } } } } } },
      ];
    }

    const cacheKey = getCacheKey("/admin/reviews", {
      page,
      pageSize,
      search: query.search,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
    }

    const [reviews, total] = await prisma.$transaction([
      prisma.review.findMany({
        where,
        include: {
          ad: {
            select: {
              id: true,
              title: true,
              status: true,
              user: {
                select: { id: true, fullName: true, email: true },
              },
            },
          },
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.review.count({ where }),
    ]);

    const cacheData = { data: reviews, meta: { page, pageSize, total } };
    setCached(cacheKey, cacheData, CACHE_TTLS.REVIEWS);

    res.json({ success: true, data: reviews, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch reviews" });
  }
});

router.delete("/reviews/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = parseOrThrow(reviewModerationSchema, req.body ?? {});
    const existing = await prisma.review.findUnique({
      where: { id },
      include: {
        ad: {
          select: {
            id: true,
            title: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        },
        user: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!existing) return notFound(res, "Review not found");

    await prisma.review.delete({ where: { id } });

    // Invalidate related caches
    invalidateCache("/admin/reviews", "/admin/stats", "/admin/audit-log");

    await auditAdminAction(req, "REVIEW_DELETED", "Review", id, {
      adId: existing.adId,
      adTitle: existing.ad.title,
      adSellerId: existing.ad.user.id,
      adSellerName: existing.ad.user.fullName,
      reviewerId: existing.userId,
      reviewerName: existing.user.fullName,
      rating: existing.rating,
      text: existing.text,
      reason: body.reason,
    });

    res.json({ success: true, data: null, message: "Review removed successfully" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to moderate review";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.patch("/reports/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = parseOrThrow(reportStatusSchema, req.body);
    if (body.unlistAd && body.status !== "RESOLVED") {
      return res.status(400).json({ success: false, message: "Ad unlisting is only allowed when resolving a report" });
    }

    const existing = await prisma.report.findUnique({
      where: { id },
      select: { id: true, status: true, adId: true, reason: true },
    });
    if (!existing) return notFound(res, "Report not found");

    const adBefore = body.unlistAd
      ? await prisma.ad.findUnique({
          where: { id: existing.adId },
          select: { id: true, title: true, status: true, userId: true },
        })
      : null;

    const report = await prisma.$transaction(async (tx) => {
      const updatedReport = await tx.report.update({
        where: { id },
        data: { status: body.status },
        include: {
          ad: {
            select: {
              id: true,
              title: true,
              user: { select: { id: true, fullName: true, email: true } },
            },
          },
          user: { select: { id: true, fullName: true, email: true } },
        },
      });

      if (body.unlistAd && adBefore && adBefore.status === "ACTIVE") {
        await tx.ad.update({
          where: { id: adBefore.id },
          data: { status: "ARCHIVED" },
        });
      }

      return updatedReport;
    });

    // Invalidate related caches
    invalidateCache("/admin/reports", "/admin/ads", "/admin/stats", "/admin/audit-log");

    await auditAdminAction(req, "REPORT_STATUS_UPDATED", "Report", id, {
      previousStatus: existing.status,
      status: body.status,
      note: body.note ?? null,
      unlistAd: body.unlistAd,
    });

    if (body.unlistAd && adBefore) {
      await auditAdminAction(req, "AD_STATUS_UPDATED", "Ad", adBefore.id, {
        title: adBefore.title,
        userId: adBefore.userId,
        previousStatus: adBefore.status,
        status: adBefore.status === "ACTIVE" ? "ARCHIVED" : adBefore.status,
        source: "REPORT_ESCALATION",
        reportId: id,
        reason: body.note ?? existing.reason,
      });
    }

    res.json({
      success: true,
      data: report,
      message: body.unlistAd ? "Report resolved and ad unlisted" : "Report updated",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update report";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.get("/verifications", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const query = parseOrThrow(adminVerificationsQuerySchema, req.query);

    const where: Prisma.VerificationApplicationWhereInput = {};
    if (query.status) where.status = query.status;

    const search = query.search?.toLowerCase();
    if (search) {
      where.OR = [
        {
          user: {
            is: {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { location: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
        {
          reviewer: {
            is: {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        const fromDate = new Date(query.from);
        if (!isNaN(fromDate.getTime())) (where.createdAt as Prisma.DateTimeFilter).gte = fromDate;
      }
      if (query.to) {
        const toDate = new Date(query.to);
        if (!isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          (where.createdAt as Prisma.DateTimeFilter).lte = toDate;
        }
      }
    }

    const cacheKey = getCacheKey("/admin/verifications", {
      page,
      pageSize,
      status: query.status,
      search: query.search,
      from: query.from,
      to: query.to,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
    }

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

    const cacheData = { data: verifications, meta: { page, pageSize, total } };
    setCached(cacheKey, cacheData, CACHE_TTLS.VERIFICATIONS);

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
        reviewer: {
          select: { id: true, fullName: true, email: true },
        },
      },
    });

    // Invalidate related caches
    invalidateCache("/admin/verifications", "/admin/stats", "/admin/audit-log");

    await auditAdminAction(req, "VERIFICATION_REVIEWED", "VerificationApplication", id, {
      previousStatus: existing.status,
      status: body.status,
      decisionNote: body.decisionNote ?? null,
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
    const body = parseOrThrow(adDeleteSchema, req.body ?? {});
    const existing = await prisma.ad.findUnique({ where: { id }, select: { id: true, title: true, userId: true } });
    if (!existing) return notFound(res, "Ad not found");

    await prisma.ad.delete({ where: { id } });

    // Invalidate related caches
    invalidateCache("/admin/ads", "/admin/stats", "/admin/audit-log");

    await auditAdminAction(req, "AD_DELETED", "Ad", id, {
      title: existing.title,
      userId: existing.userId,
      reason: body.reason ?? null,
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

    // Invalidate related caches
    invalidateCache("/admin/users", "/admin/stats", "/admin/audit-log");
    adminAccessCache.delete(id);

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

    // Invalidate related caches
    invalidateCache("/admin/users", "/admin/stats", "/admin/audit-log");
    adminAccessCache.delete(id);

    await auditAdminAction(req, "USER_UNBANNED", "User", id);
    res.json({ success: true, message: "User restored successfully", data: user });
  } catch {
    res.status(500).json({ success: false, message: "Failed to restore user" });
  }
});

router.delete("/users/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (id === req.auth?.userId) {
      return res.status(400).json({ success: false, message: "Admins cannot delete their own account" });
    }

    const body = parseOrThrow(deleteUserSchema, req.body ?? {});
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, status: true, fullName: true, email: true },
    });

    if (!existing) return notFound(res, "User not found");
    if (existing.role === "ADMIN") {
      return res.status(400).json({ success: false, message: "Admin accounts cannot be deleted here" });
    }

    await prisma.user.delete({ where: { id } });

    // Invalidate related caches
    invalidateCache("/admin/users", "/admin/stats", "/admin/audit-log");
    adminAccessCache.delete(id);

    await auditAdminAction(req, "USER_DELETED", "User", id, {
      fullName: existing.fullName,
      email: existing.email,
      previousStatus: existing.status,
      reason: body.reason ?? null,
    });

    res.json({ success: true, data: null, message: "User deleted successfully" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete user";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

const auditLogQuerySchema = z.object({
  search: z.string().trim().optional(),
  action: z.string().trim().optional(),
  targetType: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

router.get("/audit-log", async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = getPage(req);
    const query = parseOrThrow(auditLogQuerySchema, req.query);

    // Generate cache key - include query filters
    const cacheKey = getCacheKey("/admin/audit-log", {
      page,
      pageSize,
      search: query.search,
      action: query.action,
      targetType: query.targetType,
      from: query.from,
      to: query.to,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
    }

    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    const search = query.search?.toLowerCase();
    if (search) {
      where.OR = [
        { action: { contains: search, mode: "insensitive" } },
        { targetType: { contains: search, mode: "insensitive" } },
        { targetId: { contains: search, mode: "insensitive" } },
        {
          admin: {
            is: {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        const fromDate = new Date(query.from);
        if (!isNaN(fromDate.getTime())) (where.createdAt as Prisma.DateTimeFilter).gte = fromDate;
      }
      if (query.to) {
        const toDate = new Date(query.to);
        if (!isNaN(toDate.getTime())) {
          toDate.setHours(23, 59, 59, 999);
          (where.createdAt as Prisma.DateTimeFilter).lte = toDate;
        }
      }
    }

    const [logs, total] = await prisma.$transaction([
      prisma.adminAuditLog.findMany({
        where,
        include: {
          admin: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    const cacheData = { data: logs, meta: { page, pageSize, total } };
    // Very short TTL for audit log since it must reflect recent actions
    setCached(cacheKey, cacheData, CACHE_TTLS.AUDIT_LOG);

    res.json({ success: true, data: logs, meta: { page, pageSize, total } });
  } catch {
    res.status(500).json({ success: false, message: "Failed to fetch audit log" });
  }
});

// ===== Communications: Phase 2A — Test Email Only =====

const testEmailSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(120, "Subject must be 120 characters or fewer"),
  message: z.string().trim().min(1, "Message is required").max(5000, "Message must be 5000 characters or fewer"),
});

const sendUserEmailSchema = z.object({
  userId: z.string().trim().min(1, "userId is required"),
  subject: z.string().trim().min(1, "Subject is required").max(120, "Subject must be 120 characters or fewer"),
  message: z.string().trim().min(1, "Message is required").max(5000, "Message must be 5000 characters or fewer"),
});

const sendSelectedSellersEmailSchema = z.object({
  userIds: z.array(z.string().trim().min(1, "userId is required")).min(1, "At least one seller must be selected").max(25, "A maximum of 25 sellers can be selected"),
  subject: z.string().trim().min(1, "Subject is required").max(120, "Subject must be 120 characters or fewer"),
  message: z.string().trim().min(1, "Message is required").max(5000, "Message must be 5000 characters or fewer"),
});

router.post("/communications/test-email", async (req: Request, res: Response) => {
  try {
    const body = parseOrThrow(testEmailSchema, req.body ?? {});

    // Always resolve the admin's own email from the database — never accept a recipient in the request body
    const admin = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, email: true, fullName: true },
    });

    if (!admin || !admin.email) {
      return res.status(400).json({ success: false, message: "Admin email address could not be resolved." });
    }

    if (!resend) {
      if (env.isProduction) {
        return res.status(503).json({ success: false, message: "Email service is not configured. Set RESEND_API_KEY." });
      }
      console.warn("[admin/communications] Resend is not configured; test email was not sent.");
      return res.json({
        success: true,
        data: { recipient: admin.email, sent: false, reason: "Email service not configured in dev" },
        message: "Email skipped (Resend not configured in this environment).",
      });
    }

    const safeMessage = body.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeSubject = body.subject.trim();

    const result = await resend.emails.send({
      from: env.resendFromEmail,
      to: admin.email,
      subject: `[Test] ${safeSubject}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f3f5;font-family:sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f5;padding:32px 0">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e8e8ea">
        <tr><td style="background:#ff9715;padding:20px 28px">
          <span style="font-size:26px;font-weight:400;color:#ffffff;letter-spacing:-0.5px">qwik</span>
          <span style="display:block;font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">Admin Panel — Communications</span>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Subject</p>
          <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#1f1f29">${safeSubject}</p>
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Message</p>
          <div style="background:#f8f8fa;border-radius:8px;padding:16px;font-size:15px;line-height:1.6;color:#3a3743;white-space:pre-wrap">${safeMessage}</div>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f0f2">
          <p style="margin:0;font-size:12px;color:#9a99a6">⚠️ This is a <strong>test admin communication</strong> sent only to <strong>${admin.email}</strong>. No users received this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      text: `[TEST ADMIN COMMUNICATION]\n\nSubject: ${safeSubject}\n\n${body.message}\n\n---\nThis is a test admin communication sent only to ${admin.email}. No users received this email.`,
    });

    if (result.error) {
      console.error("[admin/communications] Resend error:", result.error);
      return res.status(502).json({ success: false, message: result.error.message || "Failed to send test email" });
    }

    await auditAdminAction(req, "ADMIN_TEST_EMAIL_SENT", "AdminCommunication", undefined, {
      subject: safeSubject,
      recipient: admin.email,
      messageId: result.data?.id ?? null,
    });

    res.json({
      success: true,
      data: { recipient: admin.email, sent: true, messageId: result.data?.id ?? null },
      message: `Test email sent to ${admin.email}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send test email";
    res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.post("/communications/send-user-email", async (req: Request, res: Response) => {
  try {
    const body = parseOrThrow(sendUserEmailSchema, req.body ?? {});

    const selectedUser = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, email: true, fullName: true },
    });

    if (!selectedUser) {
      return res.status(404).json({ success: false, message: "Selected user was not found." });
    }

    if (!selectedUser.email) {
      return res.status(400).json({ success: false, message: "Selected user has no email address." });
    }

    if (!resend) {
      if (env.isProduction) {
        return res.status(503).json({ success: false, message: "Email service is not configured. Set RESEND_API_KEY." });
      }
      console.warn("[admin/communications] Resend is not configured; selected-user email was not sent.");
      return res.json({
        success: true,
        data: { recipient: selectedUser.email, recipientUserId: selectedUser.id, sent: false, reason: "Email service not configured in dev" },
        message: "Email skipped (Resend not configured in this environment).",
      });
    }

    // Only allow plain text semantics from admin input in the HTML body.
    const safeSubject = body.subject.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeMessage = body.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const result = await resend.emails.send({
      from: env.resendFromEmail,
      to: selectedUser.email,
      subject: safeSubject,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f3f5;font-family:sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f5;padding:32px 0">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e8e8ea">
        <tr><td style="background:#ff9715;padding:20px 28px">
          <span style="font-size:26px;font-weight:400;color:#ffffff;letter-spacing:-0.5px">qwik</span>
          <span style="display:block;font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">Admin Communication</span>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Subject</p>
          <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#1f1f29">${safeSubject}</p>
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Message</p>
          <div style="background:#f8f8fa;border-radius:8px;padding:16px;font-size:15px;line-height:1.6;color:#3a3743;white-space:pre-wrap">${safeMessage}</div>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f0f2">
          <p style="margin:0;font-size:12px;color:#9a99a6">This email was sent by Qwik.ng admin communications.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      text: `${body.subject}\n\n${body.message}`,
    });

    if (result.error) {
      console.error("[admin/communications] Resend error on selected-user send:", result.error);
      return res.status(502).json({ success: false, message: result.error.message || "Failed to send email to selected user" });
    }

    await auditAdminAction(req, "ADMIN_USER_EMAIL_SENT", "User", selectedUser.id, {
      selectedUserId: selectedUser.id,
      selectedUserEmail: selectedUser.email,
      subject: body.subject.trim(),
      messageId: result.data?.id ?? null,
    });

    return res.json({
      success: true,
      data: {
        recipient: selectedUser.email,
        recipientUserId: selectedUser.id,
        sent: true,
        messageId: result.data?.id ?? null,
      },
      message: `Email sent to ${selectedUser.email}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email to selected user";
    return res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.post("/communications/send-selected-sellers-email", async (req: Request, res: Response) => {
  try {
    const body = parseOrThrow(sendSelectedSellersEmailSchema, req.body ?? {});
    const uniqueUserIds = Array.from(new Set(body.userIds));

    const selectedUsers = await prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: { id: true },
    });

    const eligibleSellers = await prisma.user.findMany({
      where: {
        id: { in: uniqueUserIds },
        status: "ACTIVE",
        ads: { some: {} },
      },
      select: { id: true, email: true, fullName: true },
    });

    const requestedCount = uniqueUserIds.length;
    const eligibleCount = eligibleSellers.length;
    const skippedNonSellerCount = requestedCount - eligibleCount;

    // Create campaign record
    const messageSnippet = body.message.length > 100 ? body.message.substring(0, 97) + "..." : body.message;
    const campaign = await prisma.emailCampaign.create({
      data: {
        type: "SELECTED_SELLERS",
        status: "DRAFT",
        adminId: req.auth!.userId,
        subject: body.subject.trim(),
        messageSnippet,
        requestedCount,
        eligibleCount,
        sentCount: 0,
        failedCount: 0,
        skippedCount: skippedNonSellerCount,
      },
    });

    if (!resend) {
      if (env.isProduction) {
        return res.status(503).json({ success: false, message: "Email service is not configured. Set RESEND_API_KEY." });
      }

      // Log skipped recipients
      await Promise.all(
        uniqueUserIds.map((id) =>
          prisma.emailRecipientLog.create({
            data: {
              campaignId: campaign.id,
              userId: id,
              status: "SKIPPED",
              error: "Email service not configured in dev",
            },
          }),
        ),
      );

      await prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: { status: "FAILED", failedCount: uniqueUserIds.length, skippedCount: 0 },
      });

      return res.json({
        success: true,
        data: {
          campaignId: campaign.id,
          requestedCount,
          eligibleCount,
          sentCount: 0,
          failedCount: eligibleCount,
          skippedNonSellerCount,
        },
        message: "Email skipped (Resend not configured in this environment).",
      });
    }

    const safeSubject = body.subject.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeMessage = body.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    let sentCount = 0;
    let failedCount = 0;
    const failedRecipients: string[] = [];

    // Send to eligible sellers
    for (const seller of eligibleSellers) {
      if (!seller.email) {
        failedCount += 1;
        failedRecipients.push(seller.id);
        await prisma.emailRecipientLog.create({
          data: {
            campaignId: campaign.id,
            userId: seller.id,
            email: null,
            status: "FAILED",
            error: "No email address on account",
          },
        });
        continue;
      }

      const result = await resend.emails.send({
        from: env.resendFromEmail,
        to: seller.email,
        subject: safeSubject,
        html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f3f5;font-family:sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f5;padding:32px 0">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e8e8ea">
        <tr><td style="background:#ff9715;padding:20px 28px">
          <span style="font-size:26px;font-weight:400;color:#ffffff;letter-spacing:-0.5px">qwik</span>
          <span style="display:block;font-size:11px;color:rgba(255,255,255,0.8);margin-top:2px">Admin Communication</span>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Subject</p>
          <p style="margin:0 0 20px;font-size:18px;font-weight:600;color:#1f1f29">${safeSubject}</p>
          <p style="margin:0 0 8px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9a99a6">Message</p>
          <div style="background:#f8f8fa;border-radius:8px;padding:16px;font-size:15px;line-height:1.6;color:#3a3743;white-space:pre-wrap">${safeMessage}</div>
        </td></tr>
        <tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f0f2">
          <p style="margin:0;font-size:12px;color:#9a99a6">This email was sent by Qwik.ng admin communications.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        text: `${body.subject}\n\n${body.message}`,
      });

      if (result.error) {
        failedCount += 1;
        failedRecipients.push(seller.id);
        await prisma.emailRecipientLog.create({
          data: {
            campaignId: campaign.id,
            userId: seller.id,
            email: seller.email,
            status: "FAILED",
            error: result.error.message || "Unknown send error",
          },
        });
      } else {
        sentCount += 1;
        await prisma.emailRecipientLog.create({
          data: {
            campaignId: campaign.id,
            userId: seller.id,
            email: seller.email,
            status: "SENT",
          },
        });
      }
    }

    // Log skipped non-sellers
    const nonSellerIds = uniqueUserIds.filter((id) => !eligibleSellers.some((seller) => seller.id === id));
    await Promise.all(
      nonSellerIds.map((id) =>
        prisma.emailRecipientLog.create({
          data: {
            campaignId: campaign.id,
            userId: id,
            status: "SKIPPED",
            error: "User is not an active seller",
          },
        }),
      ),
    );

    // Update campaign status
    const finalStatus = sentCount > 0 && failedCount === 0 ? "SENT" : sentCount > 0 ? "PARTIAL" : "FAILED";
    await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        status: finalStatus,
        sentCount,
        failedCount,
        skippedCount: skippedNonSellerCount,
      },
    });

    await auditAdminAction(req, "ADMIN_SELECTED_SELLERS_EMAIL_SENT", "User", undefined, {
      campaignId: campaign.id,
      requestedCount,
      eligibleCount,
      sentCount,
      failedCount,
      skippedNonSellerCount,
      selectedUserIds: uniqueUserIds,
      eligibleSellerIds: eligibleSellers.map((seller) => seller.id),
      missingSelectedIds: uniqueUserIds.filter((id) => !selectedUsers.some((user) => user.id === id)),
      failedRecipientIds: failedRecipients,
      subject: body.subject.trim(),
    });

    return res.json({
      success: true,
      data: {
        campaignId: campaign.id,
        requestedCount,
        eligibleCount,
        sentCount,
        failedCount,
        skippedNonSellerCount,
      },
      message: `Processed ${requestedCount} selected users: sent ${sentCount}, failed ${failedCount}, skipped ${skippedNonSellerCount}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send email to selected sellers";
    return res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
  }
});

router.get("/communications/campaigns", async (req: Request, res: Response) => {
  try {
    const campaigns = await prisma.emailCampaign.findMany({
      where: { adminId: req.auth!.userId },
      select: {
        id: true,
        type: true,
        status: true,
        subject: true,
        requestedCount: true,
        eligibleCount: true,
        sentCount: true,
        failedCount: true,
        skippedCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    res.json({ success: true, data: campaigns });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch campaigns";
    res.status(500).json({ success: false, message });
  }
});

router.get("/communications/campaigns/:id", async (req: Request, res: Response) => {
  try {
    const campaign = await prisma.emailCampaign.findUnique({
      where: { id: String(req.params.id) },
      include: {
        recipients: {
          select: {
            id: true,
            userId: true,
            email: true,
            status: true,
            error: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // Verify admin owns this campaign
    if (campaign.adminId !== req.auth!.userId) {
      return res.status(403).json({ success: false, message: "Not authorized to view this campaign" });
    }

    res.json({ success: true, data: campaign });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch campaign details";
    res.status(500).json({ success: false, message });
  }
});

export default router;
