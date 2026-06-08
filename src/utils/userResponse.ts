import type { User, UserProfile } from "@prisma/client";

type UserWithProfile = User & { profile?: UserProfile | null };

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
    createdAt: user.createdAt,
  };
}
