import express from "express";
import cors from "cors";
import path from "path";
import { env } from "./config/env";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler, notFound } from "./middleware/errors";
import router from "./routes";

export const app = express();
app.use(cors({ 
  origin: (origin, callback) => {
    // Allow any localhost port (for Vite dev which might pick random ports)
    if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json({ limit: "2mb" }));
app.use(requestLogger);
app.use("/uploads", express.static(path.resolve("uploads")));
app.use("/api", router);
app.use(notFound);
app.use(errorHandler);
