import { AllocationError } from '../../allocation/allocation';
import { MoneyError } from '../../money/money';
import {
  BudgetAllocationError,
  calculatePlannedBudgetAllocation,
  createBudgetAllocationPlan,
  type BudgetAllocationPlan,
} from '../budget-allocation';

const periodId = 'f1050000-0000-4000-8000-000000000001';
const nextPeriodId = 'f1050000-0000-4000-8000-000000000002';
const buckets = [
  'b1050000-0000-4000-8000-000000000001',
  'b1050000-0000-4000-8000-000000000002',
  'b1050000-0000-4000-8000-000000000003',
];
const shares = (percentages = [5000, 3000, 2000]) =>
  percentages.map((percentageBasisPoints, index) => ({
    budgetBucketId: buckets[index],
    percentageBasisPoints,
  }));
const plan = () => createBudgetAllocationPlan(periodId, 'USD', shares());
const amounts = (value: BudgetAllocationPlan, income: number | null) =>
  calculatePlannedBudgetAllocation(value, income).map(
    (allocation) => allocation.plannedAmount?.amountMinor ?? null,
  );

describe('period budget allocation', () => {
  it('keeps period identity and currency with complete keyed shares', () => {
    expect(plan()).toEqual({
      budgetPeriodId: periodId,
      baseCurrency: 'USD',
      allocations: shares(),
    });
  });

  it('uses existing deterministic Money arithmetic for planning', () => {
    expect(amounts(plan(), 150000)).toEqual([75000, 45000, 30000]);
    expect(
      calculatePlannedBudgetAllocation(plan(), 150000)[2].plannedAmount
        ?.currency,
    ).toBe('USD');
  });

  it('canonicalizes UUIDs and orders by bucket identity, independent of query order', () => {
    const input = shares([5000, 5000]);
    const first = createBudgetAllocationPlan(
      periodId.toUpperCase(),
      'UYU',
      input,
    );
    const reversed = createBudgetAllocationPlan(
      periodId,
      'UYU',
      [...input].reverse().map((share) => ({
        ...share,
        budgetBucketId: share.budgetBucketId.toUpperCase(),
      })),
    );
    expect(first).toEqual(reversed);
    expect(amounts(first, 1)).toEqual([1, 0]);
    expect(amounts(reversed, 1)).toEqual([1, 0]);
  });

  it('distinguishes missing expected income from an explicit zero', () => {
    expect(amounts(plan(), null)).toEqual([null, null, null]);
    expect(amounts(plan(), 0)).toEqual([0, 0, 0]);
    expect(amounts(plan(), -0)).toEqual([0, 0, 0]);
  });

  it('preserves every minor unit even at the safe-integer limit', () => {
    const result = amounts(
      createBudgetAllocationPlan(periodId, 'USD', shares([3333, 3333, 3334])),
      Number.MAX_SAFE_INTEGER,
    );
    expect(result).toEqual([
      3002099511605172, 3002099511605172, 3003000231530647,
    ]);
    expect(result.reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(result.every(Number.isSafeInteger)).toBe(true);
  });

  it('supports zero shares without moving their units into savings implicitly', () => {
    expect(
      amounts(
        createBudgetAllocationPlan(periodId, 'USD', shares([10000, 0, 0])),
        999,
      ),
    ).toEqual([999, 0, 0]);
  });

  it('keeps prior periods and caller inputs unchanged when a future plan changes', () => {
    const input = shares();
    const previous = createBudgetAllocationPlan(periodId, 'USD', input);
    input[0].percentageBasisPoints = 1000;
    const next = createBudgetAllocationPlan(
      nextPeriodId,
      'USD',
      shares([4500, 1500, 4000]),
    );
    expect(amounts(previous, 10000)).toEqual([5000, 3000, 2000]);
    expect(amounts(next, 10000)).toEqual([4500, 1500, 4000]);
    expect(previous.budgetPeriodId).toBe(periodId);
  });

  it('freezes copied plans, shares and calculation results', () => {
    const value = plan();
    const calculated = calculatePlannedBudgetAllocation(value, 3);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.allocations)).toBe(true);
    expect(value.allocations.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(calculated)).toBe(true);
    expect(calculated.every(Object.isFrozen)).toBe(true);
    expect(
      calculated.every((allocation) =>
        Object.isFrozen(allocation.plannedAmount),
      ),
    ).toBe(true);
  });

  it.each([
    '',
    'period',
    ` ${periodId}`,
    'f1050000-0000-4000-8000-00000000000g',
  ])('rejects invalid period id %p', (id) => {
    expect(() => createBudgetAllocationPlan(id, 'USD', shares())).toThrow(
      BudgetAllocationError,
    );
  });

  it('rejects invalid bucket identities and case-insensitive duplicates', () => {
    expect(() =>
      createBudgetAllocationPlan(periodId, 'USD', [
        { budgetBucketId: '', percentageBasisPoints: 10000 },
      ]),
    ).toThrow(BudgetAllocationError);
    expect(() =>
      createBudgetAllocationPlan(periodId, 'USD', [
        { budgetBucketId: buckets[0], percentageBasisPoints: 5000 },
        {
          budgetBucketId: buckets[0].toUpperCase(),
          percentageBasisPoints: 5000,
        },
      ]),
    ).toThrow('Each bucket may occur only once');
  });

  it.each([
    [],
    [5000, 3000],
    [5000, 3001, 2000],
    [-1, 10001],
    [5000.5, 4999.5],
    [NaN],
    [Infinity],
  ])('rejects invalid percentages %p', (...percentages) => {
    // test.each spreads each row, so reconstruct the supplied percentage list.
    expect(() =>
      createBudgetAllocationPlan(periodId, 'USD', shares(percentages)),
    ).toThrow(AllocationError);
  });

  it('rejects sparse and malformed share collections', () => {
    expect(() =>
      createBudgetAllocationPlan(periodId, 'USD', new Array(3)),
    ).toThrow(BudgetAllocationError);
    expect(() =>
      createBudgetAllocationPlan(
        periodId,
        'USD',
        null as unknown as ReturnType<typeof shares>,
      ),
    ).toThrow(BudgetAllocationError);
    expect(() =>
      createBudgetAllocationPlan(periodId, 'USD', [
        null,
      ] as unknown as ReturnType<typeof shares>),
    ).toThrow(BudgetAllocationError);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    'rejects invalid expected income %p',
    (income) => {
      expect(() => calculatePlannedBudgetAllocation(plan(), income)).toThrow(
        BudgetAllocationError,
      );
    },
  );

  it('revalidates a structurally forged plan at the calculation boundary', () => {
    const forged = {
      ...plan(),
      allocations: shares([4000, 3000, 2000]),
    } as unknown as BudgetAllocationPlan;
    expect(() => calculatePlannedBudgetAllocation(forged, null)).toThrow(
      AllocationError,
    );
    expect(() => createBudgetAllocationPlan(periodId, 'usd', shares())).toThrow(
      MoneyError,
    );
  });
});
