import { createRecurringExpense, recurringDueDate } from '../recurring-expense';

const input = {
  id: 'f1170000-0000-4000-8000-000000000001',
  ownerProfileId: 'f0050000-0000-4000-8000-000000000001',
  scope: 'PERSONAL',
  name: 'Electricity',
  categoryId: 'f1070000-0000-4000-8000-000000000001',
  frequency: 'MONTHLY',
  amountMode: 'VARIABLE',
  defaultAmountMinor: null,
  currency: 'UYU',
  dueDay: 31,
  activeFrom: '2026-01-01',
  activeUntil: null,
  stoppedFrom: null,
};

test.each([null, 0, 1, Number.MAX_SAFE_INTEGER])(
  'variable estimate %s remains planning data',
  (defaultAmountMinor) => {
    const result = createRecurringExpense({ ...input, defaultAmountMinor });
    expect(result.defaultAmountMinor).toBe(defaultAmountMinor);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('transactionId');
  },
);
test.each([1, Number.MAX_SAFE_INTEGER])(
  'fixed amount %s is exact',
  (defaultAmountMinor) => {
    expect(
      createRecurringExpense({
        ...input,
        amountMode: 'FIXED',
        defaultAmountMinor,
      }).defaultAmountMinor,
    ).toBe(defaultAmountMinor);
  },
);
test.each([
  { amountMode: 'FIXED' },
  { amountMode: 'FIXED', defaultAmountMinor: 0 },
  { defaultAmountMinor: -1 },
  { defaultAmountMinor: 0.5 },
  { defaultAmountMinor: Number.MAX_SAFE_INTEGER + 1 },
  { defaultAmountMinor: NaN },
  { defaultAmountMinor: Infinity },
  { defaultAmountMinor: '100' },
  { scope: 'HOUSEHOLD' },
  { frequency: 'WEEKLY' },
  { amountMode: 'OTHER' },
  { name: '' },
  { name: ' ' },
  { name: '\t' },
  { name: ' Rent' },
  { name: 'a'.repeat(121) },
  { id: 'bad' },
  { ownerProfileId: null },
  { categoryId: null },
  { currency: 'usd' },
  { currency: 'USD ' },
  { dueDay: 0 },
  { dueDay: 32 },
  { dueDay: 1.5 },
  { activeFrom: '2026-01-02' },
  { activeFrom: '0000-01-01' },
  { activeUntil: '2025-12-01' },
  { activeUntil: '2026-02-30' },
  { stoppedFrom: '2026-06-02' },
  { stoppedFrom: 'infinity' },
])('rejects invalid template %j', (change) => {
  expect(() => createRecurringExpense({ ...input, ...change })).toThrow();
});
test.each([
  ['2026-02-01', '2026-02-28'],
  ['2028-02-01', '2028-02-29'],
  ['2100-02-01', '2100-02-28'],
  ['2400-02-01', '2400-02-29'],
  ['2026-04-01', '2026-04-30'],
  ['2026-05-01', '2026-05-31'],
  ['9999-12-01', '9999-12-31'],
])(
  'clamps calendar due date for %s without timezone arithmetic',
  (month, expected) => {
    expect(recurringDueDate(createRecurringExpense(input), month)).toBe(
      expected,
    );
  },
);
test('one-month schedule includes first and last month only', () => {
  const template = createRecurringExpense({
    ...input,
    activeFrom: '2026-02-01',
    activeUntil: '2026-02-01',
    dueDay: 5,
  });
  expect(recurringDueDate(template, '2026-01-01')).toBeNull();
  expect(recurringDueDate(template, '2026-02-01')).toBe('2026-02-05');
  expect(recurringDueDate(template, '2026-03-01')).toBeNull();
});
test('stop preserves prior months and excludes its own and later months', () => {
  const template = createRecurringExpense({
    ...input,
    stoppedFrom: '2026-03-01',
  });
  expect(recurringDueDate(template, '2026-02-01')).toBe('2026-02-28');
  expect(recurringDueDate(template, '2026-03-01')).toBeNull();
  expect(recurringDueDate(template, '2028-02-01')).toBeNull();
  expect(template.activeFrom).toBe(input.activeFrom);
});
test('stop at or before activation cancels a future template without deleting it', () => {
  const template = createRecurringExpense({
    ...input,
    stoppedFrom: '2025-12-01',
  });
  expect(recurringDueDate(template, '2026-01-01')).toBeNull();
  expect(template.id).toBe(input.id);
});
test.each(['2026-02-02', '2026-02-30', '0000-01-01', '2026-2-01'])(
  'rejects invalid month %s',
  (month) => {
    expect(() =>
      recurringDueDate(createRecurringExpense(input), month),
    ).toThrow();
  },
);
