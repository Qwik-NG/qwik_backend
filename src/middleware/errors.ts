import { NextFunction, Request, Response } from "express";

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

  const isDatabaseError =
    err.name.startsWith("Prisma") ||
    err.message.includes("Can't reach database server") ||
    err.message.includes("Invalid `prisma");

  res.status(err.status ?? 500).json({
    success: false,
    message: isDatabaseError ? "Database unavailable" : err.message || "Internal server error",
    ...(err.errors ? { errors: err.errors } : {}),
  });
}
