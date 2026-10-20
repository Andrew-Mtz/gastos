import {
  calculateActualBudgetAllocation,
  createBudgetAllocationPlan,
} from '../budget-allocation';
import {
  calculateProtectedBudgetAllocation,
  ProtectedBudgetAllocationError,
} from '../protected-budget-allocation';
import { calculateBucketConsumption } from '../bucket-consumption';
import { subtractMoney } from '../../money/money';

const periodId = 'f1140000-0000-4000-8000-000000000001';
const buckets = [
  { id: 'b1140000-0000-4000-8000-000000000001', type: 'SPENDABLE' as const },
  { id: 'b1140000-0000-4000-8000-000000000002', type: 'SPENDABLE' as const },
  { id: 'b1140000-0000-4000-8000-000000000003', type: 'SAVINGS' as const },
];
const planFor = (values = [5000, 3000, 2000], currency = 'USD') =>
  createBudgetAllocationPlan(
    periodId,
    currency,
    values.map((percentageBasisPoints, index) => ({
      budgetBucketId: buckets[index].id,
      percentageBasisPoints,
    })),
  );
const plan = planFor();

test('1500 received protects 300 and allocates only 1200 to ordinary spending', () => {
  const result = calculateProtectedBudgetAllocation(plan, 150000, buckets);
  expect(result.protectedSavings.amountMinor).toBe(30000);
  expect(result.spendableAllocated.amountMinor).toBe(120000);
  expect(result.allocations.map((item) => item.bucketType)).toEqual([
    'SPENDABLE',
    'SPENDABLE',
    'SAVINGS',
  ]);
});
test('preserves FIN-110 rounded amounts rather than rerounding each group', () => {
  const input = planFor([3333, 3333, 3334]);
  const result = calculateProtectedBudgetAllocation(input, 2, buckets);
  expect(result.allocations.map((item) => item.allocatedAmount)).toEqual(
    calculateActualBudgetAllocation(input, 2).map(
      (item) => item.allocatedAmount,
    ),
  );
  expect(result.protectedSavings.amountMinor).toBe(1);
  expect(result.spendableAllocated.amountMinor).toBe(1);
});
test('sums multiple custom or archived savings buckets by type, not label or key', () => {
  const classified = buckets.map((bucket, index) => ({
    ...bucket,
    id: bucket.id.toUpperCase(),
    type: index === 0 ? ('SPENDABLE' as const) : ('SAVINGS' as const),
    name: index === 0 ? 'Savings' : 'Ordinary',
    system_key: null,
    archived_at: '2026-10-01T00:00:00Z',
  }));
  const result = calculateProtectedBudgetAllocation(plan, 143000, classified);
  expect(result.protectedSavings.amountMinor).toBe(71500);
  expect(result.spendableAllocated.amountMinor).toBe(71500);
});
test.each([0, -0, 1, Number.MAX_SAFE_INTEGER])(
  'conserves every safe minor unit for total %p',
  (total) => {
    const result = calculateProtectedBudgetAllocation(plan, total, buckets);
    expect(
      result.protectedSavings.amountMinor +
        result.spendableAllocated.amountMinor,
    ).toBe(total === 0 ? 0 : total);
    expect(Number.isSafeInteger(result.protectedSavings.amountMinor)).toBe(
      true,
    );
    expect(Number.isSafeInteger(result.spendableAllocated.amountMinor)).toBe(
      true,
    );
  },
);
test.each([
  [10000, 0, 0],
  [0, 0, 10000],
])(
  'zero shares and all-saving or all-spendable plans work: %p',
  (...shares) => {
    const result = calculateProtectedBudgetAllocation(
      planFor(shares),
      123,
      buckets,
    );
    expect(result.protectedSavings.amountMinor).toBe(shares[2] ? 123 : 0);
    expect(result.spendableAllocated.amountMinor).toBe(shares[0] ? 123 : 0);
  },
);
test('ordinary overspending cannot reduce protected savings or rebalance allocations', () => {
  const result = calculateProtectedBudgetAllocation(plan, 150000, buckets);
  const spent = calculateBucketConsumption('USD', [
    { budgetBucketId: buckets[0].id, spentMinor: 160000 },
  ]);
  // A future remaining calculation must preserve the deficit, not raid savings.
  expect(
    subtractMoney(result.spendableAllocated, spent.totalSpent).amountMinor,
  ).toBe(-40000);
  expect(result.protectedSavings.amountMinor).toBe(30000);
  expect(calculateProtectedBudgetAllocation(plan, 150000, buckets)).toEqual(
    result,
  );
});
test('a snapshot currency and configuration remain independent from other periods', () => {
  const later = planFor([4500, 1500, 4000], 'UYU');
  expect(
    calculateProtectedBudgetAllocation(later, 150000, buckets).protectedSavings,
  ).toEqual({ amountMinor: 60000, currency: 'UYU' });
  expect(
    calculateProtectedBudgetAllocation(plan, 150000, buckets).protectedSavings,
  ).toEqual({ amountMinor: 30000, currency: 'USD' });
});
test.each([
  buckets.slice(0, 2),
  [...buckets, buckets[0]],
  [...buckets, { ...buckets[0], id: buckets[0].id.toUpperCase() }],
  [{ ...buckets[0], type: 'UNKNOWN' }, ...buckets.slice(1)],
  [{ ...buckets[0], id: 'bad-id' }, ...buckets.slice(1)],
  [null],
  Array(3),
  null,
])('rejects missing, duplicate or invalid classifications: %p', (input) => {
  expect(() =>
    calculateProtectedBudgetAllocation(
      plan,
      150000,
      input as unknown as typeof buckets,
    ),
  ).toThrow(ProtectedBudgetAllocationError);
});
test('missing classification is an error even when received income is zero', () => {
  expect(() => calculateProtectedBudgetAllocation(plan, 0, [])).toThrow(
    ProtectedBudgetAllocationError,
  );
});
test('invalid actual income cannot bypass FIN-110 validation', () => {
  expect(() => calculateProtectedBudgetAllocation(plan, -1, buckets)).toThrow();
  expect(() =>
    calculateProtectedBudgetAllocation(
      plan,
      Number.MAX_SAFE_INTEGER + 1,
      buckets,
    ),
  ).toThrow();
});
test('does not mutate inputs and returns deeply frozen derived values', () => {
  const before = JSON.stringify({ plan, buckets });
  const result = calculateProtectedBudgetAllocation(plan, 150000, buckets);
  expect(JSON.stringify({ plan, buckets })).toBe(before);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.allocations)).toBe(true);
  expect(result.allocations.every(Object.isFrozen)).toBe(true);
  expect(Object.isFrozen(result.protectedSavings)).toBe(true);
  expect(Object.isFrozen(result.spendableAllocated)).toBe(true);
});
