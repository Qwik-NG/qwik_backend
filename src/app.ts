import express from "express";
import cors from "cors";
import path from "path";
import { env } from "./config/env";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler, notFound } from "./middleware/errors";
import router from "./routes";

export const app = express();
const frontendOrigins = env.frontendUrl
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({ 
  origin: (origin, callback) => {
    // Allow same-origin server checks, any local dev origin, and the configured frontend origin.
    if (
      !origin ||
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
      frontendOrigins.includes(origin.replace(/\/$/, ""))
    ) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
}));
app.use(express.json({ limit: "2mb" }));
app.use(requestLogger);
app.use("/uploads", express.static(path.resolve("uploads")));
app.use("/api", router);
app.use(notFound);
app.use(errorHandler);
