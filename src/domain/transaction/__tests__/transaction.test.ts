import {
  createTransaction,
  isTransactionActive,
  transactionMoney,
  transactionTypes,
} from '../transaction';
const input = {
  id: 'f1080000-0000-4000-8000-000000000001',
  ownerProfileId: 'f0050000-0000-4000-8000-000000000001',
  budgetPeriodId: 'f1030000-0000-4000-8000-000000000001',
  scope: 'PERSONAL',
  type: 'INCOME',
  amountMinor: 100001,
  currency: 'USD',
  transactionDate: '2026-10-20',
  categoryId: null,
  description: null,
  deletedAt: null,
};
test.each(transactionTypes)(
  'models Phase 1 type %s without conflating it with expenses',
  (type) => {
    const result = createTransaction({ ...input, type });
    expect(result.type).toBe(type);
    expect(transactionMoney(result)).toEqual({
      amountMinor: 100001,
      currency: 'USD',
    });
    expect(Object.isFrozen(result)).toBe(true);
  },
);
test.each([0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid amount %s',
  (amountMinor) => {
    expect(() => createTransaction({ ...input, amountMinor })).toThrow();
  },
);
test('allows largest safe positive amount without rounding', () => {
  expect(
    createTransaction({ ...input, amountMinor: Number.MAX_SAFE_INTEGER })
      .amountMinor,
  ).toBe(Number.MAX_SAFE_INTEGER);
});
test.each([
  { type: 'TRANSFER' },
  { scope: 'HOUSEHOLD' },
  { currency: 'usd' },
  { transactionDate: '2026-02-30' },
  { transactionDate: '0000-01-01' },
  { transactionDate: '2026-10-20T12:00:00Z' },
  { categoryId: 'bad' },
  { ownerProfileId: null },
  { budgetPeriodId: 'bad' },
])('rejects invalid external fields %j', (change) => {
  expect(() => createTransaction({ ...input, ...change })).toThrow();
});
test('soft deletion retains original money and financial date', () => {
  const result = createTransaction({
    ...input,
    deletedAt: '2026-10-21T03:00:00Z',
  });
  expect(isTransactionActive(result)).toBe(false);
  expect(transactionMoney(result).amountMinor).toBe(100001);
  expect(result.transactionDate).toBe('2026-10-20');
  expect(isTransactionActive(createTransaction(input))).toBe(true);
});
