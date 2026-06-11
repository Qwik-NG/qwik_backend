import crypto from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { isCloudinaryEnabled, uploadBuffer, uploadImageBuffer } from "../../lib/cloudinary";
import { requireAuth } from "../../middleware/auth";

const router = Router();

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const documentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
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

type UploadedAsset = {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
};

type UploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type UploadError = {
  code?: string;
  message?: string;
};

function isUploadError(err: unknown): err is UploadError {
  return err instanceof multer.MulterError || (typeof err === "object" && err !== null && ("code" in err || "message" in err));
}

function getFiles(req: Request) {
  return (req.files ?? []) as UploadedFile[];
}

function rejectInvalidFiles(files: UploadedFile[], allowedTypes: Set<string>) {
  const invalid = files.find((file) => !allowedTypes.has(file.mimetype));
  if (invalid) {
    return `${invalid.originalname} has an unsupported file type`;
  }
  return null;
}

function fileExtension(file: UploadedFile) {
  const fallback = file.mimetype.split("/")[1] || "bin";
  return path.extname(file.originalname).replace(".", "") || fallback;
}

async function saveLocalUpload(file: UploadedFile, folder: "images" | "documents") {
  const uploadDir = path.resolve("uploads", folder);
  await mkdir(uploadDir, { recursive: true });
  const id = crypto.randomUUID();
  const filename = `${id}.${fileExtension(file)}`;
  await writeFile(path.join(uploadDir, filename), file.buffer);
  return {
    id,
    url: `/uploads/${folder}/${filename}`,
  };
}

function normalizeUploadError(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (isUploadError(err)) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: "Each file must be 5MB or smaller" });
    }
    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ success: false, message: "You can upload up to 10 files at a time" });
    }
    if (err.message?.includes("unsupported file type")) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: err.message || "Upload failed" });
    }
  }

  if (err instanceof Error && err.message.includes("unsupported file type")) {
    return res.status(400).json({ success: false, message: err.message });
  }

  next(err);
}

router.post(
  "/images",
  requireAuth,
  (req, res, next) => {
    upload.array("images", 10)(req, res, (err) => normalizeUploadError(err, req, res, next));
  },
  async (req, res, next) => {
    try {
      const files = getFiles(req);

      if (files.length === 0) {
        return res.status(400).json({ success: false, message: "At least one image file is required" });
      }

      const invalidMessage = rejectInvalidFiles(files, imageTypes);
      if (invalidMessage) {
        return res.status(400).json({ success: false, message: invalidMessage });
      }

      const uploadedAssets: UploadedAsset[] = await Promise.all(
        files.map(async (file) => {
          const stored = isCloudinaryEnabled()
            ? {
                id: crypto.randomUUID(),
                url: await uploadImageBuffer({
                  buffer: file.buffer,
                  folder: `${env.cloudinaryFolder}/images`,
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
        }),
      );

      res.status(201).json({
        success: true,
        data: {
          urls: uploadedAssets.map((file) => file.url),
          assets: uploadedAssets,
        },
        message: "Upload successful",
      });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  "/documents",
  requireAuth,
  (req, res, next) => {
    upload.array("documents", 10)(req, res, (err) => normalizeUploadError(err, req, res, next));
  },
  async (req, res, next) => {
    try {
      const files = getFiles(req);

      if (files.length === 0) {
        return res.status(400).json({ success: false, message: "At least one document file is required" });
      }

      const invalidMessage = rejectInvalidFiles(files, documentTypes);
      if (invalidMessage) {
        return res.status(400).json({ success: false, message: invalidMessage });
      }

      const documents: Array<UploadedAsset & { purpose: string }> = await Promise.all(
        files.map(async (file) => {
          const stored = isCloudinaryEnabled()
            ? {
                id: crypto.randomUUID(),
                url: await uploadBuffer({
                  buffer: file.buffer,
                  folder: `${env.cloudinaryFolder}/documents`,
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
        }),
      );

      res.status(201).json({
        success: true,
        data: {
          documents,
        },
        message: "Upload successful",
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
