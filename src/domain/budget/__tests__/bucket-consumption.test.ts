import { calculateBucketConsumption } from '../bucket-consumption';
const a = 'f1040000-0000-4000-8000-000000000001';
const b = 'f1040000-0000-4000-8000-000000000002';
test('complete bucket aggregates produce an exact immutable, canonical result', () => {
  const input = [
    { budgetBucketId: b, spentMinor: 275 },
    { budgetBucketId: a.toUpperCase(), spentMinor: 100 },
  ];
  const result = calculateBucketConsumption('USD', input);
  expect(
    result.buckets.map((item) => [
      item.budgetBucketId,
      item.spentAmount.amountMinor,
    ]),
  ).toEqual([
    [a, 100],
    [b, 275],
  ]);
  expect(result.totalSpent).toEqual({ amountMinor: 375, currency: 'USD' });
  expect(calculateBucketConsumption('USD', [...input].reverse())).toEqual(
    result,
  );
  expect(input[0].budgetBucketId).toBe(b);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.buckets)).toBe(true);
  expect(Object.isFrozen(result.buckets[0])).toBe(true);
});
test('zero consumption and empty periods are explicit zero, never an estimate', () => {
  expect(calculateBucketConsumption('UYU', []).totalSpent).toEqual({
    amountMinor: 0,
    currency: 'UYU',
  });
  expect(
    calculateBucketConsumption('USD', [{ budgetBucketId: a, spentMinor: 0 }])
      .buckets[0].spentAmount.amountMinor,
  ).toBe(0);
});
test.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid aggregate %s',
  (spentMinor) => {
    expect(() =>
      calculateBucketConsumption('USD', [{ budgetBucketId: a, spentMinor }]),
    ).toThrow();
  },
);
test('accepts safe maximum and rejects aggregate overflow across individually safe buckets', () => {
  expect(
    calculateBucketConsumption('USD', [
      { budgetBucketId: a, spentMinor: Number.MAX_SAFE_INTEGER },
    ]).totalSpent.amountMinor,
  ).toBe(Number.MAX_SAFE_INTEGER);
  expect(() =>
    calculateBucketConsumption('USD', [
      { budgetBucketId: a, spentMinor: Number.MAX_SAFE_INTEGER },
      { budgetBucketId: b, spentMinor: 1 },
    ]),
  ).toThrow();
});
test('duplicate canonical identities, missing IDs and sparse aggregates fail explicitly', () => {
  expect(() =>
    calculateBucketConsumption('USD', [
      { budgetBucketId: a, spentMinor: 1 },
      { budgetBucketId: a.toUpperCase(), spentMinor: 1 },
    ]),
  ).toThrow();
  expect(() =>
    calculateBucketConsumption('USD', [{ budgetBucketId: '', spentMinor: 0 }]),
  ).toThrow();
  expect(() => calculateBucketConsumption('USD', new Array(2))).toThrow();
  expect(() => calculateBucketConsumption('usd', [])).toThrow();
});
