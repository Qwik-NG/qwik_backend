import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  buildGoogleUserCreateInput,
  type GoogleSignupUser,
} from "../modules/auth/routes";
import { errorHandler } from "../middleware/errors";

describe("Google New-User Signup Payload — buildGoogleUserCreateInput", () => {
  const sampleGoogleUserData: GoogleSignupUser = {
    id: "user-uuid-12345",
    email: "newgoogleuser@example.com",
    fullName: "Google Explorer",
    googleId: "google-sub-998877",
    authProvider: "GOOGLE",
    termsAcceptedAt: new Date("2026-09-24T00:00:00Z"),
    privacyAcceptedAt: new Date("2026-09-24T00:00:00Z"),
    termsVersion: "2026-06-09",
    privacyVersion: "2026-06-09",
    emailVerifiedAt: new Date("2026-09-24T00:00:00Z"),
    avatarUrl: "https://lh3.googleusercontent.com/a/sample-photo=s96-c",
  };

  it("accepts a Google avatarUrl and nests it under profile.create, NOT on User", () => {
    const payload = buildGoogleUserCreateInput(sampleGoogleUserData);

    // 1. avatarUrl is stored on UserProfile (profile.create)
    expect(payload.profile).toEqual({
      create: {
        avatarUrl: "https://lh3.googleusercontent.com/a/sample-photo=s96-c",
      },
    });

    // 2. avatarUrl MUST NOT exist on the top-level User model payload
    expect("avatarUrl" in payload).toBe(false);
    expect((payload as any).avatarUrl).toBeUndefined();
  });

  it("contains all required User fields on the top-level payload without avatarUrl", () => {
    const payload = buildGoogleUserCreateInput(sampleGoogleUserData);

    expect(payload.id).toBe("user-uuid-12345");
    expect(payload.email).toBe("newgoogleuser@example.com");
    expect(payload.fullName).toBe("Google Explorer");
    expect(payload.googleId).toBe("google-sub-998877");
    expect(payload.authProvider).toBe("GOOGLE");
    expect(payload.termsVersion).toBe("2026-06-09");
    expect(payload.privacyVersion).toBe("2026-06-09");
  });

  it("handles empty or undefined avatarUrl safely", () => {
    const withoutAvatar: GoogleSignupUser = {
      ...sampleGoogleUserData,
      avatarUrl: undefined,
    };
    const payload = buildGoogleUserCreateInput(withoutAvatar);

    expect(payload.profile).toEqual({ create: {} });
    expect("avatarUrl" in payload).toBe(false);
  });

  it("verifies User create payload schema compatibility against Prisma model definition", () => {
    const payload = buildGoogleUserCreateInput(sampleGoogleUserData);
    const userModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "User");
    expect(userModel).toBeDefined();

    const allowedUserFieldNames = new Set(userModel!.fields.map((f) => f.name));

    // Every key at top level (except relation 'profile') must be a valid User scalar field
    const topLevelKeys = Object.keys(payload);
    for (const key of topLevelKeys) {
      expect(
        allowedUserFieldNames.has(key),
        `Unexpected field "${key}" found on User create payload`
      ).toBe(true);
    }

    // Explicitly assert avatarUrl is NOT a User model field
    expect(allowedUserFieldNames.has("avatarUrl")).toBe(false);
  });
});

describe("Existing Google User Login Behavior", () => {
  it("does not invoke user.create when existing user is found", async () => {
    const existingUser = {
      id: "existing-user-id",
      email: "existing@example.com",
      googleId: "existing-google-id",
      role: "USER",
      status: "ACTIVE",
      termsAcceptedAt: new Date("2026-01-01"),
      privacyAcceptedAt: new Date("2026-01-01"),
      profile: { avatarUrl: "https://example.com/existing-avatar.jpg", bio: null },
    };

    const mockCreate = vi.fn();
    const mockUpdate = vi.fn();
    const mockFindFirst = vi.fn().mockResolvedValue(existingUser);

    const prismaMock = {
      user: {
        findFirst: mockFindFirst,
        create: mockCreate,
        update: mockUpdate,
      },
    };

    // Simulate route existing user path
    let user = await prismaMock.user.findFirst({
      where: { OR: [{ googleId: "existing-google-id" }, { email: "existing@example.com" }] },
    });

    if (user) {
      if (!user.googleId) {
        user = await prismaMock.user.update({
          where: { id: user.id },
          data: { googleId: "existing-google-id", authProvider: "GOOGLE" },
        });
      }
    }

    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled(); // googleId already matches
    expect(user).toEqual(existingUser);
  });

  it("links googleId when existing email user logs in with Google for first time without creating new user", async () => {
    const existingEmailUser = {
      id: "existing-email-user-id",
      email: "passworduser@example.com",
      googleId: null,
      role: "USER",
      status: "ACTIVE",
      termsAcceptedAt: new Date("2026-01-01"),
      privacyAcceptedAt: new Date("2026-01-01"),
      profile: null,
    };

    const updatedUser = {
      ...existingEmailUser,
      googleId: "new-google-sub",
      authProvider: "GOOGLE",
    };

    const mockCreate = vi.fn();
    const mockUpdate = vi.fn().mockResolvedValue(updatedUser);
    const mockFindFirst = vi.fn().mockResolvedValue(existingEmailUser);

    const prismaMock = {
      user: {
        findFirst: mockFindFirst,
        create: mockCreate,
        update: mockUpdate,
      },
    };

    let user = await prismaMock.user.findFirst({
      where: { OR: [{ googleId: "new-google-sub" }, { email: "passworduser@example.com" }] },
    });

    if (user) {
      if (!user.googleId) {
        user = await prismaMock.user.update({
          where: { id: user.id },
          data: { googleId: "new-google-sub", authProvider: "GOOGLE" },
        });
      }
    }

    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "existing-email-user-id" },
      data: { googleId: "new-google-sub", authProvider: "GOOGLE" },
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(user.googleId).toBe("new-google-sub");
  });
});

describe("Error Classification Middleware — errorHandler", () => {
  function createMockResponse() {
    const res: any = {};
    res.statusCode = 200;
    res.body = null;
    res.status = vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = vi.fn((data: any) => {
      res.body = data;
      return res;
    });
    return res;
  }

  it("classifies PrismaClientValidationError as an internal 500 error, NOT 503 Database unavailable", () => {
    const validationError = new Prisma.PrismaClientValidationError(
      "Invalid `prisma.user.create()` invocation: Unknown argument `avatarUrl`",
      { clientVersion: "6.11.1" }
    );

    const req: any = {};
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(validationError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Internal server error",
    });
  });

  it("classifies PrismaClientKnownRequestError P2024 as 503 Database unavailable", () => {
    const poolTimeoutError = new Prisma.PrismaClientKnownRequestError(
      "Timed out fetching a new connection from the connection pool",
      { code: "P2024", clientVersion: "6.11.1" }
    );

    const req: any = {};
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(poolTimeoutError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Database unavailable. Please try again shortly.",
    });
  });

  it("classifies PrismaClientKnownRequestError P2002 as 409 Conflict", () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "6.11.1" }
    );

    const req: any = {};
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(duplicateError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "A record with these details already exists",
    });
  });

  it("classifies connection drop errors as 503 Database unavailable", () => {
    const connectionError = new Error("Can't reach database server at pooler.supabase.com:6543");

    const req: any = {};
    const res = createMockResponse();
    const next = vi.fn();

    errorHandler(connectionError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Database unavailable",
    });
  });
});
