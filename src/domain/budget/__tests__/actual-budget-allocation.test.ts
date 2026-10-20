import { AllocationError } from '../../allocation/allocation';
import {
  BudgetAllocationError,
  calculateActualBudgetAllocation,
  calculatePlannedBudgetAllocation,
  createBudgetAllocationPlan,
  type BudgetAllocationPlan,
} from '../budget-allocation';
const periodId = 'f1100000-0000-4000-8000-000000000001';
const shares = (values = [5000, 3000, 2000]) =>
  values.map((percentageBasisPoints, index) => ({
    budgetBucketId: `b1100000-0000-4000-8000-00000000000${index + 1}`,
    percentageBasisPoints,
  }));
const plan = createBudgetAllocationPlan(periodId, 'USD', shares());
const actual = (income: number, input = plan) =>
  calculateActualBudgetAllocation(input, income).map(
    (item) => item.allocatedAmount.amountMinor,
  );

test('1430 received distributes 715/429/286, distinct from the 1500 estimate', () => {
  expect(actual(143000)).toEqual([71500, 42900, 28600]);
  expect(
    calculatePlannedBudgetAllocation(plan, 150000).map(
      (item) => item.plannedAmount?.amountMinor,
    ),
  ).toEqual([75000, 45000, 30000]);
  expect(actual(143000)).toEqual([71500, 42900, 28600]);
});
test('no received income is zero, never an expected-income fallback', () => {
  expect(actual(0)).toEqual([0, 0, 0]);
  expect(actual(-0)).toEqual([0, 0, 0]);
  expect(
    calculatePlannedBudgetAllocation(plan, null).map(
      (item) => item.plannedAmount,
    ),
  ).toEqual([null, null, null]);
});
test('allocates the aggregate once, not separately rounded installments', () => {
  const equal = createBudgetAllocationPlan(
    periodId,
    'USD',
    shares([5000, 5000]),
  );
  expect(actual(1 + 1, equal)).toEqual([1, 1]);
  expect(actual(1, equal)).toEqual([1, 0]);
});
test('ties use normalized bucket identity regardless of query order', () => {
  const reversed = createBudgetAllocationPlan(
    periodId,
    'UYU',
    shares([5000, 5000]).reverse(),
  );
  expect(actual(1, reversed)).toEqual([1, 0]);
  expect(
    calculateActualBudgetAllocation(reversed, 1)[0].allocatedAmount.currency,
  ).toBe('UYU');
});
test('zero shares and maximum safe total preserve every minor unit', () => {
  expect(
    actual(
      999,
      createBudgetAllocationPlan(periodId, 'USD', shares([10000, 0, 0])),
    ),
  ).toEqual([999, 0, 0]);
  const result = actual(Number.MAX_SAFE_INTEGER);
  expect(result.every(Number.isSafeInteger)).toBe(true);
  expect(result.reduce((sum, value) => sum + BigInt(value), 0n)).toBe(
    BigInt(Number.MAX_SAFE_INTEGER),
  );
});
test.each([
  -1,
  0.5,
  Number.MAX_SAFE_INTEGER + 1,
  NaN,
  Infinity,
  null,
  undefined,
])('rejects invalid received total %p', (income) => {
  expect(() => actual(income as number)).toThrow(BudgetAllocationError);
});
test('revalidates serialized plans rather than silently normalizing percentages', () => {
  const forged = {
    ...plan,
    allocations: shares([5000, 2000, 2000]),
  } as unknown as BudgetAllocationPlan;
  expect(() => actual(100, forged)).toThrow(AllocationError);
});
test('preserves period snapshots and freezes results without modifying the plan', () => {
  const later = createBudgetAllocationPlan(
    'f1100000-0000-4000-8000-000000000002',
    'USD',
    shares([4500, 1500, 4000]),
  );
  expect(actual(10000, later)).toEqual([4500, 1500, 4000]);
  expect(actual(10000)).toEqual([5000, 3000, 2000]);
  const result = calculateActualBudgetAllocation(plan, 10000);
  expect(Object.isFrozen(result)).toBe(true);
  expect(
    result.every(
      (item) => Object.isFrozen(item) && Object.isFrozen(item.allocatedAmount),
    ),
  ).toBe(true);
});
