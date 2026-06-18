import type { User, UserProfile } from "@prisma/client";

type UserResponseSource = Pick<
  User,
  | "id"
  | "email"
  | "fullName"
  | "phone"
  | "location"
  | "locationState"
  | "locationArea"
  | "role"
  | "status"
  | "termsAcceptedAt"
  | "privacyAcceptedAt"
  | "termsVersion"
  | "privacyVersion"
  | "createdAt"
> & {
  emailVerifiedAt?: User["emailVerifiedAt"];
  profile?: Pick<UserProfile, "bio" | "avatarUrl"> | null;
  verificationApplications?: Array<{ id: string; status: string; paymentStatus: string }>;
  _count?: {
    ads?: number;
    followers?: number;
    following?: number;
  };
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
    locationState: user.locationState,
    locationArea: user.locationArea,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    termsAcceptedAt: user.termsAcceptedAt,
    privacyAcceptedAt: user.privacyAcceptedAt,
    termsVersion: user.termsVersion,
    privacyVersion: user.privacyVersion,
    profile: {
      bio: user.profile?.bio ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
    },
    verification: verificationSummary(user),
    stats: {
      adverts: user._count?.ads ?? 0,
      followers: user._count?.followers ?? 0,
      following: user._count?.following ?? 0,
    },
  };
}

export function toPublicUser(user: UserResponseSource) {
  return {
    id: user.id,
    fullName: user.fullName,
    location: user.location,
    locationState: user.locationState,
    locationArea: user.locationArea,
    role: user.role,
    status: user.status,
    profile: {
      bio: user.profile?.bio ?? null,
      avatarUrl: user.profile?.avatarUrl ?? null,
    },
    verification: verificationSummary(user),
    createdAt: user.createdAt,
    stats: {
      adverts: user._count?.ads ?? 0,
      followers: user._count?.followers ?? 0,
      following: user._count?.following ?? 0,
    },
  };
}
