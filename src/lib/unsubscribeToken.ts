import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface UnsubscribeTokenPayload {
  userId: string;
  category: "emailNotifications";
  type: "unsubscribe";
}

/**
 * Generates a signed, tamper-proof unsubscribe token for a specific user.
 * Valid for 180 days so that recipient unsubscribe actions work even if
 * clicked long after the email was received.
 */
export function generateUnsubscribeToken(userId: string): string {
  if (!userId || typeof userId !== "string") {
    throw new Error("userId is required to generate an unsubscribe token");
  }

  const payload: UnsubscribeTokenPayload = {
    userId,
    category: "emailNotifications",
    type: "unsubscribe",
  };

  return jwt.sign(payload, env.jwtSecret, { expiresIn: "180d" });
}

/**
 * Validates an unsubscribe token and extracts the authenticated userId.
 * Returns null if the token is invalid, expired, or malformed.
 */
export function verifyUnsubscribeToken(token: string): { userId: string } | null {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as any;
    if (
      decoded &&
      decoded.type === "unsubscribe" &&
      decoded.category === "emailNotifications" &&
      typeof decoded.userId === "string" &&
      decoded.userId.length > 0
    ) {
      return { userId: decoded.userId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves the absolute backend API base URL for public webhook/unsubscribe endpoints.
 */
export function resolveApiBaseUrl(): string {
  if (env.publicUrl && env.publicUrl.trim().length > 0) {
    return env.publicUrl.trim().replace(/\/$/, "");
  }

  if (env.isProduction) {
    return "https://api.qwik.ng";
  }

  return `http://localhost:${env.port}`;
}

/**
 * Resolves the user-facing frontend base URL.
 */
export function resolveFrontendBaseUrl(): string {
  if (env.frontendUrl && env.frontendUrl.trim().length > 0) {
    return env.frontendUrl.trim().replace(/\/$/, "");
  }

  return "https://qwik.ng";
}

/**
 * Generates the full set of unsubscribe URLs for embedding into email footers
 * and RFC 8058 email headers.
 */
export function generateUnsubscribeUrls(userId: string): {
  directUnsubscribeUrl: string;
  oneClickUrl: string;
  preferencesUrl: string;
} {
  const token = generateUnsubscribeToken(userId);
  const encodedToken = encodeURIComponent(token);
  const apiBase = resolveApiBaseUrl();
  const frontendBase = resolveFrontendBaseUrl();

  return {
    directUnsubscribeUrl: `${apiBase}/api/notifications/unsubscribe?token=${encodedToken}`,
    oneClickUrl: `${apiBase}/api/notifications/unsubscribe-one-click?token=${encodedToken}`,
    preferencesUrl: `${frontendBase}/notification-settings-email`,
  };
}
