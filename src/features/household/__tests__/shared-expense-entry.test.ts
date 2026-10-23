import {
  prepareSharedExpense,
  sharedExpenseFormSchema,
  templateConfirmsSharedExpense,
  sameSharedExpenseRequest,
  isRejectedSharedExpense,
  sharedExpenseErrorMessage,
  pendingSharedExpenseKey,
  sharedExpenseContextKey,
  sharedExpenseReceiptKey,
} from '../shared-expense-entry';
import { splitId as id, splitSnapshot } from './split-fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
const input = {
  amount: '10.01',
  date: '2026-10-23',
  payerMemberId: id(41),
  description: '',
};
const prepare = (
  form = input,
  currency = 'UYU',
  snapshot = splitSnapshot('READY'),
) => prepareSharedExpense(id(1), id(20), currency, snapshot, id(60), form);

test.each(['OWNER', 'MEMBER'])(
  '%s uses only current template independent of payer',
  (role) => {
    const first = prepare(input, 'UYU', splitSnapshot('READY', role));
    const second = prepare(
      { ...input, payerMemberId: id(40) },
      'UYU',
      splitSnapshot('READY', role),
    );
    expect(first.responsibilities).toEqual(second.responsibilities);
    expect(
      first.responsibilities.map(
        (share) => share.responsibilityAmount.amountMinor,
      ),
    ).toEqual([701, 300]);
    expect(first.request).toEqual({
      id: id(60),
      householdId: id(20),
      payerMemberId: id(41),
      templateId: id(50),
      templateVersion: 1,
      roster: [id(40), id(41)],
      amountMinor: 1001,
      currency: 'UYU',
      transactionDate: '2026-10-23',
      description: null,
    });
  },
);
test.each([
  '0',
  '-1',
  '1e2',
  'NaN',
  'Infinity',
  '1,000.00',
  '0.001',
  '90071992547409.92',
  '',
])('rejects invalid amount %s', (amount) => {
  expect(() => prepare({ ...input, amount })).toThrow();
});
test.each(['2026-02-30', '0000-01-01', '2026-1-1', ''])(
  'rejects invalid date %s',
  (date) => {
    expect(() => prepare({ ...input, date })).toThrow();
  },
);
test('accepts exact comma input, max-safe amount and valid financial dates without personal month constraints', () => {
  expect(
    prepare({ ...input, amount: '90071992547409,91', date: '2020-02-29' })
      .request.amountMinor,
  ).toBe(Number.MAX_SAFE_INTEGER);
  expect(
    prepare({ ...input, amount: '1', date: '9999-12-31' }, 'JPY').request
      .amountMinor,
  ).toBe(1);
});
test('accepts explicit zero responsibility and one-member households', () => {
  const snapshot = splitSnapshot('READY');
  snapshot.template!.shares = [
    { member_id: id(40), basis_points: 10000 },
    { member_id: id(41), basis_points: 0 },
  ];
  expect(
    prepare(input, 'UYU', snapshot).responsibilities[1].responsibilityAmount
      .amountMinor,
  ).toBe(0);
  snapshot.roster.pop();
  snapshot.template!.roster.pop();
  snapshot.template!.shares.pop();
  expect(
    prepare({ ...input, payerMemberId: id(40) }, 'UYU', snapshot)
      .responsibilities,
  ).toHaveLength(1);
});
test.each(['UNCONFIGURED', 'STALE'] as const)(
  'never invents %s shares',
  (status) => {
    expect(() => prepare(input, 'UYU', splitSnapshot(status))).toThrow();
  },
);
test.each([id(1), id(99), ''])(
  'rejects nonmembership/profile payer %s',
  (payerMemberId) => {
    expect(() => prepare({ ...input, payerMemberId })).toThrow();
  },
);
test('validates description in unicode characters and preserves exact text', () => {
  expect(
    prepare({ ...input, description: '😀'.repeat(500) }).request.description,
  ).toHaveLength(1000);
  expect(() => prepare({ ...input, description: '😀'.repeat(501) })).toThrow();
  expect(
    prepare({ ...input, description: '  mercado  ' }).request.description,
  ).toBe('  mercado  ');
});
test('rejects custom percentages, categories and forged context at application boundary', () => {
  expect(
    sharedExpenseFormSchema('UYU').safeParse({ ...input, shares: [] }).success,
  ).toBe(false);
  expect(
    sharedExpenseFormSchema('UYU').safeParse({ ...input, categoryId: id(30) })
      .success,
  ).toBe(false);
  expect(() =>
    prepare(input, 'UYU', { ...splitSnapshot('READY'), profile_id: id(2) }),
  ).toThrow();
  expect(() =>
    prepare(input, 'UYU', { ...splitSnapshot('READY'), household_id: id(21) }),
  ).toThrow();
});
test('revalidation checks exact template, roster and payer, not percentage equality', () => {
  const request = prepare().request;
  expect(templateConfirmsSharedExpense(request, splitSnapshot('READY'))).toBe(
    true,
  );
  const changed = splitSnapshot('READY');
  changed.version = 2;
  changed.template!.version = 2;
  changed.template!.id = id(51);
  expect(templateConfirmsSharedExpense(request, changed)).toBe(false);
  expect(templateConfirmsSharedExpense(request, splitSnapshot('STALE'))).toBe(
    false,
  );
  expect(
    templateConfirmsSharedExpense(request, {
      ...splitSnapshot('READY'),
      household_id: id(21),
    }),
  ).toBe(false);
});
test('retry identity includes every original field and canonical roster', () => {
  const request = prepare().request;
  expect(
    sameSharedExpenseRequest(request, {
      ...request,
      roster: [...request.roster].reverse(),
    }),
  ).toBe(true);
  for (const patch of [
    { id: id(61) },
    { householdId: id(21) },
    { payerMemberId: id(40) },
    { templateId: id(51) },
    { templateVersion: 2 },
    { amountMinor: 2 },
    { currency: 'USD' },
    { transactionDate: '2026-10-22' },
    { description: '' },
    { roster: [id(40)] },
  ]) {
    expect(sameSharedExpenseRequest(request, { ...request, ...patch })).toBe(
      false,
    );
  }
});
test('keys isolate account, household and receipt', () => {
  for (const key of [pendingSharedExpenseKey, sharedExpenseContextKey]) {
    expect(key(id(1), id(20))).not.toEqual(key(id(2), id(20)));
    expect(key(id(1), id(20))).not.toEqual(key(id(1), id(21)));
  }
  expect(sharedExpenseReceiptKey(id(1), id(20), id(60))).not.toEqual(
    sharedExpenseReceiptKey(id(1), id(20), id(61)),
  );
});
test.each([
  '42501',
  '23505',
  '23514',
  '23502',
  '23503',
  '22023',
  '22003',
  '25001',
  '40001',
])('known SQL rejection %s has safe message', (code) => {
  const error = { code, message: 'private internals' };
  expect(isRejectedSharedExpense(error)).toBe(true);
  expect(sharedExpenseErrorMessage(error)).not.toContain('private internals');
});
test('unknown failures stay uncertain and do not expose provider text', () => {
  expect(isRejectedSharedExpense(new Error('private internals'))).toBe(false);
  expect(sharedExpenseErrorMessage(new Error('private internals'))).toMatch(
    /solicitud original/,
  );
});
