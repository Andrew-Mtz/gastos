import { allocateMoney } from '../allocation/allocation';
import {
  createHouseholdSplit,
  type HouseholdShare,
} from '../household/default-split';
import { createMoney, MoneyError, type Money } from '../money/money';

export type SharedExpenseResponsibility = HouseholdShare &
  Readonly<{ responsibilityAmount: Money }>;

/** Pure responsibility calculation, not a membership or payer authorization check.
 * memberId is the FIN-205 membership UUID, not a Profile ID. */
export function calculateSharedExpenseSplit(
  total: Money,
  shares: readonly Readonly<{ memberId: string; basisPoints: number }>[],
): readonly SharedExpenseResponsibility[] {
  if (total === null || typeof total !== 'object') {
    throw new MoneyError('INVALID_AMOUNT');
  }
  const expense = createMoney(total.amountMinor, total.currency);
  if (expense.amountMinor <= 0) {
    throw new Error('Shared expense amount must be positive.');
  }
  if (!Array.isArray(shares)) {
    throw new Error('Shared expense shares require a dense array.');
  }

  const canonicalShares: { memberId: string; basisPoints: number }[] = [];
  for (let index = 0; index < shares.length; index += 1) {
    const share = shares[index];
    if (
      !Object.prototype.hasOwnProperty.call(shares, index) ||
      share === null ||
      typeof share !== 'object'
    ) {
      throw new Error('Shared expense shares require a dense array.');
    }
    if (
      typeof share.memberId !== 'string' ||
      share.memberId.length !== 36 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        share.memberId,
      )
    ) {
      throw new Error('Shared expense member identifiers must be UUIDs.');
    }
    canonicalShares.push({
      memberId: share.memberId.toLowerCase(),
      basisPoints: share.basisPoints,
    });
  }
  const validated = createHouseholdSplit(
    canonicalShares.map((share) => share.memberId),
    canonicalShares,
  );
  // FIN-102 breaks ties by input order. Locale and query order must not decide
  // which membership receives a rounding unit, so sort a copy by canonical UUID.
  const ordered = [...validated].sort((a, b) =>
    a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0,
  );
  const amounts = allocateMoney(
    expense,
    ordered.map((share) => share.basisPoints),
  );
  return Object.freeze(
    ordered.map((share, index) =>
      Object.freeze({ ...share, responsibilityAmount: amounts[index] }),
    ),
  );
}
