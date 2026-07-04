import { User } from "@prisma/client";

/**
 * Checks if a user's profile is complete for marketplace actions.
 * Required fields: phone, locationState, locationArea (non-empty, non-whitespace strings)
 */
export function isProfileComplete(user: Pick<User, 'phone' | 'locationState' | 'locationArea'>): boolean {
  return (
    isFieldFilled(user.phone) &&
    isFieldFilled(user.locationState) &&
    isFieldFilled(user.locationArea)
  );
}

/**
 * Returns array of missing required fields for profile completion.
 */
export function getProfileCompletionGaps(user: Pick<User, 'phone' | 'locationState' | 'locationArea'>): string[] {
  const gaps: string[] = [];
  
  if (!isFieldFilled(user.phone)) gaps.push('phone');
  if (!isFieldFilled(user.locationState)) gaps.push('locationState');
  if (!isFieldFilled(user.locationArea)) gaps.push('locationArea');
  
  return gaps;
}

/**
 * Helper: check if a string field is filled (not null/undefined/empty/whitespace-only)
 */
function isFieldFilled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
