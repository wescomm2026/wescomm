export const RESERVATION_RESTRICTION_POLICY = {
  noShowGraceHours: 24,
  firstRestrictionAt: 3,
  firstRestrictionDays: 7,
  secondRestrictionDays: 30
} as const;

export type NoShowPolicyDecision =
  | { kind: "WARNING"; warningNumber: 1 | 2 }
  | { kind: "KEEP_ACTIVE_RESTRICTION" }
  | { kind: "CREATE_RESTRICTION"; level: 1 | 2 | 3 };

export function getNoShowEligibleAt(pickupEnd: Date) {
  return new Date(pickupEnd.getTime() + RESERVATION_RESTRICTION_POLICY.noShowGraceHours * 60 * 60 * 1000);
}

export function isNoShowEligible(pickupEnd: Date, now = new Date()) {
  return getNoShowEligibleAt(pickupEnd) <= now;
}

export function getRestrictionEndDate(level: number, startsAt: Date) {
  if (level === 1) return new Date(startsAt.getTime() + RESERVATION_RESTRICTION_POLICY.firstRestrictionDays * 86400000);
  if (level === 2) return new Date(startsAt.getTime() + RESERVATION_RESTRICTION_POLICY.secondRestrictionDays * 86400000);
  return null;
}

export function evaluateNoShowPolicy(input: {
  consecutiveOffenses: number;
  highestPreviousRestrictionLevel: number;
  hasActiveRestriction: boolean;
}): NoShowPolicyDecision {
  if (!Number.isInteger(input.consecutiveOffenses) || input.consecutiveOffenses < 1) {
    throw new RangeError("consecutiveOffenses must be a positive integer.");
  }

  if (input.consecutiveOffenses < RESERVATION_RESTRICTION_POLICY.firstRestrictionAt) {
    return { kind: "WARNING", warningNumber: input.consecutiveOffenses === 1 ? 1 : 2 };
  }

  if (input.hasActiveRestriction) return { kind: "KEEP_ACTIVE_RESTRICTION" };

  const nextLevel = Math.min(3, Math.max(0, input.highestPreviousRestrictionLevel) + 1) as 1 | 2 | 3;
  return { kind: "CREATE_RESTRICTION", level: nextLevel };
}
