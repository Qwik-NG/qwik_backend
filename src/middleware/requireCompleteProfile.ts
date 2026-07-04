import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { isProfileComplete, getProfileCompletionGaps } from "../lib/profileCompletion";

/**
 * Middleware to enforce complete profile before posting ads.
 * 
 * Requires: 
 * - phone (non-empty string)
 * - locationState (non-empty string)
 * - locationArea (non-empty string)
 * 
 * Returns 403 if profile incomplete.
 * Assumes requireAuth middleware has already set req.auth.userId.
 */
export async function requireCompleteProfile(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.userId) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: {
        phone: true,
        locationState: true,
        locationArea: true,
      },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    if (!isProfileComplete(user)) {
      const missingFields = getProfileCompletionGaps(user);
      return res.status(403).json({
        success: false,
        code: "PROFILE_INCOMPLETE",
        message: "Complete your profile before posting an ad.",
        missingFields,
      });
    }

    next();
  } catch (e) {
    // Log the error but return a user-friendly message
    console.error("Error in requireCompleteProfile middleware:", e);
    return res.status(500).json({ success: false, message: "Server error during profile validation" });
  }
}
