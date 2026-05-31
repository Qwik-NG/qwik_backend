"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });
router.post("/images", upload.array("images", 10), (req, res) => {
    const files = req.files ?? [];
    res.json({ success: true, data: { urls: files.map((f) => `/uploads/${f.filename}`) } });
});
exports.default = router;
