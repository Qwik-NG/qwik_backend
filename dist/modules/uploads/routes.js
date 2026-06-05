"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const promises_1 = require("fs/promises");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const cloudinary_1 = require("../../lib/cloudinary");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
async function saveImageLocally(file, req) {
    const extension = path_1.default.extname(file.originalname) || ".jpg";
    const filename = `${(0, crypto_1.randomUUID)()}${extension}`;
    const uploadDirectory = path_1.default.resolve("uploads");
    await (0, promises_1.mkdir)(uploadDirectory, { recursive: true });
    await (0, promises_1.writeFile)(path_1.default.join(uploadDirectory, filename), file.buffer);
    return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}
router.post("/images", upload.array("images", 10), async (req, res, next) => {
    try {
        const files = req.files ?? [];
        const urls = await Promise.all(files.map((file) => {
            if ((0, cloudinary_1.isCloudinaryEnabled)()) {
                return (0, cloudinary_1.uploadImageBuffer)({
                    buffer: file.buffer,
                    filename: file.originalname.replace(/\.[^.]+$/, ""),
                });
            }
            return saveImageLocally(file, req);
        }));
        res.json({ success: true, data: { urls } });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
