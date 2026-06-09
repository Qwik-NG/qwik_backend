"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAuthUser = toAuthUser;
exports.toPublicUser = toPublicUser;
function verificationSummary(user) {
    const verification = user.verificationApplications?.[0] ?? null;
    return {
        id: verification?.id ?? null,
        status: verification?.status ?? null,
        paymentStatus: verification?.paymentStatus ?? null,
        approved: verification?.status === "APPROVED",
    };
}
function toAuthUser(user) {
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
function toPublicUser(user) {
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
