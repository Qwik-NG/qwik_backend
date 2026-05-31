import { Router } from "express";
import { prisma } from "../../lib/prisma";
const router = Router();
router.get("/", async (_req, res, next) => { try { res.json({ success: true, data: await prisma.category.findMany({ orderBy: { name: "asc" } }) }); } catch (e) { next(e); } });
export default router;
