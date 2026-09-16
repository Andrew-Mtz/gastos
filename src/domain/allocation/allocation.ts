import { createMoney, MoneyError, type Money } from '../money/money';

declare const basisPointsBrand: unique symbol;

export type BasisPoints = number & {
  readonly [basisPointsBrand]: true;
};

export type AllocationErrorCode =
  | 'INVALID_BASIS_POINTS'
  | 'INVALID_ALLOCATION_SHARES'
  | 'EMPTY_ALLOCATION'
  | 'INVALID_ALLOCATION_TOTAL';

const errorMessages: Record<AllocationErrorCode, string> = {
  INVALID_BASIS_POINTS:
    'Basis points require a safe integer from zero through ten thousand.',
  INVALID_ALLOCATION_SHARES: 'Allocation shares require a dense array.',
  EMPTY_ALLOCATION: 'Allocation requires at least one share.',
  INVALID_ALLOCATION_TOTAL:
    'Allocation shares must total exactly ten thousand basis points.',
};

export class AllocationError extends Error {
  readonly code: AllocationErrorCode;

  constructor(code: AllocationErrorCode) {
    super(errorMessages[code]);
    this.name = 'AllocationError';
    this.code = code;
  }
}

export function createBasisPoints(value: number): BasisPoints {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new AllocationError('INVALID_BASIS_POINTS');
  }
  return value as BasisPoints;
}

function validateMoney(total: Money): Money {
  if (total === null || typeof total !== 'object') {
    throw new MoneyError('INVALID_AMOUNT');
  }
  return createMoney(total.amountMinor, total.currency);
}

export function allocateMoney(
  total: Money,
  shares: readonly BasisPoints[],
): readonly Money[] {
  const validatedTotal = validateMoney(total);

  if (!Array.isArray(shares)) {
    throw new AllocationError('INVALID_ALLOCATION_SHARES');
  }
  if (shares.length === 0) {
    throw new AllocationError('EMPTY_ALLOCATION');
  }

  const validatedShares: BasisPoints[] = [];
  let shareTotal = 0;

  for (let index = 0; index < shares.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(shares, index)) {
      throw new AllocationError('INVALID_ALLOCATION_SHARES');
    }
    const share = createBasisPoints(shares[index]);
    validatedShares.push(share);
    shareTotal += share;
  }

  if (shareTotal !== 10_000) {
    throw new AllocationError('INVALID_ALLOCATION_TOTAL');
  }

  const sign = validatedTotal.amountMinor < 0 ? -1 : 1;
  const magnitude = Math.abs(validatedTotal.amountMinor);
  const quotient = Math.floor(magnitude / 10_000);
  const residue = magnitude % 10_000;
  const amounts: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let allocated = 0;

  for (let index = 0; index < validatedShares.length; index += 1) {
    const share = validatedShares[index];
    const residueProduct = residue * share;
    const base = quotient * share + Math.floor(residueProduct / 10_000);

    amounts.push(base);
    allocated += base;
    remainders.push({
      index,
      remainder: residueProduct % 10_000,
    });
  }

  const remaining = magnitude - allocated;
  const distributionOrder = [...remainders].sort((a, b) => {
    if (a.remainder !== b.remainder) {
      return b.remainder - a.remainder;
    }
    return a.index - b.index;
  });

  for (let offset = 0; offset < remaining; offset += 1) {
    amounts[distributionOrder[offset].index] += 1;
  }

  return Object.freeze(
    amounts.map((amount) =>
      createMoney(sign * amount, validatedTotal.currency),
    ),
  );
}
