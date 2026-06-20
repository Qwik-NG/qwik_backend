import crypto from "crypto";
import { env } from "../config/env";

type InitializeTransactionInput = {
  email: string;
  amount: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
};

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data?: {
    id?: number;
    domain?: string;
    status?: string;
    reference?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
    gateway_response?: string;
    metadata?: Record<string, unknown>;
  };
};

function requirePaystackSecret() {
  if (!env.paystackSecretKey) {
    throw Object.assign(new Error("Paystack is not configured"), { status: 503 });
  }
  return env.paystackSecretKey;
}

async function paystackRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requirePaystackSecret()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) {
    const message = typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : "Paystack request failed";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}

export function createPaystackReference(paymentId: string) {
  void paymentId;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let suffix = "";
  for (let i = 0; i < 10; i += 1) {
    suffix += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `QWK-P-${suffix}`;
}

export function verifyPaystackSignature(rawBody: Buffer | undefined, signature: string | string[] | undefined) {
  if (!rawBody || typeof signature !== "string") return false;
  const expected = crypto.createHmac("sha512", requirePaystackSecret()).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export async function initializePaystackTransaction(input: InitializeTransactionInput) {
  const response = await paystackRequest<PaystackInitializeResponse>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      amount: input.amount,
      currency: "NGN",
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  });

  if (!response.status || !response.data?.authorization_url || !response.data.reference) {
    throw Object.assign(new Error(response.message || "Paystack checkout initialization failed"), { status: 502 });
  }

  return {
    authorizationUrl: response.data.authorization_url,
    accessCode: response.data.access_code ?? null,
    reference: response.data.reference,
  };
}

export async function verifyPaystackTransaction(reference: string) {
  const response = await paystackRequest<PaystackVerifyResponse>(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!response.status || !response.data) {
    throw Object.assign(new Error(response.message || "Paystack verification failed"), { status: 502 });
  }
  return response.data;
}

export function mapPaystackStatus(status: string | undefined) {
  if (status === "success") return "PAID" as const;
  if (status === "failed") return "FAILED" as const;
  if (status === "abandoned" || status === "reversed") return "CANCELLED" as const;
  return "PENDING" as const;
}
