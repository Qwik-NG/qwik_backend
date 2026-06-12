import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ success: false, message: "Route not found" });
}

export function errorHandler(
  err: Error & { status?: number; errors?: Record<string, string> },
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error(err);

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A record with these details already exists" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ success: false, message: "Record not found" });
    }
    if (err.code === "P2024") {
      return res.status(503).json({ success: false, message: "Database unavailable. Please try again shortly." });
    }
  }

  const isDatabaseError =
    err.name.startsWith("Prisma") ||
    err.message.includes("Can't reach database server") ||
    err.message.includes("Invalid `prisma");

  res.status(err.status ?? (isDatabaseError ? 503 : 500)).json({
    success: false,
    message: isDatabaseError ? "Database unavailable" : err.message || "Internal server error",
    ...(err.errors ? { errors: err.errors } : {}),
  });
}
