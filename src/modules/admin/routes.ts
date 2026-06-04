import { Router, Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/auth';

const router = Router();

// Middleware to check if user is admin
const requireAdmin = async (req: Request, res: Response, next: Function) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
    });

    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    next();
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

// Apply auth middleware to all admin routes
router.use(requireAuth);
router.use(requireAdmin);

// Get dashboard stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const totalUsers = await prisma.user.count();
    const totalAds = await prisma.ad.count();
    const totalReports = await prisma.report.count();
    const pendingReports = await prisma.report.count({
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
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch stats' });
  }
});

// Get all users
router.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
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
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// Get all ads
router.get('/ads', async (req: Request, res: Response) => {
  try {
    const ads = await prisma.ad.findMany({
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
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch ads' });
  }
});

// Get all reports
router.get('/reports', async (req: Request, res: Response) => {
  try {
    const reports = await prisma.report.findMany({
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
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch reports' });
  }
});

// Update report status
router.patch('/reports/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['PENDING', 'RESOLVED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const report = await prisma.report.update({
      where: { id },
      data: { status },
    });

    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update report' });
  }
});

// Delete ad (mod action)
router.delete('/ads/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.ad.delete({
      where: { id },
    });

    res.json({ success: true, message: 'Ad deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete ad' });
  }
});

// Ban user
router.post('/users/:id/ban', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Instead of deleting, you could add a banned field. For now, we'll mark the email as disabled
    // This is a simple implementation - in production you'd add a banned/disabled field to User model
    const user = await prisma.user.update({
      where: { id },
      data: { email: `${id}-banned@banned.local` },
    });

    res.json({ success: true, message: 'User banned successfully', data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to ban user' });
  }
});

export default router;
