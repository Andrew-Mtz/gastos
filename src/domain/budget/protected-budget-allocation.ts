import {
  calculateActualBudgetAllocation,
  type ActualBudgetAllocation,
  type BudgetAllocationPlan,
} from './budget-allocation';
import { addMoney, createMoney, type Money } from '../money/money';

type BucketType = 'SPENDABLE' | 'SAVINGS';
type ClassifiedAllocation = ActualBudgetAllocation &
  Readonly<{ bucketType: BucketType }>;

export type ProtectedBudgetAllocation = Readonly<{
  allocations: readonly ClassifiedAllocation[];
  protectedSavings: Money;
  spendableAllocated: Money;
}>;

export class ProtectedBudgetAllocationError extends Error {
  constructor() {
    super('Every allocated bucket requires one valid savings classification.');
    this.name = 'ProtectedBudgetAllocationError';
  }
}

/** Partition FIN-110's rounded received-income allocation, never reround subsets.
 * Savings classification comes from immutable bucket type, including archived
 * references. These are allocations, not remaining or cumulative balances. */
export function calculateProtectedBudgetAllocation(
  plan: BudgetAllocationPlan,
  receivedIncomeMinor: number,
  buckets: readonly Readonly<{ id: string; type: BucketType }>[],
): ProtectedBudgetAllocation {
  const actual = calculateActualBudgetAllocation(plan, receivedIncomeMinor);
  if (!Array.isArray(buckets)) throw new ProtectedBudgetAllocationError();
  const types = new Map<string, BucketType>();
  for (let index = 0; index < buckets.length; index += 1) {
    const bucket = buckets[index];
    if (
      !Object.prototype.hasOwnProperty.call(buckets, index) ||
      bucket === null ||
      typeof bucket !== 'object' ||
      typeof bucket.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        bucket.id,
      ) ||
      (bucket.type !== 'SPENDABLE' && bucket.type !== 'SAVINGS')
    )
      throw new ProtectedBudgetAllocationError();
    const id = bucket.id.toLowerCase();
    if (types.has(id)) throw new ProtectedBudgetAllocationError();
    types.set(id, bucket.type);
  }
  let protectedSavings = createMoney(0, plan.baseCurrency);
  let spendableAllocated = createMoney(0, plan.baseCurrency);
  const allocations = actual.map((allocation) => {
    const bucketType = types.get(allocation.budgetBucketId);
    // Missing classification must not turn protected money into ordinary funds.
    if (!bucketType) throw new ProtectedBudgetAllocationError();
    if (bucketType === 'SAVINGS')
      protectedSavings = addMoney(protectedSavings, allocation.allocatedAmount);
    else
      spendableAllocated = addMoney(
        spendableAllocated,
        allocation.allocatedAmount,
      );
    return Object.freeze({ ...allocation, bucketType });
  });
  return Object.freeze({
    allocations: Object.freeze(allocations),
    protectedSavings,
    spendableAllocated,
  });
}
