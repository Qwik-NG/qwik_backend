import jwt from "jsonwebtoken";
import { env } from "../config/env";

export function signAuthToken(payload: { userId: string; email: string }) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}
