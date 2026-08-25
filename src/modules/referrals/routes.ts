import { Router } from "express";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth";

const router = Router();

router.use(requireAuth);

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;
const MAX_CREATE_ATTEMPTS = 5;

function generateReferralCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

router.get("/me", async (req, res, next) => {
  try {
    const userId = req.auth!.userId;

    const existing = await prisma.referralCode.findUnique({ where: { userId } });
    if (existing) {
      return res.json({ success: true, data: { code: existing.code } });
    }

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      try {
        const created = await prisma.referralCode.create({
          data: { userId, code: generateReferralCode() },
        });
        return res.status(201).json({ success: true, data: { code: created.code } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const target = (e.meta?.target as string[] | undefined) ?? [];
          if (target.includes("userId")) {
            // Another concurrent request already created this user's code first.
            const winner = await prisma.referralCode.findUnique({ where: { userId } });
            if (winner) return res.json({ success: true, data: { code: winner.code } });
          }
          // Otherwise a code collision occurred; retry with a freshly generated code.
          continue;
        }
        throw e;
      }
    }

    return res.status(500).json({ success: false, message: "Failed to generate referral code" });
  } catch (e) {
    next(e);
  }
});

export default router;
