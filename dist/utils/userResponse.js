"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAuthUser = toAuthUser;
exports.toPublicUser = toPublicUser;
function toAuthUser(user) {
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
function toPublicUser(user) {
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
