"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const resend_1 = require("resend");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const validation_1 = require("../../utils/validation");
const admin_cache_1 = require("../../lib/admin-cache");
const env_1 = require("../../config/env");
const resend = env_1.env.resendApiKey ? new resend_1.Resend(env_1.env.resendApiKey) : null;
const router = (0, express_1.Router)();
const ADMIN_ACCESS_CACHE_TTL_MS = 10000;
const adminAccessCache = new Map();
const reportStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["PENDING", "RESOLVED", "DISMISSED"]),
    note: zod_1.z.string().trim().min(3).max(500).optional(),
    unlistAd: zod_1.z.boolean().optional().default(false),
});
const verificationReviewSchema = zod_1.z.object({
    status: zod_1.z.enum(["IN_REVIEW", "APPROVED", "REJECTED"]),
    rejectionReason: zod_1.z.string().trim().max(1000).optional(),
    decisionNote: zod_1.z.string().trim().max(1000).optional(),
});
const banUserSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(3).max(500).optional(),
});
const deleteUserSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(3).max(500).optional(),
});
const adModerationSchema = zod_1.z.object({
    status: zod_1.z.enum(["ACTIVE", "ARCHIVED"]),
    reason: zod_1.z.string().trim().min(3).max(500).optional(),
});
const adDeleteSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(3).max(500).optional(),
});
const reviewModerationSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(3).max(500),
});
const pageQuerySchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).default(1),
    pageSize: zod_1.z.coerce.number().int().min(1).max(100).default(50),
});
const adminUsersQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
    role: zod_1.z.enum(["USER", "ADMIN"]).optional(),
    status: zod_1.z.enum(["ACTIVE", "BANNED"]).optional(),
});
const adminAdsQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
    status: zod_1.z.enum(["ACTIVE", "ARCHIVED", "SOLD", "DRAFT"]).optional(),
});
const adminReportsQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
    status: zod_1.z.enum(["PENDING", "RESOLVED", "DISMISSED"]).optional(),
});
const adminReviewsQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
});
const adminVerificationsQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
    status: zod_1.z.enum(["DRAFT", "SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED"]).optional(),
    from: zod_1.z.string().trim().optional(),
    to: zod_1.z.string().trim().optional(),
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
};
function getPage(req) {
    const parsed = pageQuerySchema.parse(req.query);
    return {
        page: parsed.page,
        pageSize: parsed.pageSize,
        skip: (parsed.page - 1) * parsed.pageSize,
    };
}
async function auditAdminAction(req, action, targetType, targetId, metadata) {
    if (!req.auth?.userId)
        return;
    await prisma_1.prisma.adminAuditLog.create({
        data: {
            adminId: req.auth.userId,
            action,
            targetType,
            targetId,
            metadata,
        },
    });
}
function notFound(res, message) {
    return res.status(404).json({ success: false, message });
}
const requireAdmin = async (req, res, next) => {
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
        const user = await prisma_1.prisma.user.findUnique({
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
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to verify admin access" });
    }
};
router.use(auth_1.requireAuth);
router.use(requireAdmin);
router.get("/stats", async (_req, res) => {
    try {
        const cacheKey = (0, admin_cache_1.getCacheKey)("/admin/stats");
        const cached = (0, admin_cache_1.getCached)(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached, _cached: true });
        }
        const [totalUsers, bannedUsers, totalAds, totalReports, pendingReports, pendingVerifications] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.user.count(),
            prisma_1.prisma.user.count({ where: { status: "BANNED" } }),
            prisma_1.prisma.ad.count(),
            prisma_1.prisma.report.count(),
            prisma_1.prisma.report.count({ where: { status: "PENDING" } }),
            prisma_1.prisma.verificationApplication.count({ where: { status: { in: ["SUBMITTED", "IN_REVIEW"] } } }),
        ]);
        const data = {
            totalUsers,
            bannedUsers,
            totalAds,
            totalReports,
            pendingReports,
            pendingVerifications,
        };
        (0, admin_cache_1.setCached)(cacheKey, data, admin_cache_1.CACHE_TTLS.STATS);
        res.json({
            success: true,
            data,
        });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to fetch admin stats" });
    }
});
router.get("/users", async (req, res) => {
    try {
        const { page, pageSize, skip } = getPage(req);
        const query = (0, validation_1.parseOrThrow)(adminUsersQuerySchema, req.query);
        const search = query.search?.toLowerCase();
        const where = {};
        if (query.role)
            where.role = query.role;
        if (query.status)
            where.status = query.status;
        if (search) {
            where.OR = [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { location: { contains: search, mode: "insensitive" } },
            ];
        }
        const cacheKey = (0, admin_cache_1.getCacheKey)("/admin/users", {
            page,
            pageSize,
            search: query.search,
            role: query.role,
            status: query.status,
        });
        const cached = (0, admin_cache_1.getCached)(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
        }
        const [users, total] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.user.findMany({
                where,
                select: safeAdminUserSelect,
                orderBy: { createdAt: "desc" },
                skip,
                take: pageSize,
            }),
            prisma_1.prisma.user.count({ where }),
        ]);
        const cacheData = { data: users, meta: { page, pageSize, total } };
        (0, admin_cache_1.setCached)(cacheKey, cacheData, admin_cache_1.CACHE_TTLS.USERS);
        res.json({ success: true, data: users, meta: { page, pageSize, total } });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
});
router.get("/ads", async (req, res) => {
    try {
        const { page, pageSize, skip } = getPage(req);
        const query = (0, validation_1.parseOrThrow)(adminAdsQuerySchema, req.query);
        const search = query.search?.toLowerCase();
        const where = {};
        if (query.status)
            where.status = query.status;
        if (search) {
            where.OR = [
                { title: { contains: search, mode: "insensitive" } },
                { user: { is: { fullName: { contains: search, mode: "insensitive" } } } },
                { category: { is: { name: { contains: search, mode: "insensitive" } } } },
            ];
        }
        const cacheKey = (0, admin_cache_1.getCacheKey)("/admin/ads", {
            page,
            pageSize,
            search: query.search,
            status: query.status,
        });
        const cached = (0, admin_cache_1.getCached)(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
        }
        const [ads, total] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.ad.findMany({
                where,
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
                orderBy: { createdAt: "desc" },
                skip,
                take: pageSize,
            }),
            prisma_1.prisma.ad.count({ where }),
        ]);
        const cacheData = { data: ads, meta: { page, pageSize, total } };
        (0, admin_cache_1.setCached)(cacheKey, cacheData, admin_cache_1.CACHE_TTLS.ADS);
        res.json({ success: true, data: ads, meta: { page, pageSize, total } });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to fetch ads" });
    }
});
router.patch("/ads/:id/status", async (req, res) => {
    try {
        const id = String(req.params.id);
        const body = (0, validation_1.parseOrThrow)(adModerationSchema, req.body ?? {});
        const existing = await prisma_1.prisma.ad.findUnique({
            where: { id },
            select: { id: true, title: true, userId: true, status: true },
        });
        if (!existing)
            return notFound(res, "Ad not found");
        const ad = await prisma_1.prisma.ad.update({
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
        (0, admin_cache_1.invalidateCache)("/admin/ads", "/admin/reports", "/admin/stats", "/admin/audit-log");
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update ad status";
        res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
    }
});
router.get("/reports", async (req, res) => {
    try {
        const { page, pageSize, skip } = getPage(req);
        const query = (0, validation_1.parseOrThrow)(adminReportsQuerySchema, req.query);
        const search = query.search?.toLowerCase();
        const where = {};
        if (query.status)
            where.status = query.status;
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
        const cacheKey = (0, admin_cache_1.getCacheKey)("/admin/reports", {
            page,
            pageSize,
            search: query.search,
            status: query.status,
        });
        const cached = (0, admin_cache_1.getCached)(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
        }
        const [reports, total] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.report.findMany({
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
            prisma_1.prisma.report.count({ where }),
        ]);
        const cacheData = { data: reports, meta: { page, pageSize, total } };
        (0, admin_cache_1.setCached)(cacheKey, cacheData, admin_cache_1.CACHE_TTLS.REPORTS);
        res.json({ success: true, data: reports, meta: { page, pageSize, total } });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to fetch reports" });
    }
});
router.get("/reviews", async (req, res) => {
    try {
        const { page, pageSize, skip } = getPage(req);
        const query = (0, validation_1.parseOrThrow)(adminReviewsQuerySchema, req.query);
        const search = query.search?.toLowerCase();
        const where = {};
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
        const cacheKey = (0, admin_cache_1.getCacheKey)("/admin/reviews", {
            page,
            pageSize,
            search: query.search,
        });
        const cached = (0, admin_cache_1.getCached)(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
        }
        const [reviews, total] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.review.findMany({
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
            prisma_1.prisma.review.count({ where }),
        ]);
        const cacheData = { data: reviews, meta: { page, pageSize, total } };
        (0, admin_cache_1.setCached)(cacheKey, cacheData, admin_cache_1.CACHE_TTLS.REVIEWS);
        res.json({ success: true, data: reviews, meta: { page, pageSize, total } });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to fetch reviews" });
    }
});
router.delete("/reviews/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        const body = (0, validation_1.parseOrThrow)(reviewModerationSchema, req.body ?? {});
        const existing = await prisma_1.prisma.review.findUnique({
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
        if (!existing)
            return notFound(res, "Review not found");
        await prisma_1.prisma.review.delete({ where: { id } });
        // Invalidate related caches
        (0, admin_cache_1.invalidateCache)("/admin/reviews", "/admin/stats", "/admin/audit-log");
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to moderate review";
        res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
    }
});
router.patch("/reports/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        const body = (0, validation_1.parseOrThrow)(reportStatusSchema, req.body);
        if (body.unlistAd && body.status !== "RESOLVED") {
            return res.status(400).json({ success: false, message: "Ad unlisting is only allowed when resolving a report" });
        }
        const existing = await prisma_1.prisma.report.findUnique({
            where: { id },
            select: { id: true, status: true, adId: true, reason: true },
        });
        if (!existing)
            return notFound(res, "Report not found");
        const adBefore = body.unlistAd
            ? await prisma_1.prisma.ad.findUnique({
                where: { id: existing.adId },
                select: { id: true, title: true, status: true, userId: true },
            })
            : null;
        const report = await prisma_1.prisma.$transaction(async (tx) => {
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
        (0, admin_cache_1.invalidateCache)("/admin/reports", "/admin/ads", "/admin/stats", "/admin/audit-log");
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update report";
        res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
    }
});
router.get("/verifications", async (req, res) => {
    try {
        const { page, pageSize, skip } = getPage(req);
        const query = (0, validation_1.parseOrThrow)(adminVerificationsQuerySchema, req.query);
        const where = {};
        if (query.status)
            where.status = query.status;
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
                if (!isNaN(fromDate.getTime()))
                    where.createdAt.gte = fromDate;
            }
            if (query.to) {
                const toDate = new Date(query.to);
                if (!isNaN(toDate.getTime())) {
                    toDate.setHours(23, 59, 59, 999);
                    where.createdAt.lte = toDate;
                }
            }
        }
        const cacheKey = (0, admin_cache_1.getCacheKey)("/admin/verifications", {
            page,
            pageSize,
            status: query.status,
            search: query.search,
            from: query.from,
            to: query.to,
        });
        const cached = (0, admin_cache_1.getCached)(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
        }
        const [verifications, total] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.verificationApplication.findMany({
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
            prisma_1.prisma.verificationApplication.count({ where }),
        ]);
        const cacheData = { data: verifications, meta: { page, pageSize, total } };
        (0, admin_cache_1.setCached)(cacheKey, cacheData, admin_cache_1.CACHE_TTLS.VERIFICATIONS);
        res.json({ success: true, data: verifications, meta: { page, pageSize, total } });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to fetch verifications" });
    }
});
router.patch("/verifications/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        const body = (0, validation_1.parseOrThrow)(verificationReviewSchema, req.body);
        if (body.status === "REJECTED" && !body.rejectionReason?.trim()) {
            return res.status(400).json({ success: false, message: "Rejection reason is required" });
        }
        const existing = await prisma_1.prisma.verificationApplication.findUnique({ where: { id }, select: { id: true, status: true } });
        if (!existing)
            return notFound(res, "Verification application not found");
        const verification = await prisma_1.prisma.verificationApplication.update({
            where: { id },
            data: {
                status: body.status,
                rejectionReason: body.status === "REJECTED" ? body.rejectionReason : null,
                reviewedAt: body.status === "APPROVED" || body.status === "REJECTED" ? new Date() : null,
                reviewerId: req.auth.userId,
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
        (0, admin_cache_1.invalidateCache)("/admin/verifications", "/admin/stats", "/admin/audit-log");
        await auditAdminAction(req, "VERIFICATION_REVIEWED", "VerificationApplication", id, {
            previousStatus: existing.status,
            status: body.status,
            decisionNote: body.decisionNote ?? null,
        });
        res.json({ success: true, data: verification, message: "Verification updated" });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update verification";
        res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
    }
});
router.delete("/ads/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        const body = (0, validation_1.parseOrThrow)(adDeleteSchema, req.body ?? {});
        const existing = await prisma_1.prisma.ad.findUnique({ where: { id }, select: { id: true, title: true, userId: true } });
        if (!existing)
            return notFound(res, "Ad not found");
        await prisma_1.prisma.ad.delete({ where: { id } });
        // Invalidate related caches
        (0, admin_cache_1.invalidateCache)("/admin/ads", "/admin/stats", "/admin/audit-log");
        await auditAdminAction(req, "AD_DELETED", "Ad", id, {
            title: existing.title,
            userId: existing.userId,
            reason: body.reason ?? null,
        });
        res.json({ success: true, data: null, message: "Ad deleted successfully" });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to delete ad" });
    }
});
router.post("/users/:id/ban", async (req, res) => {
    try {
        const id = String(req.params.id);
        if (id === req.auth?.userId) {
            return res.status(400).json({ success: false, message: "Admins cannot ban their own account" });
        }
        const body = (0, validation_1.parseOrThrow)(banUserSchema, req.body ?? {});
        const existing = await prisma_1.prisma.user.findUnique({ where: { id }, select: { id: true, role: true, status: true } });
        if (!existing)
            return notFound(res, "User not found");
        if (existing.role === "ADMIN")
            return res.status(400).json({ success: false, message: "Admin accounts cannot be banned here" });
        const user = await prisma_1.prisma.user.update({
            where: { id },
            data: {
                status: "BANNED",
                bannedAt: new Date(),
                banReason: body.reason ?? "Policy violation",
            },
            select: safeAdminUserSelect,
        });
        // Invalidate related caches
        (0, admin_cache_1.invalidateCache)("/admin/users", "/admin/stats", "/admin/audit-log");
        adminAccessCache.delete(id);
        await auditAdminAction(req, "USER_BANNED", "User", id, { reason: user.banReason });
        res.json({ success: true, message: "User banned successfully", data: user });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to ban user";
        res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
    }
});
router.post("/users/:id/unban", async (req, res) => {
    try {
        const id = String(req.params.id);
        const existing = await prisma_1.prisma.user.findUnique({ where: { id }, select: { id: true, status: true } });
        if (!existing)
            return notFound(res, "User not found");
        const user = await prisma_1.prisma.user.update({
            where: { id },
            data: { status: "ACTIVE", bannedAt: null, banReason: null },
            select: safeAdminUserSelect,
        });
        // Invalidate related caches
        (0, admin_cache_1.invalidateCache)("/admin/users", "/admin/stats", "/admin/audit-log");
        adminAccessCache.delete(id);
        await auditAdminAction(req, "USER_UNBANNED", "User", id);
        res.json({ success: true, message: "User restored successfully", data: user });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to restore user" });
    }
});
router.delete("/users/:id", async (req, res) => {
    try {
        const id = String(req.params.id);
        if (id === req.auth?.userId) {
            return res.status(400).json({ success: false, message: "Admins cannot delete their own account" });
        }
        const body = (0, validation_1.parseOrThrow)(deleteUserSchema, req.body ?? {});
        const existing = await prisma_1.prisma.user.findUnique({
            where: { id },
            select: { id: true, role: true, status: true, fullName: true, email: true },
        });
        if (!existing)
            return notFound(res, "User not found");
        if (existing.role === "ADMIN") {
            return res.status(400).json({ success: false, message: "Admin accounts cannot be deleted here" });
        }
        await prisma_1.prisma.user.delete({ where: { id } });
        // Invalidate related caches
        (0, admin_cache_1.invalidateCache)("/admin/users", "/admin/stats", "/admin/audit-log");
        adminAccessCache.delete(id);
        await auditAdminAction(req, "USER_DELETED", "User", id, {
            fullName: existing.fullName,
            email: existing.email,
            previousStatus: existing.status,
            reason: body.reason ?? null,
        });
        res.json({ success: true, data: null, message: "User deleted successfully" });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to delete user";
        res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
    }
});
const auditLogQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
    action: zod_1.z.string().trim().optional(),
    targetType: zod_1.z.string().trim().optional(),
    from: zod_1.z.string().trim().optional(),
    to: zod_1.z.string().trim().optional(),
});
router.get("/audit-log", async (req, res) => {
    try {
        const { page, pageSize, skip } = getPage(req);
        const query = (0, validation_1.parseOrThrow)(auditLogQuerySchema, req.query);
        // Generate cache key - include query filters
        const cacheKey = (0, admin_cache_1.getCacheKey)("/admin/audit-log", {
            page,
            pageSize,
            search: query.search,
            action: query.action,
            targetType: query.targetType,
            from: query.from,
            to: query.to,
        });
        const cached = (0, admin_cache_1.getCached)(cacheKey);
        if (cached) {
            return res.json({ success: true, data: cached.data, meta: cached.meta, _cached: true });
        }
        const where = {};
        if (query.action)
            where.action = query.action;
        if (query.targetType)
            where.targetType = query.targetType;
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
                if (!isNaN(fromDate.getTime()))
                    where.createdAt.gte = fromDate;
            }
            if (query.to) {
                const toDate = new Date(query.to);
                if (!isNaN(toDate.getTime())) {
                    toDate.setHours(23, 59, 59, 999);
                    where.createdAt.lte = toDate;
                }
            }
        }
        const [logs, total] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.adminAuditLog.findMany({
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
            prisma_1.prisma.adminAuditLog.count({ where }),
        ]);
        const cacheData = { data: logs, meta: { page, pageSize, total } };
        // Very short TTL for audit log since it must reflect recent actions
        (0, admin_cache_1.setCached)(cacheKey, cacheData, admin_cache_1.CACHE_TTLS.AUDIT_LOG);
        res.json({ success: true, data: logs, meta: { page, pageSize, total } });
    }
    catch {
        res.status(500).json({ success: false, message: "Failed to fetch audit log" });
    }
});
// ===== Communications: Phase 2A — Test Email Only =====
const testEmailSchema = zod_1.z.object({
    subject: zod_1.z.string().trim().min(1, "Subject is required").max(120, "Subject must be 120 characters or fewer"),
    message: zod_1.z.string().trim().min(1, "Message is required").max(5000, "Message must be 5000 characters or fewer"),
});
router.post("/communications/test-email", async (req, res) => {
    try {
        const body = (0, validation_1.parseOrThrow)(testEmailSchema, req.body ?? {});
        // Always resolve the admin's own email from the database — never accept a recipient in the request body
        const admin = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
            select: { id: true, email: true, fullName: true },
        });
        if (!admin || !admin.email) {
            return res.status(400).json({ success: false, message: "Admin email address could not be resolved." });
        }
        if (!resend) {
            if (env_1.env.isProduction) {
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
            from: env_1.env.resendFromEmail,
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send test email";
        res.status(message.includes("Invalid") ? 400 : 500).json({ success: false, message });
    }
});
exports.default = router;
