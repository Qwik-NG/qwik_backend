import crypto from "crypto";
import { type EngagementEventType } from "@prisma/client";

type FingerprintInput = {
  eventType: EngagementEventType;
  recipientId: string;
  idempotencyKey: string;
};

export function buildEngagementFingerprint(input: FingerprintInput) {
  const raw = `${input.eventType}|${input.recipientId}|${input.idempotencyKey}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}
