import { supabase } from '../../../infrastructure/supabase/client';
import { calculateSharedExpenseSplit } from '../../../domain/shared-expenses/shared-expense-split';
import { createMoney } from '../../../domain/money/money';
import {
  createSharedExpense,
  mapSharedExpense,
  mapSharedExpenseReceipt,
  readSharedExpense,
  sharedExpenseRequestSchema,
} from '../shared-expense-data';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
const id = (n: number) =>
  `f2070000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = () => ({
  id: id(50),
  householdId: id(20),
  payerMemberId: id(41),
  templateId: id(30),
  templateVersion: 1,
  roster: [id(40), id(41), id(42)],
  amountMinor: 101,
  currency: 'USD',
  transactionDate: '2026-10-01',
  description: null,
});
const response = (amountMinor = 101, points = [7000, 3000, 0]) => ({
  profile_id: id(1),
  expense_id: id(50),
  transaction_id: id(50),
  household_id: id(20),
  created_by: id(1),
  payer_member_id: id(41),
  template_id: id(30),
  template_version: 1,
  amount_minor: amountMinor,
  currency: 'USD',
  transaction_date: '2026-10-01',
  description: null,
  splits: calculateSharedExpenseSplit(
    createMoney(amountMinor, 'USD'),
    points.map((basisPoints, index) => ({
      memberId: id(40 + index),
      basisPoints,
    })),
  ).map((share) => ({
    member_id: share.memberId,
    basis_points: share.basisPoints,
    responsibility_amount_minor: share.responsibilityAmount.amountMinor,
  })),
});
beforeEach(() => jest.resetAllMocks());
test('strict receipt preserves separate payer, actor and rounded responsibilities including explicit zero', () => {
  const result = mapSharedExpenseReceipt(id(1), request(), response());
  expect(result.splits.map((s) => s.responsibility_amount_minor)).toEqual([
    71, 30, 0,
  ]);
  expect(result.payer_member_id).toBe(id(41));
  expect(result.created_by).toBe(id(1));
});
test.each([1, 2, 100, 101, Number.MAX_SAFE_INTEGER])(
  'accepts exact conservation at %s',
  (amount) => {
    expect(
      mapSharedExpense(id(1), id(20), id(50), response(amount)).amount_minor,
    ).toBe(amount);
  },
);
test.each([
  { profile_id: id(2) },
  { household_id: id(21) },
  { expense_id: id(51) },
  { transaction_id: id(51) },
  { payer_member_id: id(90) },
  { owner_profile_id: id(1) },
  { budget_period_id: id(99) },
  { amount_minor: 0 },
  { amount_minor: 1.5 },
  { amount_minor: Number.MAX_SAFE_INTEGER + 1 },
  { currency: 'usd' },
  { transaction_date: '2026-02-30' },
  { transaction_date: '0000-01-01' },
  { template_version: 0 },
  { description: 'x'.repeat(501) },
  { splits: [] },
])('rejects malformed or leaking response %j', (change) => {
  expect(() =>
    mapSharedExpense(id(1), id(20), id(50), { ...response(), ...change }),
  ).toThrow();
});
test('rejects wrong rounding even if sum conserves, duplicate members, noncanonical order, and missing zero rows on receipt', () => {
  const data = response();
  const bad = [
    [
      { ...data.splits[0], responsibility_amount_minor: 70 },
      { ...data.splits[1], responsibility_amount_minor: 31 },
      data.splits[2],
    ],
    [data.splits[0], { ...data.splits[1], member_id: id(40) }, data.splits[2]],
    [...data.splits].reverse(),
    [{ ...data.splits[0], basis_points: 6999 }, data.splits[1], data.splits[2]],
    [
      { ...data.splits[0], responsibility_amount_minor: 72 },
      data.splits[1],
      data.splits[2],
    ],
  ];
  for (const splits of bad)
    expect(() =>
      mapSharedExpense(id(1), id(20), id(50), { ...data, splits }),
    ).toThrow();
  expect(() =>
    mapSharedExpenseReceipt(id(1), request(), {
      ...data,
      splits: data.splits.slice(0, 2),
    }),
  ).toThrow();
});
test.each([
  { created_by: id(2) },
  { template_id: id(31) },
  { template_version: 2 },
  { payer_member_id: id(40) },
  { description: '' },
  { currency: 'UYU' },
  { transaction_date: '2026-10-02' },
])('receipt rejects changed original payload %j', (change) => {
  expect(() =>
    mapSharedExpenseReceipt(id(1), request(), { ...response(), ...change }),
  ).toThrow();
});
test('read does not infer payer or creator from the current reader or current configuration', () => {
  const data = { ...response(), profile_id: id(2) };
  expect(mapSharedExpense(id(2), id(20), id(50), data)).toEqual(data);
  expect(() => mapSharedExpenseReceipt(id(2), request(), data)).toThrow();
});
test.each([
  { splits: [] },
  { ownerProfileId: id(1) },
  { categoryId: id(90) },
  { amountMinor: 0 },
  { amountMinor: 1.5 },
  { roster: [id(40), id(40), id(41)] },
  { roster: [] },
  { payerMemberId: id(90) },
  { templateVersion: 0 },
])(
  'request rejects untrusted unsupported fields and invalid identities %j',
  (change) => {
    expect(
      sharedExpenseRequestSchema.safeParse({ ...request(), ...change }).success,
    ).toBe(false);
  },
);
test('UUID case is canonical and description remains exact, with Unicode code-point bound', () => {
  const input = {
    ...request(),
    id: id(50).toUpperCase(),
    description: '😀'.repeat(500),
  };
  expect(sharedExpenseRequestSchema.parse(input).id).toBe(id(50));
  expect(sharedExpenseRequestSchema.parse(input).description).toBe(
    input.description,
  );
  expect(
    sharedExpenseRequestSchema.parse({ ...request(), description: '  x  ' })
      .description,
  ).toBe('  x  ');
});
test('create forwards only validated original inputs and parses the real receipt', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValueOnce({ data: response(), error: null } as never);
  await expect(createSharedExpense(id(1), request())).resolves.toEqual(
    response(),
  );
  expect(supabase.rpc).toHaveBeenCalledWith('create_shared_expense', {
    p_request_id: id(50),
    p_household_id: id(20),
    p_payer_member_id: id(41),
    p_template_id: id(30),
    p_template_version: 1,
    p_roster: request().roster,
    p_amount_minor: 101,
    p_currency: 'USD',
    p_transaction_date: '2026-10-01',
    p_description: null,
  });
});
test('read is cancellable, scopes response to current reader, and propagates unknown transport outcomes', async () => {
  const signal = new AbortController().signal;
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: response(), error: null });
  jest.mocked(supabase.rpc).mockReturnValueOnce({ abortSignal } as never);
  await expect(
    readSharedExpense(id(1), id(20), id(50), signal),
  ).resolves.toEqual(response());
  expect(abortSignal).toHaveBeenCalledWith(signal);
  const failure = { code: '42501' };
  jest
    .mocked(supabase.rpc)
    .mockResolvedValueOnce({ data: null, error: failure } as never);
  await expect(createSharedExpense(id(1), request())).rejects.toBe(failure);
});
