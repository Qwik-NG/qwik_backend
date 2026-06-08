import { Router, type Response } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { isCloudinaryEnabled, uploadBuffer, uploadImageBuffer } from "../../lib/cloudinary";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
});

type UploadedFile = {
  name: string;
  url: string;
  type: string;
  size: number;
};

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const documentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function getFiles(req: Express.Request) {
  return (req.files ?? []) as Express.Multer.File[];
}

function rejectInvalidFiles(files: Express.Multer.File[], allowedTypes: Set<string>) {
  const invalid = files.find((file) => !allowedTypes.has(file.mimetype));
  if (invalid) {
    return `${invalid.originalname} has an unsupported file type`;
  }
  return null;
}

function cloudinaryUnavailable(res: Response) {
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

    if (!isCloudinaryEnabled()) {
      return cloudinaryUnavailable(res);
    }

    const uploadedFiles: UploadedFile[] = await Promise.all(
      files.map(async (file) => ({
        name: file.originalname,
        url: await uploadImageBuffer({
          buffer: file.buffer,
          folder: `${env.cloudinaryFolder}/images`,
          filename: file.originalname,
        }),
        type: file.mimetype,
        size: file.size,
      })),
    );

    res.status(201).json({
      success: true,
      data: {
        urls: uploadedFiles.map((file) => file.url),
        files: uploadedFiles,
      },
      message: "Upload successful",
    });
  } catch (e) {
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

    if (!isCloudinaryEnabled()) {
      return cloudinaryUnavailable(res);
    }

    const uploadedFiles: UploadedFile[] = await Promise.all(
      files.map(async (file) => ({
        name: file.originalname,
        url: await uploadBuffer({
          buffer: file.buffer,
          folder: `${env.cloudinaryFolder}/documents`,
          filename: file.originalname,
          resourceType: "auto",
        }),
        type: file.mimetype,
        size: file.size,
      })),
    );

    res.status(201).json({
      success: true,
      data: {
        urls: uploadedFiles.map((file) => file.url),
        files: uploadedFiles,
      },
      message: "Upload successful",
    });
  } catch (e) {
    next(e);
  }
});

export default router;
