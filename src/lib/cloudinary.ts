import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";

if (env.cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
}

export function isCloudinaryEnabled() {
  return env.cloudinaryEnabled;
}

export async function uploadImageBuffer(input: {
  buffer: Buffer;
  folder?: string;
  filename?: string;
}) {
  if (!env.cloudinaryEnabled) {
    throw new Error("Cloudinary is not configured");
  }

  const { buffer, folder = env.cloudinaryFolder, filename } = input;

  return new Promise<string>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        use_filename: !!filename,
        unique_filename: true,
        filename_override: filename,
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(error ?? new Error("Cloudinary upload failed"));
          return;
        }

        resolve(result.secure_url);
      },
    );

    stream.end(buffer);
  });
}