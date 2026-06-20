"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPaystackReference = createPaystackReference;
exports.verifyPaystackSignature = verifyPaystackSignature;
exports.initializePaystackTransaction = initializePaystackTransaction;
exports.verifyPaystackTransaction = verifyPaystackTransaction;
exports.mapPaystackStatus = mapPaystackStatus;
const crypto_1 = __importDefault(require("crypto"));
const env_1 = require("../config/env");
function requirePaystackSecret() {
    if (!env_1.env.paystackSecretKey) {
        throw Object.assign(new Error("Paystack is not configured"), { status: 503 });
    }
    return env_1.env.paystackSecretKey;
}
async function paystackRequest(path, init = {}) {
    const response = await fetch(`https://api.paystack.co${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${requirePaystackSecret()}`,
            "Content-Type": "application/json",
            ...(init.headers ?? {}),
        },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = typeof body.message === "string" ? body.message : "Paystack request failed";
        throw Object.assign(new Error(message), { status: response.status });
    }
    return body;
}
function createPaystackReference(paymentId) {
    void paymentId;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let suffix = "";
    for (let i = 0; i < 10; i += 1) {
        suffix += alphabet[crypto_1.default.randomInt(alphabet.length)];
    }
    return `QWK-P-${suffix}`;
}
function verifyPaystackSignature(rawBody, signature) {
    if (!rawBody || typeof signature !== "string")
        return false;
    const expected = crypto_1.default.createHmac("sha512", requirePaystackSecret()).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== signatureBuffer.length)
        return false;
    return crypto_1.default.timingSafeEqual(expectedBuffer, signatureBuffer);
}
async function initializePaystackTransaction(input) {
    const response = await paystackRequest("/transaction/initialize", {
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
async function verifyPaystackTransaction(reference) {
    const response = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!response.status || !response.data) {
        throw Object.assign(new Error(response.message || "Paystack verification failed"), { status: 502 });
    }
    return response.data;
}
function mapPaystackStatus(status) {
    if (status === "success")
        return "PAID";
    if (status === "failed")
        return "FAILED";
    if (status === "abandoned" || status === "reversed")
        return "CANCELLED";
    return "PENDING";
}
