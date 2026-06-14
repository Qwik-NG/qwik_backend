"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const auth_1 = require("../../middleware/auth");
const validation_1 = require("../../utils/validation");
const router = (0, express_1.Router)();
const verificationInclude = {
    documents: { orderBy: { createdAt: "desc" } },
    payments: { orderBy: { createdAt: "desc" }, take: 5 },
};
const businessInfoSchema = zod_1.z.object({
    businessName: zod_1.z.string().optional(),
    storeName: zod_1.z.string().optional(),
    businessType: zod_1.z.string().optional(),
    businessCategory: zod_1.z.string().optional(),
    email: zod_1.z.string().optional(),
    phone: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
    state: zod_1.z.string().optional(),
    city: zod_1.z.string().optional(),
    nin: zod_1.z.string().optional(),
    dateOfBirth: zod_1.z.string().optional(),
});
const documentSchema = zod_1.z.object({
    url: zod_1.z.string().url().refine((url) => url.startsWith("https://res.cloudinary.com/"), "Invalid document URL"),
    name: zod_1.z.string().optional(),
    type: zod_1.z.string().optional(),
    size: zod_1.z.number().int().nonnegative().optional(),
    purpose: zod_1.z.string().min(2).default("verification_document"),
});
async function findOwnVerification(id, userId) {
    return prisma_1.prisma.verificationApplication.findFirst({
        where: { id, userId },
        include: verificationInclude,
    });
}
router.use(auth_1.requireAuth);
router.get("/me", async (req, res, next) => {
    try {
        const verification = await prisma_1.prisma.verificationApplication.findUnique({
            where: { userId: req.auth.userId },
            include: verificationInclude,
        });
        res.json({ success: true, data: verification });
    }
    catch (e) {
        next(e);
    }
});
router.post("/", auth_1.requireActiveUser, async (req, res, next) => {
    try {
        const verification = await prisma_1.prisma.verificationApplication.upsert({
            where: { userId: req.auth.userId },
            update: {},
            create: { userId: req.auth.userId },
            include: verificationInclude,
        });
        res.status(201).json({ success: true, data: verification });
    }
    catch (e) {
        next(e);
    }
});
router.patch("/:id/business-info", auth_1.requireActiveUser, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const existing = await findOwnVerification(id, req.auth.userId);
        if (!existing)
            return res.status(404).json({ success: false, message: "Verification not found" });
        if (["SUBMITTED", "IN_REVIEW", "APPROVED"].includes(existing.status)) {
            return res.status(409).json({ success: false, message: "Submitted verification details cannot be edited" });
        }
        const businessInfo = (0, validation_1.parseOrThrow)(businessInfoSchema, req.body);
        const verification = await prisma_1.prisma.verificationApplication.update({
            where: { id },
            data: {
                businessInfo,
                status: "DRAFT",
                rejectionReason: null,
            },
            include: verificationInclude,
        });
        res.json({ success: true, data: verification, message: "Business information saved" });
    }
    catch (e) {
        next(e);
    }
});
router.post("/:id/documents", auth_1.requireActiveUser, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const existing = await findOwnVerification(id, req.auth.userId);
        if (!existing)
            return res.status(404).json({ success: false, message: "Verification not found" });
        if (["SUBMITTED", "IN_REVIEW", "APPROVED"].includes(existing.status)) {
            return res.status(409).json({ success: false, message: "Submitted verification documents cannot be edited" });
        }
        const body = (0, validation_1.parseOrThrow)(zod_1.z.object({
            documents: zod_1.z.array(documentSchema).min(1),
        }), req.body);
        const verification = await prisma_1.prisma.$transaction(async (tx) => {
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
    }
    catch (e) {
        next(e);
    }
});
router.post("/:id/submit", auth_1.requireActiveUser, async (req, res, next) => {
    try {
        const id = String(req.params.id);
        const existing = await findOwnVerification(id, req.auth.userId);
        if (!existing)
            return res.status(404).json({ success: false, message: "Verification not found" });
        if (existing.status === "APPROVED") {
            return res.status(409).json({ success: false, message: "Verification is already approved" });
        }
        if (!existing.businessInfo) {
            return res.status(400).json({ success: false, message: "Business information is required before submission" });
        }
        if (existing.documents.length === 0) {
            return res.status(400).json({ success: false, message: "At least one verification document is required" });
        }
        const verification = await prisma_1.prisma.verificationApplication.update({
            where: { id },
            data: {
                status: "SUBMITTED",
                submittedAt: new Date(),
                rejectionReason: null,
            },
            include: verificationInclude,
        });
        res.json({ success: true, data: verification, message: "Verification submitted for review" });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
