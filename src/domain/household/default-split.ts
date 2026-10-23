import { createBasisPoints, type BasisPoints } from '../allocation/allocation';

export type HouseholdShare = Readonly<{
  memberId: string;
  basisPoints: BasisPoints;
}>;

// The roster is explicit. No equal-share fallback, normalization or money effect.
export function createHouseholdSplit(
  roster: readonly string[],
  shares: readonly { memberId: string; basisPoints: number }[],
): readonly HouseholdShare[] {
  if (
    !Array.isArray(roster) ||
    !Array.isArray(shares) ||
    roster.length === 0 ||
    Array.from({ length: roster.length }, (_, index) => index).some(
      (index) =>
        !Object.prototype.hasOwnProperty.call(roster, index) ||
        !Object.prototype.hasOwnProperty.call(shares, index),
    ) ||
    new Set(roster).size !== roster.length ||
    roster.some((id) => !id) ||
    shares.length !== roster.length ||
    new Set(shares.map((share) => share.memberId)).size !== shares.length ||
    shares.some((share) => !roster.includes(share.memberId))
  )
    throw new Error('Every roster member needs one explicit percentage.');
  const result = shares.map((share) =>
    Object.freeze({
      memberId: share.memberId,
      basisPoints: createBasisPoints(share.basisPoints),
    }),
  );
  if (result.reduce((sum, share) => sum + share.basisPoints, 0) !== 10000)
    throw new Error('Household percentages must total exactly 10000.');
  return Object.freeze(
    result.sort((a, b) => a.memberId.localeCompare(b.memberId)),
  );
}

export function sameHouseholdRoster(
  a: readonly string[],
  b: readonly string[],
) {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    new Set(b).size === b.length &&
    a.every((id) => b.includes(id))
  );
}
