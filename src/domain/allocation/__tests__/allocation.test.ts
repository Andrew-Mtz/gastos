import {
  AllocationError,
  allocateMoney,
  createBasisPoints,
  type AllocationErrorCode,
  type BasisPoints,
} from '../allocation';
import { createMoney, MoneyError, type Money } from '../../money/money';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;

function expectAllocationError(
  action: () => unknown,
  code: AllocationErrorCode,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AllocationError);
  expect(caught).toEqual(
    expect.objectContaining({ name: 'AllocationError', code }),
  );
}

const bps = (...values: number[]): BasisPoints[] =>
  values.map(createBasisPoints);

const amounts = (values: readonly Money[]): number[] =>
  values.map((value) => value.amountMinor);

describe('BasisPoints', () => {
  test.each([0, 1, 9_999, 10_000])('accepts %s', (value) => {
    expect(createBasisPoints(value)).toBe(value);
  });

  test.each([-1, 10_001, 0.5, NaN, Infinity, -Infinity, MAX + 1, MIN - 1])(
    'rejects invalid value %s',
    (value) => {
      expectAllocationError(
        () => createBasisPoints(value),
        'INVALID_BASIS_POINTS',
      );
    },
  );

  test.each(['1', null, undefined, true])(
    'does not coerce runtime input %j',
    (value) => {
      expectAllocationError(
        () => createBasisPoints(value as unknown as number),
        'INVALID_BASIS_POINTS',
      );
    },
  );

  test('uses static error messages without supplied values', () => {
    let first: unknown;
    let second: unknown;
    try {
      createBasisPoints(-123);
    } catch (error) {
      first = error;
    }
    try {
      createBasisPoints(12_345);
    } catch (error) {
      second = error;
    }
    expect(first).toBeInstanceOf(AllocationError);
    expect(second).toBeInstanceOf(AllocationError);
    expect((first as AllocationError).message).toBe(
      (second as AllocationError).message,
    );
    expect((first as AllocationError).message).not.toMatch(/123|345/);
  });
});

describe('share validation', () => {
  test('rejects a forged non-array container', () => {
    expectAllocationError(
      () =>
        allocateMoney(createMoney(1, 'USD'), {
          0: 10_000,
          length: 1,
        } as unknown as BasisPoints[]),
      'INVALID_ALLOCATION_SHARES',
    );
  });

  test('rejects an empty allocation', () => {
    expectAllocationError(
      () => allocateMoney(createMoney(1, 'USD'), []),
      'EMPTY_ALLOCATION',
    );
  });

  test('rejects a sparse array', () => {
    const sparse = new Array<BasisPoints>(2);
    sparse[1] = createBasisPoints(10_000);
    expectAllocationError(
      () => allocateMoney(createMoney(1, 'USD'), sparse),
      'INVALID_ALLOCATION_SHARES',
    );
  });

  test.each([
    { shares: [4_999, 5_000], expectedTotal: 9_999 },
    { shares: [5_001, 5_000], expectedTotal: 10_001 },
    { shares: [0, 0], expectedTotal: 0 },
  ])('rejects shares totaling $expectedTotal', ({ shares }) => {
    expectAllocationError(
      () => allocateMoney(createMoney(1, 'USD'), bps(...shares)),
      'INVALID_ALLOCATION_TOTAL',
    );
  });

  test.each([-1, 10_001, 0.5, NaN, Infinity, MAX + 1])(
    'rejects forged share %s',
    (value) => {
      const shares = [value as BasisPoints, createBasisPoints(10_000)];
      expectAllocationError(
        () => allocateMoney(createMoney(1, 'USD'), shares),
        'INVALID_BASIS_POINTS',
      );
    },
  );
});

describe('exact largest-remainder allocation', () => {
  test.each([
    [100, [5_000, 5_000], [50, 50]],
    [1, [5_000, 5_000], [1, 0]],
    [100, [3_333, 3_333, 3_334], [33, 33, 34]],
    [2, [3_333, 3_333, 3_334], [1, 0, 1]],
  ])('allocates %s across %p as %p', (total, shares, expected) => {
    expect(
      amounts(allocateMoney(createMoney(total, 'USD'), bps(...shares))),
    ).toEqual(expected);
  });

  test('resolves equal remainders by original input order', () => {
    expect(
      amounts(allocateMoney(createMoney(2, 'USD'), bps(2_500, 2_500, 5_000))),
    ).toEqual([1, 0, 1]);
  });

  test('ranks unequal remainders without changing output order', () => {
    expect(
      amounts(allocateMoney(createMoney(1, 'USD'), bps(2_000, 7_000, 1_000))),
    ).toEqual([0, 1, 0]);
  });

  test('preserves zero-share entries and array length', () => {
    const result = allocateMoney(createMoney(123, 'UYU'), bps(0, 0, 10_000));
    expect(amounts(result)).toEqual([0, 0, 123]);
    expect(result).toHaveLength(3);
  });

  test.each([123, -123, 0, MAX, MIN])(
    'allocates a single full share for %s',
    (total) => {
      expect(allocateMoney(createMoney(total, 'EUR'), bps(10_000))).toEqual([
        createMoney(total, 'EUR'),
      ]);
    },
  );
});

describe('signed allocation', () => {
  test.each([
    [-1, [5_000, 5_000], [-1, 0]],
    [-100, [3_333, 3_333, 3_334], [-33, -33, -34]],
    [0, [3_333, 3_333, 3_334], [0, 0, 0]],
  ])('allocates %s as %p', (total, shares, expected) => {
    expect(
      amounts(allocateMoney(createMoney(total, 'USD'), bps(...shares))),
    ).toEqual(expected);
  });

  test.each([
    [1, [5_000, 5_000]],
    [2, [3_333, 3_333, 3_334]],
    [100, [3_333, 3_333, 3_334]],
    [9_999, [1, 4_999, 5_000]],
    [MAX, [3_333, 3_333, 3_334]],
  ])('is sign-symmetric for %s and %p', (total, shares) => {
    const positive = allocateMoney(createMoney(total, 'USD'), bps(...shares));
    const negative = allocateMoney(createMoney(-total, 'USD'), bps(...shares));
    expect(amounts(negative)).toEqual(
      amounts(positive).map((amount) => (amount === 0 ? 0 : -amount)),
    );
  });
});

describe('safe-integer boundaries', () => {
  test('allocates MAX_SAFE_INTEGER exactly without unsafe numerator multiplication', () => {
    const result = allocateMoney(
      createMoney(MAX, 'USD'),
      bps(3_333, 3_333, 3_334),
    );
    expect(amounts(result)).toEqual([
      3_002_099_511_605_172, 3_002_099_511_605_172, 3_003_000_231_530_647,
    ]);
    expect(result.reduce((sum, value) => sum + value.amountMinor, 0)).toBe(MAX);
  });

  test('allocates MIN_SAFE_INTEGER exactly and sums back to the source', () => {
    const result = allocateMoney(
      createMoney(MIN, 'USD'),
      bps(3_333, 3_333, 3_334),
    );
    expect(amounts(result)).toEqual([
      -3_002_099_511_605_172, -3_002_099_511_605_172, -3_003_000_231_530_647,
    ]);
    expect(result.reduce((sum, value) => sum + value.amountMinor, 0)).toBe(MIN);
  });
});

describe('runtime Money validation', () => {
  test.each([
    [{ amountMinor: 1.5, currency: 'USD' }, 'INVALID_AMOUNT'],
    [{ amountMinor: MAX + 1, currency: 'USD' }, 'INVALID_AMOUNT'],
    [{ amountMinor: 1, currency: 'usd' }, 'INVALID_CURRENCY'],
    [null, 'INVALID_AMOUNT'],
  ] as const)('rejects forged Money %j through MoneyError', (raw, code) => {
    expect(() => allocateMoney(raw as unknown as Money, bps(10_000))).toThrow(
      expect.objectContaining({ name: 'MoneyError', code }),
    );
    expect(() => allocateMoney(raw as unknown as Money, bps(10_000))).toThrow(
      MoneyError,
    );
  });
});

describe('allocation invariants', () => {
  const shareVectors = [
    [10_000],
    [5_000, 5_000],
    [3_333, 3_333, 3_334],
    [0, 1, 9_999],
    [1, 1, 1, 9_997],
  ];

  test('preserves sum, currency, length, and order across representative totals', () => {
    for (let total = -100; total <= 100; total += 1) {
      for (const shares of shareVectors) {
        const validatedShares = bps(...shares);
        const result = allocateMoney(
          createMoney(total, 'UYU'),
          validatedShares,
        );
        expect(result.reduce((sum, value) => sum + value.amountMinor, 0)).toBe(
          total,
        );
        expect(result.every((value) => value.currency === 'UYU')).toBe(true);
        expect(result).toHaveLength(validatedShares.length);
      }
    }
  });

  test('does not mutate inputs and freezes outputs', () => {
    const total = createMoney(101, 'USD');
    const shares = bps(3_333, 3_333, 3_334);
    const originalShares = [...shares];
    const originalTotal = { ...total };
    const result = allocateMoney(total, shares);

    expect(shares).toEqual(originalShares);
    expect(total).toEqual(originalTotal);
    expect(Object.isFrozen(shares)).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(result, '0', createMoney(0, 'USD'))).toBe(false);
    expect(amounts(result)).toEqual([34, 33, 34]);
  });
});
