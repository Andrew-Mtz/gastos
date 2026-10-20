import { addMoney, createMoney, type Money } from '../money/money';

export type BucketSpending = Readonly<{
  budgetBucketId: string;
  spentAmount: Money;
}>;
export type BucketConsumption = Readonly<{
  buckets: readonly BucketSpending[];
  totalSpent: Money;
}>;

export class BucketConsumptionError extends Error {
  constructor() {
    super(
      'Consumption requires unique bucket UUIDs and nonnegative safe amounts.',
    );
    this.name = 'BucketConsumptionError';
  }
}

/** Reduce complete server aggregates, never a page of transaction history.
 * The source excludes deleted/non-expense rows and rejects unsupported mappings.
 * This calculation creates no remaining balance, cash or savings movement. */
export function calculateBucketConsumption(
  currency: string,
  totals: readonly Readonly<{
    budgetBucketId: string;
    spentMinor: number;
  }>[],
): BucketConsumption {
  let totalSpent = createMoney(0, currency);
  if (!Array.isArray(totals)) throw new BucketConsumptionError();
  const seen = new Set<string>();
  const buckets: BucketSpending[] = [];
  for (let index = 0; index < totals.length; index += 1) {
    const item = totals[index];
    if (
      !Object.prototype.hasOwnProperty.call(totals, index) ||
      item === null ||
      typeof item !== 'object' ||
      typeof item.budgetBucketId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        item.budgetBucketId,
      ) ||
      !Number.isSafeInteger(item.spentMinor) ||
      item.spentMinor < 0
    )
      throw new BucketConsumptionError();
    const budgetBucketId = item.budgetBucketId.toLowerCase();
    if (seen.has(budgetBucketId)) throw new BucketConsumptionError();
    seen.add(budgetBucketId);
    const spentAmount = createMoney(item.spentMinor, currency);
    totalSpent = addMoney(totalSpent, spentAmount);
    buckets.push(Object.freeze({ budgetBucketId, spentAmount }));
  }
  buckets.sort((a, b) =>
    a.budgetBucketId < b.budgetBucketId
      ? -1
      : a.budgetBucketId > b.budgetBucketId
        ? 1
        : 0,
  );
  return Object.freeze({ buckets: Object.freeze(buckets), totalSpent });
}
