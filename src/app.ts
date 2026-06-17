import express from "express";
import cors from "cors";
import path from "path";
import { env } from "./config/env";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler, notFound } from "./middleware/errors";
import router from "./routes";

export const app = express();
const frontendOrigins = env.appOrigins
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
const cspConnectSources = ["'self'", ...frontendOrigins, env.publicUrl.replace(/\/$/, "")]
  .filter(Boolean)
  .join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  `connect-src ${cspConnectSources}`,
  "img-src 'self' https://res.cloudinary.com data: blob:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
].join("; ");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", contentSecurityPolicy);
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow server-side checks (no Origin), local dev origins, and configured frontend domains.
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
  credentials: false,
  optionsSuccessStatus: 204,
};
app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});
app.use(express.json({
  limit: "2mb",
  verify: (req, _res, buf) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  },
}));
app.use(requestLogger);
app.use(
  "/uploads",
  express.static(path.resolve("uploads"), {
    immutable: true,
    maxAge: "7d",
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  }),
);
app.use("/api", router);
app.use(notFound);
app.use(errorHandler);
