"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const env_1 = require("../../config/env");
const cloudinary_1 = require("../../lib/cloudinary");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 10,
    },
});
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const documentTypes = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
]);
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
function cloudinaryUnavailable(res) {
    return res.status(503).json({
        success: false,
        message: "Uploads are unavailable because Cloudinary is not configured",
    });
}
router.post("/images", upload.array("images", 10), async (req, res, next) => {
    try {
        const files = getFiles(req);
        if (files.length === 0) {
            return res.status(400).json({ success: false, message: "At least one image file is required" });
        }
        const invalidMessage = rejectInvalidFiles(files, imageTypes);
        if (invalidMessage) {
            return res.status(400).json({ success: false, message: invalidMessage });
        }
        if (!(0, cloudinary_1.isCloudinaryEnabled)()) {
            return cloudinaryUnavailable(res);
        }
        const uploadedFiles = await Promise.all(files.map(async (file) => ({
            name: file.originalname,
            url: await (0, cloudinary_1.uploadImageBuffer)({
                buffer: file.buffer,
                folder: `${env_1.env.cloudinaryFolder}/images`,
                filename: file.originalname,
            }),
            type: file.mimetype,
            size: file.size,
        })));
        res.status(201).json({
            success: true,
            data: {
                urls: uploadedFiles.map((file) => file.url),
                files: uploadedFiles,
            },
            message: "Upload successful",
        });
    }
    catch (e) {
        next(e);
    }
});
router.post("/documents", upload.array("documents", 10), async (req, res, next) => {
    try {
        const files = getFiles(req);
        if (files.length === 0) {
            return res.status(400).json({ success: false, message: "At least one document file is required" });
        }
        const invalidMessage = rejectInvalidFiles(files, documentTypes);
        if (invalidMessage) {
            return res.status(400).json({ success: false, message: invalidMessage });
        }
        if (!(0, cloudinary_1.isCloudinaryEnabled)()) {
            return cloudinaryUnavailable(res);
        }
        const uploadedFiles = await Promise.all(files.map(async (file) => ({
            name: file.originalname,
            url: await (0, cloudinary_1.uploadBuffer)({
                buffer: file.buffer,
                folder: `${env_1.env.cloudinaryFolder}/documents`,
                filename: file.originalname,
                resourceType: "auto",
            }),
            type: file.mimetype,
            size: file.size,
        })));
        res.status(201).json({
            success: true,
            data: {
                urls: uploadedFiles.map((file) => file.url),
                files: uploadedFiles,
            },
            message: "Upload successful",
        });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
