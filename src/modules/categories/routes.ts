import { Router } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();

const categoryInclude = {
  children: {
    orderBy: {
      name: "asc" as const,
    },
  },
};

router.get("/", async (_req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      where: { parentId: null },
      include: categoryInclude,
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: categories });
  } catch (e) {
    next(e);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const slug = String(req.params.slug).trim().toLowerCase();
    const category = await prisma.category.findUnique({
      where: { slug },
      include: {
        ...categoryInclude,
        parent: true,
      },
    });

    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    res.json({ success: true, data: category });
  } catch (e) {
    next(e);
  }
});

export default router;
