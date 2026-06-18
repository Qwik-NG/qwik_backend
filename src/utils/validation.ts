import { z } from "zod";
import { env } from "../config/env";

export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const error = new Error(result.error.issues.map((i) => i.message).join(", ")) as Error & {
      status?: number;
      errors?: Record<string, string>;
    };
    error.status = 400;
    error.errors = Object.fromEntries(result.error.issues.map((issue) => [issue.path.join(".") || "body", issue.message]));
    throw error;
  }
  return result.data;
}

/**
 * Validates that image URLs are from allowed hosts.
 * In production with Cloudinary: only accepts res.cloudinary.com and publicUrl
 * In development: accepts any valid URL (for flexibility in testing)
 */
export function validateImageUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Always allow Cloudinary URLs
    if (hostname === "res.cloudinary.com") {
      return true;
    }

    // In development, allow any hostname (for testing flexibility)
    if (!env.isProduction) {
      return true;
    }

    // In production with Cloudinary enabled, also allow public backend URL
    if (env.publicUrl) {
      try {
        const publicUrlObj = new URL(env.publicUrl);
        if (hostname === publicUrlObj.hostname) {
          return true;
        }
      } catch {
        // publicUrl parsing failed, continue
      }
    }

    // All other URLs are rejected in production
    return false;
  } catch {
    // Invalid URL format
    return false;
  }
}

/**
 * Creates a Zod schema for validating image URLs with the allowed hosts rules
 */
export function createImageUrlSchema() {
  return z
    .array(
      z.string()
        .url("Each image URL must be a valid URL")
        .max(2048, "Image URL must be 2048 characters or less")
        .refine(
          (url) => validateImageUrl(url),
          {
            message: "Invalid image URL. Images must be uploaded via the upload form. Unsupported URL hosts are not allowed in production.",
          }
        )
    )
    .min(4, "Please upload at least 4 product photos.")
    .max(10, "You can upload up to 10 product photos.");
}
