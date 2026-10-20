import { calculateSavingsAvailability } from '../savings-availability';
const base = {
  openingProtectedMinor: 10000,
  allocatedSavingsMinor: 30000,
  contributionsMinor: 5000,
  withdrawalsMinor: 7000,
  spendableAllocatedMinor: 120000,
  spentMinor: 40000,
};
test('allocation is counted once and extra movements have opposite savings/ordinary effects', () => {
  const result = calculateSavingsAvailability('USD', base);
  expect(result.protectedSavings.amountMinor).toBe(38000);
  expect(result.ordinaryMovementAdjustment.amountMinor).toBe(2000);
  expect(result.ordinaryRemainderBeforeCommitments.amountMinor).toBe(82000);
  expect(Object.isFrozen(result)).toBe(true);
});
test('ordinary overspending is negative without using savings', () => {
  const result = calculateSavingsAvailability('USD', {
    ...base,
    spentMinor: 200000,
  });
  expect(result.protectedSavings.amountMinor).toBe(38000);
  expect(result.ordinaryRemainderBeforeCommitments.amountMinor).toBe(-78000);
});
test('zero and exact depletion are supported', () => {
  expect(
    calculateSavingsAvailability('UYU', { ...base, withdrawalsMinor: 45000 })
      .protectedSavings.amountMinor,
  ).toBe(0);
});
test.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid minor units %s',
  (value) => {
    expect(() =>
      calculateSavingsAvailability('USD', {
        ...base,
        contributionsMinor: value,
      }),
    ).toThrow();
  },
);
test('rejects overdraw, invalid currency and unsafe intermediate sums', () => {
  expect(() =>
    calculateSavingsAvailability('USD', { ...base, withdrawalsMinor: 45001 }),
  ).toThrow();
  expect(() => calculateSavingsAvailability('usd', base)).toThrow();
  expect(() =>
    calculateSavingsAvailability('USD', {
      ...base,
      openingProtectedMinor: Number.MAX_SAFE_INTEGER,
    }),
  ).toThrow();
  expect(() =>
    calculateSavingsAvailability('USD', {
      ...base,
      spendableAllocatedMinor: Number.MAX_SAFE_INTEGER,
    }),
  ).toThrow();
});
test('zero-cash carry changes only net ordinary capacity, never cumulative protected savings', () => {
  const result = calculateSavingsAvailability('USD', base, {
    incomingMinor: 1000,
    outgoingMinor: 300,
  });
  expect(result.ordinaryRemainderBeforeCommitments.amountMinor).toBe(82700);
  expect(result.protectedSavings.amountMinor).toBe(38000);
  expect(result.ordinaryMovementAdjustment.amountMinor).toBe(2000);
});
test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid carry component %s',
  (value) => {
    expect(() =>
      calculateSavingsAvailability('USD', base, {
        incomingMinor: value,
        outgoingMinor: 0,
      }),
    ).toThrow();
    expect(() =>
      calculateSavingsAvailability('USD', base, {
        incomingMinor: 0,
        outgoingMinor: value,
      }),
    ).toThrow();
  },
);
test('unsafe carry intermediate sum fails closed rather than rounding', () => {
  expect(() =>
    calculateSavingsAvailability('USD', base, {
      incomingMinor: Number.MAX_SAFE_INTEGER,
      outgoingMinor: 0,
    }),
  ).toThrow();
});
