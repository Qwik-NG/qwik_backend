import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireActiveUser, requireAuth } from "../../middleware/auth";
import { parseOrThrow } from "../../utils/validation";

const router = Router();

const verificationInclude = {
  documents: { orderBy: { createdAt: "desc" as const } },
  payments: { orderBy: { createdAt: "desc" as const }, take: 5 },
};

const businessInfoSchema = z.object({
  businessName: z.string().optional(),
  storeName: z.string().optional(),
  businessType: z.string().optional(),
  businessCategory: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  nin: z.string().optional(),
  dateOfBirth: z.string().optional(),
});

const documentSchema = z.object({
  url: z.string().min(1),
  name: z.string().optional(),
  type: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  purpose: z.string().min(2).default("verification_document"),
});

async function findOwnVerification(id: string, userId: string) {
  return prisma.verificationApplication.findFirst({
    where: { id, userId },
    include: verificationInclude,
  });
}

router.use(requireAuth);

router.get("/me", async (req, res, next) => {
  try {
    const verification = await prisma.verificationApplication.findUnique({
      where: { userId: req.auth!.userId },
      include: verificationInclude,
    });
    res.json({ success: true, data: verification });
  } catch (e) {
    next(e);
  }
});

router.post("/", requireActiveUser, async (req, res, next) => {
  try {
    const verification = await prisma.verificationApplication.upsert({
      where: { userId: req.auth!.userId },
      update: {},
      create: { userId: req.auth!.userId },
      include: verificationInclude,
    });
    res.status(201).json({ success: true, data: verification });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/business-info", requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await findOwnVerification(id, req.auth!.userId);
    if (!existing) return res.status(404).json({ success: false, message: "Verification not found" });
    if (["SUBMITTED", "IN_REVIEW", "APPROVED"].includes(existing.status)) {
      return res.status(409).json({ success: false, message: "Submitted verification details cannot be edited" });
    }

    const businessInfo = parseOrThrow(businessInfoSchema, req.body);
    const verification = await prisma.verificationApplication.update({
      where: { id },
      data: {
        businessInfo,
        status: "DRAFT",
        rejectionReason: null,
      },
      include: verificationInclude,
    });
    res.json({ success: true, data: verification, message: "Business information saved" });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/documents", requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await findOwnVerification(id, req.auth!.userId);
    if (!existing) return res.status(404).json({ success: false, message: "Verification not found" });
    if (["SUBMITTED", "IN_REVIEW", "APPROVED"].includes(existing.status)) {
      return res.status(409).json({ success: false, message: "Submitted verification documents cannot be edited" });
    }

    const body = parseOrThrow(
      z.object({
        documents: z.array(documentSchema).min(1),
      }),
      req.body,
    );

    const verification = await prisma.$transaction(async (tx) => {
      await tx.verificationDocument.createMany({
        data: body.documents.map((doc) => ({
          verificationId: id,
          url: doc.url,
          name: doc.name,
          type: doc.type,
          size: doc.size,
          purpose: doc.purpose,
        })),
      });
      return tx.verificationApplication.update({
        where: { id },
        data: { status: "DRAFT", rejectionReason: null },
        include: verificationInclude,
      });
    });

    res.status(201).json({ success: true, data: verification, message: "Documents attached" });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/submit", requireActiveUser, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await findOwnVerification(id, req.auth!.userId);
    if (!existing) return res.status(404).json({ success: false, message: "Verification not found" });
    if (existing.status === "APPROVED") {
      return res.status(409).json({ success: false, message: "Verification is already approved" });
    }
    if (!existing.businessInfo) {
      return res.status(400).json({ success: false, message: "Business information is required before submission" });
    }
    if (existing.documents.length === 0) {
      return res.status(400).json({ success: false, message: "At least one verification document is required" });
    }

    const verification = await prisma.verificationApplication.update({
      where: { id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        rejectionReason: null,
      },
      include: verificationInclude,
    });

    res.json({ success: true, data: verification, message: "Verification submitted for review" });
  } catch (e) {
    next(e);
  }
});

export default router;
