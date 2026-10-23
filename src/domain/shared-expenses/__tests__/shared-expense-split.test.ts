import { createHouseholdSplit } from '../../household/default-split';
import { createMoney, type Money } from '../../money/money';
import {
  calculateSharedExpenseSplit,
  type SharedExpenseResponsibility,
} from '../shared-expense-split';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const D = 'dddddddd-0000-4000-8000-000000000004';
const E = 'eeeeeeee-0000-4000-8000-000000000005';
const F = 'ffffffff-0000-4000-8000-000000000006';
const MAX = Number.MAX_SAFE_INTEGER;
const ids = [A, B, C, D, E, F];
type Shares = Parameters<typeof calculateSharedExpenseSplit>[1];
const shares = (...values: number[]) =>
  values.map((basisPoints, index) => ({ memberId: ids[index], basisPoints }));
const amounts = (result: readonly SharedExpenseResponsibility[]) =>
  result.map((entry) => entry.responsibilityAmount.amountMinor);

describe('shared expense responsibility', () => {
  test('calculates the product 70/30 example in explicit minor units', () => {
    expect(
      calculateSharedExpenseSplit(
        createMoney(80000, 'UYU'),
        shares(7000, 3000),
      ),
    ).toEqual([
      {
        memberId: A,
        basisPoints: 7000,
        responsibilityAmount: createMoney(56000, 'UYU'),
      },
      {
        memberId: B,
        basisPoints: 3000,
        responsibilityAmount: createMoney(24000, 'UYU'),
      },
    ]);
  });

  test.each([
    [1, [5000, 5000], [1, 0]],
    [2, [2500, 2500, 5000], [1, 0, 1]],
    [2, [3333, 3333, 3334], [1, 0, 1]],
    [100, [3333, 3333, 3334], [33, 33, 34]],
    [101, [3333, 3333, 3334], [34, 33, 34]],
    [1, [2000, 7000, 1000], [0, 1, 0]],
    [2, [2500, 2500, 2500, 2500], [1, 1, 0, 0]],
    [123, [0, 10000, 0], [0, 123, 0]],
    [MAX, [10000], [MAX]],
    [MAX, [5000, 5000], [4503599627370496, 4503599627370495]],
    [
      MAX,
      [3333, 3333, 3334],
      [3002099511605172, 3002099511605172, 3003000231530647],
    ],
  ])('allocates %s with %p as %p', (total, percentages, expected) => {
    const result = calculateSharedExpenseSplit(
      createMoney(total, 'USD'),
      shares(...percentages),
    );
    expect(amounts(result)).toEqual(expected);
    expect(amounts(result).reduce((sum, amount) => sum + amount, 0)).toBe(
      total,
    );
  });

  test('composes FIN-205 shares without treating the payer as responsibility', () => {
    const template = createHouseholdSplit([B, A], shares(7000, 3000));
    const result = calculateSharedExpenseSplit(
      createMoney(1000, 'UYU'),
      template,
    );
    expect(amounts(result)).toEqual([700, 300]);
    // There is deliberately no payer, household, role, cash or budget input/output.
    expect(Object.keys(result[0]).sort()).toEqual([
      'basisPoints',
      'memberId',
      'responsibilityAmount',
    ]);
  });

  test('normalizes UUID case before ordering, tie-breaking and returning identity', () => {
    const result = calculateSharedExpenseSplit(createMoney(1, 'USD'), [
      { memberId: B.toUpperCase(), basisPoints: 5000 },
      { memberId: A.toUpperCase(), basisPoints: 5000 },
    ]);
    expect(result.map((share) => share.memberId)).toEqual([A, B]);
    expect(amounts(result)).toEqual([1, 0]);
  });

  test('ignores locale sorting in the template validator when assigning remainders', () => {
    const localeCompare = jest
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(function (this: string, other: string) {
        return this < other ? 1 : this > other ? -1 : 0;
      });
    try {
      const result = calculateSharedExpenseSplit(
        createMoney(1, 'USD'),
        shares(5000, 5000),
      );
      expect(result.map((share) => share.memberId)).toEqual([A, B]);
      expect(amounts(result)).toEqual([1, 0]);
    } finally {
      localeCompare.mockRestore();
    }
  });

  test.each(['UYU', 'USD', 'EUR', 'JPY', 'ZZZ'])(
    'preserves explicit %s denomination without conversion or a product-support claim',
    (currency) => {
      const result = calculateSharedExpenseSplit(
        createMoney(101, currency),
        shares(7000, 3000),
      );
      expect(amounts(result)).toEqual([71, 30]);
      expect(
        result.every(
          (share) => share.responsibilityAmount.currency === currency,
        ),
      ).toBe(true);
    },
  );

  test('copies inputs and freezes every output without changing a template or earlier result', () => {
    const total = { amountMinor: 101, currency: 'USD' } as Money;
    const source = shares(7000, 3000).reverse();
    const original = source.map((share) => ({ ...share }));
    const first = calculateSharedExpenseSplit(total, source);
    expect(source).toEqual(original);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(total)).toBe(false);
    source[0].basisPoints = 5000;
    source[1].basisPoints = 5000;
    const second = calculateSharedExpenseSplit(total, source);
    expect(amounts(first)).toEqual([71, 30]);
    expect(amounts(second)).toEqual([51, 50]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every(Object.isFrozen)).toBe(true);
    expect(
      first.every((share) => Object.isFrozen(share.responsibilityAmount)),
    ).toBe(true);
    expect(Reflect.set(first[0], 'memberId', B)).toBe(false);
    expect(Reflect.set(first[0].responsibilityAmount, 'amountMinor', 999)).toBe(
      false,
    );
    expect(
      calculateSharedExpenseSplit(
        total,
        Object.freeze(source.map((share) => Object.freeze(share))),
      ),
    ).toEqual(second);
  });
});

describe('invalid and forged input', () => {
  test.each([0, -0, -1, Number.MIN_SAFE_INTEGER])(
    'rejects nonpositive expense total %s even though generic Money supports it',
    (total) => {
      expect(() =>
        calculateSharedExpenseSplit(createMoney(total, 'USD'), shares(10000)),
      ).toThrow('Shared expense amount must be positive.');
    },
  );

  test.each([
    NaN,
    Infinity,
    -Infinity,
    0.5,
    MAX + 1,
    Number.MIN_SAFE_INTEGER - 1,
    '100',
    null,
    undefined,
    true,
  ])('rejects forged minor amount %p without coercion', (amountMinor) => {
    expect(() =>
      calculateSharedExpenseSplit(
        { amountMinor, currency: 'USD' } as Money,
        shares(10000),
      ),
    ).toThrow(
      expect.objectContaining({ name: 'MoneyError', code: 'INVALID_AMOUNT' }),
    );
  });

  test.each([
    'usd',
    ' USD',
    'USD ',
    '',
    'US',
    'USDD',
    'US1',
    'ÜSD',
    'USD\n',
    null,
    undefined,
    123,
  ])(
    'rejects forged currency %j rather than defaulting or converting',
    (currency) => {
      expect(() =>
        calculateSharedExpenseSplit(
          { amountMinor: 100, currency } as Money,
          shares(10000),
        ),
      ).toThrow(
        expect.objectContaining({
          name: 'MoneyError',
          code: 'INVALID_CURRENCY',
        }),
      );
    },
  );

  test.each([null, undefined, 1, '100', true, [], {}])(
    'rejects malformed total %j',
    (total) => {
      expect(() =>
        calculateSharedExpenseSplit(total as Money, shares(10000)),
      ).toThrow();
    },
  );

  test.each([
    null,
    undefined,
    1,
    '10000',
    {},
    { 0: { memberId: A, basisPoints: 10000 }, length: 1 },
  ])('rejects non-array shares %j', (value) => {
    expect(() =>
      calculateSharedExpenseSplit(
        createMoney(1, 'USD'),
        value as unknown as Shares,
      ),
    ).toThrow('Shared expense shares require a dense array.');
  });

  test.each([null, undefined, 1, true, A, {}, []])(
    'rejects malformed share %j',
    (value) => {
      expect(() =>
        calculateSharedExpenseSplit(createMoney(1, 'USD'), [value] as Shares),
      ).toThrow();
    },
  );

  test.each([
    '',
    'member-a',
    ' ',
    ` ${A}`,
    `${A} `,
    A.replaceAll('-', ''),
    `${A}\n`,
    null,
    undefined,
    1,
    true,
  ])('rejects invalid membership identity %j', (memberId) => {
    expect(() =>
      calculateSharedExpenseSplit(createMoney(1, 'USD'), [
        { memberId, basisPoints: 10000 },
      ] as Shares),
    ).toThrow('Shared expense member identifiers must be UUIDs.');
  });

  test.each([
    NaN,
    Infinity,
    -Infinity,
    -1,
    10001,
    0.5,
    MAX + 1,
    '10000',
    null,
    undefined,
    true,
  ])('revalidates forged basis points %p', (basisPoints) => {
    expect(() =>
      calculateSharedExpenseSplit(createMoney(1, 'USD'), [
        { memberId: A, basisPoints },
      ] as Shares),
    ).toThrow(
      expect.objectContaining({
        name: 'AllocationError',
        code: 'INVALID_BASIS_POINTS',
      }),
    );
  });

  test.each(
    [[], [0], [0, 0], [9999], [5000, 4999], [5001, 5000]].map((values) => ({
      values,
    })),
  )(
    'rejects missing or incomplete percentages $values without inventing a default',
    ({ values }) => {
      expect(() =>
        calculateSharedExpenseSplit(createMoney(1, 'USD'), shares(...values)),
      ).toThrow();
    },
  );

  test.each([A, A.toUpperCase()])(
    'rejects duplicate canonical identity %s',
    (duplicate) => {
      expect(() =>
        calculateSharedExpenseSplit(createMoney(1, 'USD'), [
          { memberId: A, basisPoints: 5000 },
          { memberId: duplicate, basisPoints: 5000 },
        ]),
      ).toThrow('Every roster member needs one explicit percentage.');
    },
  );

  test('rejects holes even when a missing entry has an inherited value', () => {
    const value = shares(5000, 0, 5000);
    delete value[1];
    expect(() =>
      calculateSharedExpenseSplit(createMoney(1, 'USD'), value),
    ).toThrow();
    const prototype = Object.create(Array.prototype);
    prototype[1] = { memberId: B, basisPoints: 0 };
    Object.setPrototypeOf(value, prototype);
    expect(() =>
      calculateSharedExpenseSplit(createMoney(1, 'USD'), value),
    ).toThrow();
  });

  test('calculates structurally valid synthetic identities without claiming household authorization', () => {
    // The pure function cannot establish whether either UUID exists, is active,
    // belongs to a household, or maps to a particular Profile. FIN-207 must do so.
    const result = calculateSharedExpenseSplit(
      createMoney(1, 'USD'),
      shares(5000, 5000),
    );
    expect(amounts(result)).toEqual([1, 0]);
  });
});

describe('deterministic allocation properties', () => {
  test('conserves safe minor units, identities and currency across totals, vectors and permutations', () => {
    const totals = [
      1,
      2,
      3,
      7,
      99,
      100,
      101,
      9999,
      10000,
      10001,
      2 ** 32 - 1,
      2 ** 32,
      MAX - 1,
      MAX,
    ];
    const vectors = [
      [10000],
      [0, 10000],
      [5000, 5000],
      [3333, 3333, 3334],
      [0, 1, 4999, 5000],
      [0, 1, 999, 1000, 3000, 5000],
    ];
    for (const total of totals) {
      for (const vector of vectors) {
        const input = shares(...vector);
        const result = calculateSharedExpenseSplit(
          createMoney(total, 'UYU'),
          input,
        );
        expect(amounts(result).reduce((sum, amount) => sum + amount, 0)).toBe(
          total,
        );
        expect(result.map((share) => share.memberId)).toEqual(
          input.map((share) => share.memberId),
        );
        expect(result.map((share) => share.basisPoints)).toEqual(vector);
        expect(
          result.every(
            (share) =>
              Number.isSafeInteger(share.responsibilityAmount.amountMinor) &&
              share.responsibilityAmount.amountMinor >= 0 &&
              share.responsibilityAmount.currency === 'UYU',
          ),
        ).toBe(true);
        input.forEach((share, index) => {
          if (share.basisPoints === 0) expect(amounts(result)[index]).toBe(0);
        });
        expect(
          calculateSharedExpenseSplit(
            createMoney(total, 'UYU'),
            [...input].reverse(),
          ),
        ).toEqual(result);
        expect(
          calculateSharedExpenseSplit(createMoney(total, 'UYU'), [
            ...input.slice(1),
            input[0],
          ]),
        ).toEqual(result);
      }
    }
  });

  test('checks every possible two-member basis-point distribution against exact small numerators', () => {
    // At this small total every numerator is a safe integer. The independent
    // two-part oracle awards a tied remainder to canonical member A.
    for (let basisPoints = 0; basisPoints <= 10000; basisPoints += 1) {
      const numerator = 101 * basisPoints;
      const expectedA =
        Math.floor(numerator / 10000) + (numerator % 10000 >= 5000 ? 1 : 0);
      const result = calculateSharedExpenseSplit(
        createMoney(101, 'EUR'),
        shares(basisPoints, 10000 - basisPoints).reverse(),
      );
      expect(amounts(result)).toEqual([expectedA, 101 - expectedA]);
    }
  });
});
