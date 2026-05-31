import { Router } from "express";
import multer from "multer";
const router = Router();
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });
router.post("/images", upload.array("images", 10), (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  res.json({ success: true, data: { urls: files.map((f) => `/uploads/${f.filename}`) } });
});
export default router;
