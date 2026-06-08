"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
    try {
        if (!req.auth) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: req.auth.userId },
        });
        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        next();
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};
// Apply auth middleware to all admin routes
router.use(auth_1.requireAuth);
router.use(requireAdmin);
// Get dashboard stats
router.get('/stats', async (req, res) => {
    try {
        const totalUsers = await prisma_1.prisma.user.count();
        const totalAds = await prisma_1.prisma.ad.count();
        const totalReports = await prisma_1.prisma.report.count();
        const pendingReports = await prisma_1.prisma.report.count({
            where: { status: 'PENDING' },
        });
        res.json({
            success: true,
            data: {
                totalUsers,
                totalAds,
                totalReports,
                pendingReports,
            },
        });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    }
});
// Get all users
router.get('/users', async (req, res) => {
    try {
        const users = await prisma_1.prisma.user.findMany({
            select: {
                id: true,
                email: true,
                fullName: true,
                phone: true,
                location: true,
                role: true,
                createdAt: true,
                _count: {
                    select: { ads: true, reviews: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json({ success: true, data: users });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});
// Get all ads
router.get('/ads', async (req, res) => {
    try {
        const ads = await prisma_1.prisma.ad.findMany({
            include: {
                user: {
                    select: { id: true, fullName: true, email: true },
                },
                category: true,
                _count: {
                    select: { images: true, reviews: true, reports: true },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
        res.json({ success: true, data: ads });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch ads' });
    }
});
// Get all reports
router.get('/reports', async (req, res) => {
    try {
        const reports = await prisma_1.prisma.report.findMany({
            include: {
                ad: {
                    select: { id: true, title: true },
                },
                user: {
                    select: { id: true, fullName: true, email: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ success: true, data: reports });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch reports' });
    }
});
// Update report status
router.patch('/reports/:id', async (req, res) => {
    try {
        const id = String(req.params.id);
        const { status } = req.body;
        if (!['PENDING', 'RESOLVED', 'DISMISSED'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }
        const report = await prisma_1.prisma.report.update({
            where: { id },
            data: { status },
        });
        res.json({ success: true, data: report });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update report' });
    }
});
// Delete ad (mod action)
router.delete('/ads/:id', async (req, res) => {
    try {
        const id = String(req.params.id);
        await prisma_1.prisma.ad.delete({
            where: { id },
        });
        res.json({ success: true, message: 'Ad deleted successfully' });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete ad' });
    }
});
// Ban user
router.post('/users/:id/ban', async (req, res) => {
    try {
        const id = String(req.params.id);
        // Instead of deleting, you could add a banned field. For now, we'll mark the email as disabled
        // This is a simple implementation - in production you'd add a banned/disabled field to User model
        const user = await prisma_1.prisma.user.update({
            where: { id },
            data: { email: `${id}-banned@banned.local` },
        });
        res.json({ success: true, message: 'User banned successfully', data: user });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Failed to ban user' });
    }
});
exports.default = router;
