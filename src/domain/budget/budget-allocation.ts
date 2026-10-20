import {
  allocateMoney,
  createBasisPoints,
  type BasisPoints,
} from '../allocation/allocation';
import {
  createCurrencyCode,
  createMoney,
  type CurrencyCode,
  type Money,
} from '../money/money';

export type BudgetAllocationShare = Readonly<{
  budgetBucketId: string;
  percentageBasisPoints: BasisPoints;
}>;

export type BudgetAllocationPlan = Readonly<{
  budgetPeriodId: string;
  baseCurrency: CurrencyCode;
  allocations: readonly BudgetAllocationShare[];
}>;

export type PlannedBudgetAllocation = BudgetAllocationShare &
  Readonly<{
    plannedAmount: Money | null;
  }>;

export type BudgetAllocationErrorCode =
  | 'INVALID_BUDGET_ID'
  | 'INVALID_BUDGET_SHARES'
  | 'DUPLICATE_BUDGET_BUCKET'
  | 'INVALID_EXPECTED_INCOME'
  | 'INVALID_RECEIVED_INCOME';

const messages: Record<BudgetAllocationErrorCode, string> = {
  INVALID_BUDGET_ID: 'Budget period and bucket identifiers must be UUIDs.',
  INVALID_BUDGET_SHARES:
    'Budget allocations require a dense array of bucket shares.',
  DUPLICATE_BUDGET_BUCKET:
    'Each bucket may occur only once in a period allocation.',
  INVALID_EXPECTED_INCOME:
    'Expected income must be null or nonnegative safe-integer minor units.',
  INVALID_RECEIVED_INCOME:
    'Received income must be nonnegative safe-integer minor units.',
};

export class BudgetAllocationError extends Error {
  readonly code: BudgetAllocationErrorCode;

  constructor(code: BudgetAllocationErrorCode) {
    super(messages[code]);
    this.name = 'BudgetAllocationError';
    this.code = code;
  }
}

function normalizeId(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BudgetAllocationError('INVALID_BUDGET_ID');
  }
  return value.toLowerCase();
}

export function createBudgetAllocationPlan(
  budgetPeriodId: string,
  baseCurrency: string,
  allocations: readonly Readonly<{
    budgetBucketId: string;
    percentageBasisPoints: number;
  }>[],
): BudgetAllocationPlan {
  const periodId = normalizeId(budgetPeriodId);
  const currency = createCurrencyCode(baseCurrency);
  if (!Array.isArray(allocations)) {
    throw new BudgetAllocationError('INVALID_BUDGET_SHARES');
  }
  const seen = new Set<string>();
  const shares: BudgetAllocationShare[] = [];
  for (let index = 0; index < allocations.length; index += 1) {
    const share = allocations[index];
    if (
      !Object.prototype.hasOwnProperty.call(allocations, index) ||
      share === null ||
      typeof share !== 'object'
    ) {
      throw new BudgetAllocationError('INVALID_BUDGET_SHARES');
    }
    const bucketId = normalizeId(share.budgetBucketId);
    if (seen.has(bucketId)) {
      throw new BudgetAllocationError('DUPLICATE_BUDGET_BUCKET');
    }
    seen.add(bucketId);
    shares.push(
      Object.freeze({
        budgetBucketId: bucketId,
        percentageBasisPoints: createBasisPoints(share.percentageBasisPoints),
      }),
    );
  }
  // Database query order must not decide which bucket receives a rounding unit.
  shares.sort((a, b) =>
    a.budgetBucketId < b.budgetBucketId
      ? -1
      : a.budgetBucketId > b.budgetBucketId
        ? 1
        : 0,
  );
  allocateMoney(
    createMoney(0, currency),
    shares.map((share) => share.percentageBasisPoints),
  );
  return Object.freeze({
    budgetPeriodId: periodId,
    baseCurrency: currency,
    allocations: Object.freeze(shares),
  });
}

export function calculatePlannedBudgetAllocation(
  plan: BudgetAllocationPlan,
  expectedIncomeMinor: number | null,
): readonly PlannedBudgetAllocation[] {
  // Revalidate the boundary so serialized or structurally forged input cannot
  // bypass uniqueness, total, identity, currency, or safe-integer checks.
  const validated = createBudgetAllocationPlan(
    plan.budgetPeriodId,
    plan.baseCurrency,
    plan.allocations,
  );
  if (
    expectedIncomeMinor !== null &&
    (!Number.isSafeInteger(expectedIncomeMinor) || expectedIncomeMinor < 0)
  ) {
    throw new BudgetAllocationError('INVALID_EXPECTED_INCOME');
  }
  const amounts =
    expectedIncomeMinor === null
      ? null
      : allocateMoney(
          createMoney(expectedIncomeMinor, validated.baseCurrency),
          validated.allocations.map((share) => share.percentageBasisPoints),
        );
  return Object.freeze(
    validated.allocations.map((share, index) =>
      Object.freeze({
        ...share,
        plannedAmount: amounts === null ? null : amounts[index],
      }),
    ),
  );
}

export type ActualBudgetAllocation = BudgetAllocationShare &
  Readonly<{ allocatedAmount: Money }>;

/** Allocate the period's total received income once, never its estimate.
 * These are pre-consumption amounts, not remaining balances or safe-to-spend. */
export function calculateActualBudgetAllocation(
  plan: BudgetAllocationPlan,
  receivedIncomeMinor: number,
): readonly ActualBudgetAllocation[] {
  const validated = createBudgetAllocationPlan(
    plan.budgetPeriodId,
    plan.baseCurrency,
    plan.allocations,
  );
  if (!Number.isSafeInteger(receivedIncomeMinor) || receivedIncomeMinor < 0) {
    throw new BudgetAllocationError('INVALID_RECEIVED_INCOME');
  }
  const amounts = allocateMoney(
    createMoney(receivedIncomeMinor, validated.baseCurrency),
    validated.allocations.map((share) => share.percentageBasisPoints),
  );
  return Object.freeze(
    validated.allocations.map((share, index) =>
      Object.freeze({ ...share, allocatedAmount: amounts[index] }),
    ),
  );
}
