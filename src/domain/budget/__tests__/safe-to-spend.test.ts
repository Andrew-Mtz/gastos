import { calculateSafeToSpend } from '../safe-to-spend';
const bucket = {
  budgetBucketId: 'f1040000-0000-4000-8000-000000000001',
  confirmedMinor: 100,
  estimatedMinor: 50,
  confirmedCount: 1,
  estimatedCount: 1,
  unknownCount: 0,
};
const input = {
  configured: true,
  savings: {
    openingProtectedMinor: 5000,
    allocatedSavingsMinor: 200,
    contributionsMinor: 80,
    withdrawalsMinor: 30,
    spendableAllocatedMinor: 800,
    spentMinor: 400,
  },
  commitments: { currency: 'USD', priorUnresolvedCount: 0, buckets: [bucket] },
};
test('complete formula excludes protected reserves and counts movements once', () => {
  const result = calculateSafeToSpend(input);
  expect(result.confirmedMargin?.amountMinor).toBe(250);
  expect(result.estimatedMargin?.amountMinor).toBe(200);
  expect(result.savings.protectedSavings.amountMinor).toBe(5250);
  expect(result.commitments.estimated.amountMinor).toBe(50);
  expect(Object.isFrozen(result)).toBe(true);
});
test('zero actual-income allocation never uses expected income or protected savings', () => {
  const result = calculateSafeToSpend({
    ...input,
    savings: { ...input.savings, spendableAllocatedMinor: 0 },
  });
  expect(result.confirmedMargin?.amountMinor).toBe(-550);
  expect(result.savings.protectedSavings.amountMinor).toBe(5250);
});
test('overspending remains negative and never silently consumes savings', () => {
  const result = calculateSafeToSpend({
    ...input,
    savings: { ...input.savings, spentMinor: 900 },
  });
  expect(result.confirmedMargin?.amountMinor).toBe(-250);
  expect(result.estimatedMargin?.amountMinor).toBe(-300);
});
test.each(['USD', 'UYU', 'EUR', 'ARS', 'BRL'])(
  'keeps the original currency %s',
  (currency) => {
    expect(
      calculateSafeToSpend({
        ...input,
        commitments: { ...input.commitments, currency },
      }).confirmedMargin?.currency,
    ).toBe(currency);
  },
);
test.each([
  { ...input, configured: false },
  { ...input, commitments: { ...input.commitments, priorUnresolvedCount: 1 } },
  {
    ...input,
    commitments: {
      ...input.commitments,
      buckets: [{ ...bucket, unknownCount: 1 }],
    },
  },
])(
  'incomplete obligations/allocation withhold all numeric margins',
  (value) => {
    const result = calculateSafeToSpend(value);
    expect(result.confirmedMargin).toBeNull();
    expect(result.estimatedMargin).toBeNull();
    expect(result.commitments.confirmed.amountMinor).toBe(100);
  },
);
test('known zero estimate remains explicitly approximate', () => {
  const result = calculateSafeToSpend({
    ...input,
    commitments: {
      ...input.commitments,
      buckets: [{ ...bucket, estimatedMinor: 0 }],
    },
  });
  expect(result.estimatedMargin?.amountMinor).toBe(250);
});
test('no estimates has no approximate second margin, including a real zero result', () => {
  const result = calculateSafeToSpend({
    ...input,
    savings: { ...input.savings, spentMinor: 650 },
    commitments: {
      ...input.commitments,
      buckets: [{ ...bucket, estimatedMinor: 0, estimatedCount: 0 }],
    },
  });
  expect(result.confirmedMargin?.amountMinor).toBe(0);
  expect(result.estimatedMargin).toBeNull();
});
test.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
  'invalid financial components fail closed: %s',
  (spentMinor) => {
    expect(() =>
      calculateSafeToSpend({
        ...input,
        savings: { ...input.savings, spentMinor },
      }),
    ).toThrow();
  },
);
test('overflow from subtracting confirmed or estimated obligations fails closed', () => {
  const negative = {
    ...input,
    savings: {
      ...input.savings,
      spendableAllocatedMinor: 0,
      contributionsMinor: 0,
      withdrawalsMinor: 0,
      spentMinor: Number.MAX_SAFE_INTEGER,
    },
  };
  expect(() => calculateSafeToSpend(negative)).toThrow();
  expect(() =>
    calculateSafeToSpend({
      ...negative,
      commitments: {
        ...input.commitments,
        buckets: [{ ...bucket, confirmedMinor: 0, confirmedCount: 0 }],
      },
    }),
  ).toThrow();
});
test('duplicate buckets and malformed currency/counts do not yield partial margins', () => {
  expect(() =>
    calculateSafeToSpend({
      ...input,
      commitments: { ...input.commitments, buckets: [bucket, bucket] },
    }),
  ).toThrow();
  expect(() =>
    calculateSafeToSpend({
      ...input,
      commitments: { ...input.commitments, currency: 'usd' },
    }),
  ).toThrow();
  expect(() =>
    calculateSafeToSpend({
      ...input,
      commitments: { ...input.commitments, priorUnresolvedCount: -1 },
    }),
  ).toThrow();
});
