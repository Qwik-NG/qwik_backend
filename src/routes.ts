import { Router } from "express";
import authRoutes from "./modules/auth/routes";
import userRoutes from "./modules/users/routes";
import categoryRoutes from "./modules/categories/routes";
import adRoutes from "./modules/ads/routes";
import uploadRoutes from "./modules/uploads/routes";
import adminRoutes from "./modules/admin/routes";

const router = Router();
router.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/categories", categoryRoutes);
router.use("/ads", adRoutes);
router.use("/uploads", uploadRoutes);
router.use("/admin", adminRoutes);
export default router;
