import type { User, UserProfile } from "@prisma/client";

type UserWithProfile = User & { profile?: UserProfile | null };

function verificationSummary(user: UserWithProfile & { verificationApplications?: Array<{ id: string; status: string; paymentStatus: string }> }) {
  const verification = user.verificationApplications?.[0] ?? null;
  return {
    id: verification?.id ?? null,
    status: verification?.status ?? null,
    paymentStatus: verification?.paymentStatus ?? null,
    approved: verification?.status === "APPROVED",
  };
}

export function toAuthUser(user: UserWithProfile) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    location: user.location,
    role: user.role,
    profile: {
      bio: user.profile?.bio ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
    },
    verification: verificationSummary(user),
  };
}

export function toPublicUser(user: UserWithProfile) {
  return {
    id: user.id,
    fullName: user.fullName,
    location: user.location,
    role: user.role,
    profile: {
      bio: user.profile?.bio ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
    },
    verification: verificationSummary(user),
    createdAt: user.createdAt,
  };
}
