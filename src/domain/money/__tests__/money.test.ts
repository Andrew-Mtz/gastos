import {
  addMoney,
  compareMoney,
  createCurrencyCode,
  createMoney,
  MoneyError,
  moneyEquals,
  negateMoney,
  subtractMoney,
  type Money,
  type MoneyErrorCode,
} from '../money';

const MAX = Number.MAX_SAFE_INTEGER;
const MIN = Number.MIN_SAFE_INTEGER;

function expectMoneyError(action: () => unknown, code: MoneyErrorCode): void {
  expect(action).toThrow(MoneyError);
  expect(action).toThrow(expect.objectContaining({ name: 'MoneyError', code }));
}

describe('construction', () => {
  test.each([1099, 0, -1099, MAX, MIN])('accepts %s minor units', (amount) => {
    expect(createMoney(amount, 'USD')).toEqual({
      amountMinor: amount,
      currency: 'USD',
    });
  });

  test('normalizes negative zero', () => {
    expect(Object.is(createMoney(-0, 'UYU').amountMinor, 0)).toBe(true);
  });

  test.each([0.5, -0.5, NaN, Infinity, -Infinity, MAX + 1, MIN - 1])(
    'rejects invalid amount %s',
    (amount) => {
      expectMoneyError(() => createMoney(amount, 'USD'), 'INVALID_AMOUNT');
    },
  );

  test.each(['1099', null, undefined, true])(
    'does not coerce runtime input %s',
    (amount) => {
      expectMoneyError(
        () => createMoney(amount as unknown as number, 'USD'),
        'INVALID_AMOUNT',
      );
    },
  );
});

describe('currency shape', () => {
  test.each(['USD', 'UYU', 'EUR', 'ZZZ'])(
    'accepts %s without a registry',
    (code) => {
      expect(createCurrencyCode(code)).toBe(code);
      expect(createMoney(1, code).currency).toBe(code);
    },
  );

  test.each([
    'usd',
    'Usd',
    '',
    'US',
    'USDD',
    '12A',
    ' USD',
    'USD ',
    'ÜSD',
    'ＵＳＤ',
    '   ',
    'USD\n',
    'USD\r\n',
    '\tUSD',
    'U\nD',
  ])('rejects %j without normalization', (code) => {
    expectMoneyError(() => createCurrencyCode(code), 'INVALID_CURRENCY');
    expectMoneyError(() => createMoney(1, code), 'INVALID_CURRENCY');
  });

  test.each([null, undefined, 123, ['USD']])(
    'rejects non-string %j',
    (code) => {
      expectMoneyError(
        () => createCurrencyCode(code as unknown as string),
        'INVALID_CURRENCY',
      );
    },
  );
});

describe('addition', () => {
  test.each([
    [100, 25, 125],
    [100, -25, 75],
    [-100, -25, -125],
    [0, 100, 100],
    [100, 0, 100],
    [100, -100, 0],
    [MAX - 1, 1, MAX],
    [MIN + 1, -1, MIN],
    [MAX, MIN, 0],
  ])('%s + %s = %s', (a, b, expected) => {
    expect(addMoney(createMoney(a, 'UYU'), createMoney(b, 'UYU'))).toEqual(
      createMoney(expected, 'UYU'),
    );
  });

  test.each([
    [MAX, 1],
    [MIN, -1],
    [MAX, MAX],
    [MIN, MIN],
  ])('rejects overflow %s + %s', (a, b) => {
    expectMoneyError(
      () => addMoney(createMoney(a, 'USD'), createMoney(b, 'USD')),
      'ARITHMETIC_OVERFLOW',
    );
  });
});

describe('subtraction', () => {
  test.each([
    [100, 25, 75],
    [100, 100, 0],
    [25, 100, -75],
    [100, -25, 125],
    [-100, 25, -125],
    [-100, -25, -75],
    [0, 100, -100],
    [100, 0, 100],
    [MAX - 1, -1, MAX],
    [MIN + 1, 1, MIN],
    [MIN, MIN, 0],
  ])('%s - %s = %s', (a, b, expected) => {
    expect(subtractMoney(createMoney(a, 'EUR'), createMoney(b, 'EUR'))).toEqual(
      createMoney(expected, 'EUR'),
    );
  });

  test.each([
    [MAX, -1],
    [MIN, 1],
    [MAX, MIN],
    [MIN, MAX],
  ])('rejects overflow %s - %s', (a, b) => {
    expectMoneyError(
      () => subtractMoney(createMoney(a, 'USD'), createMoney(b, 'USD')),
      'ARITHMETIC_OVERFLOW',
    );
  });
});

describe('negation', () => {
  test.each([
    [100, -100],
    [-100, 100],
    [0, 0],
    [MAX, MIN],
    [MIN, MAX],
  ])('negates %s to %s', (amount, expected) => {
    expect(negateMoney(createMoney(amount, 'EUR'))).toEqual(
      createMoney(expected, 'EUR'),
    );
  });

  test('normalizes a structurally valid negative-zero operand', () => {
    const value = { amountMinor: -0, currency: 'USD' } as Money;
    expect(Object.is(negateMoney(value).amountMinor, 0)).toBe(true);
  });

  test.each([MIN, -1, 0, 1, MAX])('double negation preserves %s', (amount) => {
    const value = createMoney(amount, 'UYU');
    expect(negateMoney(negateMoney(value))).toEqual(value);
  });
});

describe('equality and ordering', () => {
  test.each([
    [100, 'USD', 100, 'USD', true],
    [100, 'USD', 101, 'USD', false],
    [100, 'USD', 100, 'UYU', false],
    [0, 'USD', 0, 'UYU', false],
    [-100, 'EUR', -100, 'EUR', true],
  ] as const)('equality %s %s / %s %s', (a, ac, b, bc, expected) => {
    expect(moneyEquals(createMoney(a, ac), createMoney(b, bc))).toBe(expected);
  });

  test.each([
    [1, 2, -1],
    [1, 1, 0],
    [2, 1, 1],
    [-1, 0, -1],
    [-1, -2, 1],
    [MIN, MAX, -1],
    [MAX, MIN, 1],
  ])('orders %s and %s', (a, b, expected) => {
    expect(compareMoney(createMoney(a, 'USD'), createMoney(b, 'USD'))).toBe(
      expected,
    );
  });
});

test.each([addMoney, subtractMoney, compareMoney])(
  '%p rejects currency mismatch, including zero',
  (operation) => {
    expectMoneyError(
      () => operation(createMoney(0, 'USD'), createMoney(0, 'UYU')),
      'CURRENCY_MISMATCH',
    );
  },
);

describe.each([addMoney, subtractMoney, moneyEquals, compareMoney])(
  '%p operand validation',
  (operation) => {
    test.each([
      [{ amountMinor: 0.5, currency: 'USD' }, 'INVALID_AMOUNT'],
      [{ amountMinor: MAX + 1, currency: 'USD' }, 'INVALID_AMOUNT'],
      [{ amountMinor: NaN, currency: 'USD' }, 'INVALID_AMOUNT'],
      [{ amountMinor: 1, currency: 'usd' }, 'INVALID_CURRENCY'],
      [{ amountMinor: 1 }, 'INVALID_CURRENCY'],
      [null, 'INVALID_AMOUNT'],
    ] as const)('rejects forged %j in either position', (raw, code) => {
      const forged = raw as unknown as Money;
      const valid = createMoney(0, 'USD');
      expectMoneyError(() => operation(forged, valid), code);
      expectMoneyError(() => operation(valid, forged), code);
    });
  },
);

test.each([addMoney, subtractMoney])(
  '%p rejects invalid operands even when they cancel into a safe result',
  (operation) => {
    const a = { amountMinor: 0.5, currency: 'USD' } as Money;
    const b = { amountMinor: -0.5, currency: 'USD' } as Money;
    expectMoneyError(() => operation(a, b), 'INVALID_AMOUNT');
  },
);

test.each([
  [{ amountMinor: Infinity, currency: 'USD' }, 'INVALID_AMOUNT'],
  [{ amountMinor: MIN - 1, currency: 'USD' }, 'INVALID_AMOUNT'],
  [{ amountMinor: 1, currency: 'usd' }, 'INVALID_CURRENCY'],
  [undefined, 'INVALID_AMOUNT'],
] as const)('negation rejects forged %j', (raw, code) => {
  expectMoneyError(() => negateMoney(raw as unknown as Money), code);
});

test('Money and arithmetic results resist runtime mutation without changing operands', () => {
  const a = createMoney(100, 'USD');
  const b = createMoney(25, 'USD');
  const values = [a, b, addMoney(a, b), subtractMoney(a, b), negateMoney(a)];
  for (const value of values) {
    const before = { ...value };
    expect(Reflect.set(value, 'amountMinor', 999)).toBe(false);
    expect(Reflect.set(value, 'currency', 'EUR')).toBe(false);
    expect(value).toEqual(before);
  }
  expect(a).toEqual({ amountMinor: 100, currency: 'USD' });
  expect(b).toEqual({ amountMinor: 25, currency: 'USD' });
});

test('JSON contains only data and reconstruction validates decoded fields', () => {
  const value = createMoney(1099, 'USD');
  const json = JSON.stringify(value);
  expect(json).toBe('{"amountMinor":1099,"currency":"USD"}');
  const decoded: { amountMinor: number; currency: string } = JSON.parse(json);
  const reconstructed = createMoney(decoded.amountMinor, decoded.currency);
  expect(reconstructed).toEqual(value);
  expect(Reflect.set(reconstructed, 'amountMinor', 1)).toBe(false);
  expectMoneyError(
    () => createMoney(decoded.amountMinor + 0.5, decoded.currency),
    'INVALID_AMOUNT',
  );
});

test('error messages are static and omit supplied amounts', () => {
  let first: unknown;
  let second: unknown;
  try {
    createMoney(1234.5, 'USD');
  } catch (error) {
    first = error;
  }
  try {
    createMoney(6789.5, 'USD');
  } catch (error) {
    second = error;
  }
  expect(first).toBeInstanceOf(MoneyError);
  expect(second).toBeInstanceOf(MoneyError);
  if (!(first instanceof MoneyError) || !(second instanceof MoneyError)) {
    throw new Error('Expected MoneyError');
  }
  expect(first.message).toBe(second.message);
  expect(first.message).not.toMatch(/1234|6789/);
});
