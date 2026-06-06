import { Router, Request } from "express";
import { mkdir, writeFile } from "fs/promises";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { isCloudinaryEnabled, uploadImageBuffer } from "../../lib/cloudinary";

interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function saveImageLocally(file: UploadedFile, req: Request) {
  const extension = path.extname(file.originalname) || ".jpg";
  const filename = `${randomUUID()}${extension}`;
  const uploadDirectory = path.resolve("uploads");

  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(path.join(uploadDirectory, filename), file.buffer);

  return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
}

router.post("/images", upload.array("images", 10), async (req, res, next) => {
  try {
    const files = (req.files as UploadedFile[] | undefined) ?? [];
    const urls = await Promise.all(
      files.map((file) => {
        if (isCloudinaryEnabled()) {
          return uploadImageBuffer({
            buffer: file.buffer,
            filename: file.originalname.replace(/\.[^.]+$/, ""),
          });
        }

        return saveImageLocally(file, req);
      }),
    );

    res.json({ success: true, data: { urls } });
  } catch (error) {
    next(error);
  }
});
export default router;
