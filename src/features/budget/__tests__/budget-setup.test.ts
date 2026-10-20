import { createMoney } from '../../../domain/money/money';
import {
  currencyDigits,
  currentMonth,
  decimalText,
  formatMoney,
  parseDecimal,
  setupPreview,
  strategies,
  validateSetupForm,
} from '../budget-setup';
import { buckets } from './fixtures';
const form = {
  expectedIncome: '1500.01',
  NEEDS: '50',
  LEISURE: '30',
  SAVINGS: '20',
};
test.each([
  ['10.99', 2, 1099],
  ['10,99', 2, 1099],
  ['0', 2, 0],
  ['1.2', 3, 1200],
  ['99', 0, 99],
  ['90071992547409.91', 2, Number.MAX_SAFE_INTEGER],
] as const)('parses %s exactly', (text, digits, result) =>
  expect(parseDecimal(text, digits)).toBe(result),
);
test.each([
  '1e3',
  '-1',
  '+1',
  '1,000.20',
  '1.001',
  'NaN',
  '',
  '0x10',
  '90071992547409.92',
])('rejects ambiguous or unsafe %s', (text) =>
  expect(parseDecimal(text, 2)).toBeNull(),
);
test('currency exponents follow Intl, not an assumed two decimals', () => {
  expect(currencyDigits('JPY')).toBe(0);
  expect(currencyDigits('KWD')).toBe(3);
  expect(currencyDigits('UYU')).toBe(2);
  expect(
    validateSetupForm('JPY').safeParse({ ...form, expectedIncome: '10.99' })
      .success,
  ).toBe(false);
});
test.each(Object.values(strategies))(
  '$label uses its documented shares',
  (strategy) => {
    const preview = setupPreview('USD', buckets, {
      ...form,
      NEEDS: strategy.shares[0],
      LEISURE: strategy.shares[1],
      SAVINGS: strategy.shares[2],
    });
    expect(
      preview.allocations.reduce(
        (sum, item) => sum + item.plannedAmount!.amountMinor,
        0,
      ),
    ).toBe(150001);
    expect(
      preview.allocations.map((item) => item.percentageBasisPoints),
    ).toEqual(strategy.shares.map((share) => parseDecimal(share, 2)));
  },
);
test('custom decimals total exactly and rounding is stable with shuffled buckets', () => {
  const custom = {
    ...form,
    expectedIncome: '0.02',
    NEEDS: '33.33',
    LEISURE: '33.33',
    SAVINGS: '33.34',
  };
  expect(setupPreview('USD', buckets, custom)).toEqual(
    setupPreview('USD', [...buckets].reverse(), custom),
  );
  expect(
    setupPreview('USD', buckets, custom).allocations.map(
      (item) => item.plannedAmount!.amountMinor,
    ),
  ).toEqual([1, 0, 1]);
});
test('unknown income is not zero or actual cash', () => {
  expect(
    setupPreview('USD', buckets, {
      ...form,
      expectedIncome: '',
    }).allocations.every((item) => item.plannedAmount === null),
  ).toBe(true);
  expect(
    setupPreview('USD', buckets, {
      ...form,
      expectedIncome: '0',
    }).allocations.every((item) => item.plannedAmount?.amountMinor === 0),
  ).toBe(true);
});
test.each([
  { ...form, NEEDS: '49.99' },
  { ...form, SAVINGS: '-1' },
  { ...form, NEEDS: '101' },
  { ...form, NEEDS: '50.001' },
])('invalid shares cannot preview', (input) =>
  expect(() => setupPreview('USD', buckets, input)).toThrow(),
);
test('period selection follows financial timezone at month boundaries', () => {
  const instant = new Date('2026-11-01T01:00:00Z');
  expect(currentMonth('America/Montevideo', instant)).toBe('2026-10-01');
  expect(currentMonth('UTC', instant)).toBe('2026-11-01');
});
test('money formatting preserves the last minor unit at the safe-integer limit', () => {
  expect(formatMoney(createMoney(Number.MAX_SAFE_INTEGER, 'USD'))).toContain(
    ',91',
  );
  expect(decimalText(Number.MAX_SAFE_INTEGER, 2)).toBe('90071992547409.91');
});

describe.each([true, false])(
  'NumberFormat.formatToParts available: %s',
  (available) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Intl.NumberFormat.prototype,
      'formatToParts',
    )!;
    beforeAll(() => {
      if (!available)
        Object.defineProperty(Intl.NumberFormat.prototype, 'formatToParts', {
          ...descriptor,
          value: undefined,
        });
    });
    afterAll(() => {
      Object.defineProperty(
        Intl.NumberFormat.prototype,
        'formatToParts',
        descriptor,
      );
    });

    test.each([
      [0, 'USD', 'USD\u00a00,00'],
      [1, 'USD', 'USD\u00a00,01'],
      [-1, 'USD', '-USD\u00a00,01'],
      [123456, 'UYU', 'UYU\u00a01.234,56'],
      [-123456, 'USD', '-USD\u00a01.234,56'],
      [0, 'JPY', 'JPY\u00a00'],
      [1, 'JPY', 'JPY\u00a01'],
      [-1234, 'JPY', '-JPY\u00a01.234'],
      [0, 'KWD', 'KWD\u00a00,000'],
      [1, 'KWD', 'KWD\u00a00,001'],
      [-1, 'KWD', '-KWD\u00a00,001'],
      [1234567, 'KWD', 'KWD\u00a01.234,567'],
      [Number.MAX_SAFE_INTEGER, 'USD', 'USD\u00a090.071.992.547.409,91'],
      [-Number.MAX_SAFE_INTEGER, 'USD', '-USD\u00a090.071.992.547.409,91'],
      [Number.MAX_SAFE_INTEGER, 'JPY', 'JPY\u00a09.007.199.254.740.991'],
      [-Number.MAX_SAFE_INTEGER, 'JPY', '-JPY\u00a09.007.199.254.740.991'],
      [Number.MAX_SAFE_INTEGER, 'KWD', 'KWD\u00a09.007.199.254.740,991'],
      [-Number.MAX_SAFE_INTEGER, 'KWD', '-KWD\u00a09.007.199.254.740,991'],
    ] as const)(
      'formats %s minor units of %s exactly',
      (amount, currency, expected) => {
        expect(formatMoney(createMoney(amount, currency))).toBe(expected);
      },
    );
  },
);
