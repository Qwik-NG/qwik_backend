"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const promises_1 = require("fs/promises");
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const env_1 = require("../../config/env");
const cloudinary_1 = require("../../lib/cloudinary");
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const documentTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
]);
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 10,
    },
    fileFilter: (_req, file, cb) => {
        const validTypes = file.fieldname === "documents" ? documentTypes : imageTypes;
        if (!validTypes.has(file.mimetype)) {
            cb(new Error(`${file.originalname} has an unsupported file type`));
            return;
        }
        cb(null, true);
    },
});
function getUploadErrorCode(err) {
    if (typeof err !== "object" || err === null || !("code" in err)) {
        return undefined;
    }
    const code = err.code;
    return typeof code === "string" ? code : undefined;
}
function getUploadErrorMessage(err) {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err !== "object" || err === null || !("message" in err)) {
        return undefined;
    }
    const message = err.message;
    return typeof message === "string" ? message : undefined;
}
function getFiles(req) {
    return (req.files ?? []);
}
function rejectInvalidFiles(files, allowedTypes) {
    const invalid = files.find((file) => !allowedTypes.has(file.mimetype));
    if (invalid) {
        return `${invalid.originalname} has an unsupported file type`;
    }
    return null;
}
function fileExtension(file) {
    const fallback = file.mimetype.split("/")[1] || "bin";
    return path_1.default.extname(file.originalname).replace(".", "") || fallback;
}
async function saveLocalUpload(file, folder) {
    const uploadDir = path_1.default.resolve("uploads", folder);
    await (0, promises_1.mkdir)(uploadDir, { recursive: true });
    const id = crypto_1.default.randomUUID();
    const filename = `${id}.${fileExtension(file)}`;
    await (0, promises_1.writeFile)(path_1.default.join(uploadDir, filename), file.buffer);
    return {
        id,
        url: `/uploads/${folder}/${filename}`,
    };
}
function normalizeUploadError(err, _req, res, next) {
    const code = getUploadErrorCode(err);
    const message = getUploadErrorMessage(err);
    if (code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ success: false, message: "Each file must be 5MB or smaller" });
    }
    if (code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({ success: false, message: "You can upload up to 10 files at a time" });
    }
    if (message?.includes("unsupported file type")) {
        return res.status(400).json({ success: false, message });
    }
    if (err instanceof multer_1.default.MulterError) {
        return res.status(400).json({ success: false, message: message || "Upload failed" });
    }
    next(err);
}
router.post("/images", auth_1.requireAuth, (req, res, next) => {
    upload.array("images", 10)(req, res, (err) => normalizeUploadError(err, req, res, next));
}, async (req, res, next) => {
    try {
        const files = getFiles(req);
        if (files.length === 0) {
            return res.status(400).json({ success: false, message: "At least one image file is required" });
        }
        const invalidMessage = rejectInvalidFiles(files, imageTypes);
        if (invalidMessage) {
            return res.status(400).json({ success: false, message: invalidMessage });
        }
        const uploadedAssets = await Promise.all(files.map(async (file) => {
            const stored = (0, cloudinary_1.isCloudinaryEnabled)()
                ? {
                    id: crypto_1.default.randomUUID(),
                    url: await (0, cloudinary_1.uploadImageBuffer)({
                        buffer: file.buffer,
                        folder: `${env_1.env.cloudinaryFolder}/images`,
                        filename: file.originalname,
                    }),
                }
                : await saveLocalUpload(file, "images");
            return {
                id: stored.id,
                name: file.originalname,
                url: stored.url,
                type: file.mimetype,
                size: file.size,
            };
        }));
        res.status(201).json({
            success: true,
            data: {
                urls: uploadedAssets.map((file) => file.url),
                assets: uploadedAssets,
            },
            message: "Upload successful",
        });
    }
    catch (e) {
        next(e);
    }
});
router.post("/documents", auth_1.requireAuth, (req, res, next) => {
    upload.array("documents", 10)(req, res, (err) => normalizeUploadError(err, req, res, next));
}, async (req, res, next) => {
    try {
        const files = getFiles(req);
        if (files.length === 0) {
            return res.status(400).json({ success: false, message: "At least one document file is required" });
        }
        const invalidMessage = rejectInvalidFiles(files, documentTypes);
        if (invalidMessage) {
            return res.status(400).json({ success: false, message: invalidMessage });
        }
        const documents = await Promise.all(files.map(async (file) => {
            const stored = (0, cloudinary_1.isCloudinaryEnabled)()
                ? {
                    id: crypto_1.default.randomUUID(),
                    url: await (0, cloudinary_1.uploadBuffer)({
                        buffer: file.buffer,
                        folder: `${env_1.env.cloudinaryFolder}/documents`,
                        filename: file.originalname,
                        resourceType: "auto",
                    }),
                }
                : await saveLocalUpload(file, "documents");
            return {
                id: stored.id,
                name: file.originalname,
                url: stored.url,
                type: file.mimetype,
                size: file.size,
                purpose: String(req.body?.purpose ?? "verification_document"),
            };
        }));
        res.status(201).json({
            success: true,
            data: {
                documents,
            },
            message: "Upload successful",
        });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
