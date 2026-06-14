import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";

export type AuthPayload = { userId: string; email: string; role?: string };

declare global {
  namespace Express {
    interface Request { auth?: AuthPayload }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Unauthorized" });
  try {
    const token = header.split(" ")[1];
    req.auth = jwt.verify(token, env.jwtSecret) as AuthPayload;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

export async function requireActiveUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { status: true },
    });

    if (!user || user.status === "BANNED") {
      return res.status(403).json({ success: false, message: "Account suspended" });
    }

    next();
  } catch (e) {
    next(e);
  }
}
