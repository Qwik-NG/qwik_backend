import type { User, UserProfile } from "@prisma/client";

type UserResponseSource = Pick<
  User,
  | "id"
  | "email"
  | "fullName"
  | "phone"
  | "location"
  | "role"
  | "status"
  | "termsAcceptedAt"
  | "privacyAcceptedAt"
  | "termsVersion"
  | "privacyVersion"
  | "createdAt"
> & {
  profile?: Pick<UserProfile, "bio" | "avatarUrl"> | null;
  verificationApplications?: Array<{ id: string; status: string; paymentStatus: string }>;
};

function verificationSummary(user: UserResponseSource) {
  const verification = user.verificationApplications?.[0] ?? null;
  return {
    id: verification?.id ?? null,
    status: verification?.status ?? null,
    paymentStatus: verification?.paymentStatus ?? null,
    approved: verification?.status === "APPROVED",
  };
}

export function toAuthUser(user: UserResponseSource) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    location: user.location,
    role: user.role,
    status: user.status,
    termsAcceptedAt: user.termsAcceptedAt,
    privacyAcceptedAt: user.privacyAcceptedAt,
    termsVersion: user.termsVersion,
    privacyVersion: user.privacyVersion,
    profile: {
      bio: user.profile?.bio ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
    },
    verification: verificationSummary(user),
  };
}

export function toPublicUser(user: UserResponseSource) {
  return {
    id: user.id,
    fullName: user.fullName,
    location: user.location,
    role: user.role,
    status: user.status,
    profile: {
      bio: user.profile?.bio ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
    },
    verification: verificationSummary(user),
    createdAt: user.createdAt,
  };
}
