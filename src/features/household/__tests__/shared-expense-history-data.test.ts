import { supabase } from '../../../infrastructure/supabase/client';
import {
  mapSharedExpensePage,
  mapSharedExpenseHistoryDetail,
  readSharedExpenseHistoryDetail,
  readSharedExpensePage,
  sharedExpenseHistoryRows,
} from '../shared-expense-history-data';
import {
  historyId as id,
  historyExpense as expense,
  historyPage as page,
  historyDetail as detail,
} from './history-fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
beforeEach(() => jest.resetAllMocks());
test('maps empty, exact terminal and continuing pages without totals or current-template lookup', () => {
  expect(mapSharedExpensePage(id(1), id(20), page([])).expenses).toEqual([]);
  const rows = Array.from({ length: 20 }, (_, index) => expense(120 - index));
  expect(
    mapSharedExpensePage(id(1), id(20), page(rows)).next_cursor,
  ).toBeNull();
  expect(
    mapSharedExpensePage(id(1), id(20), page(rows, id(101))).expenses,
  ).toEqual(rows);
  expect(
    mapSharedExpensePage(id(1).toUpperCase(), id(20).toUpperCase(), page())
      .expenses,
  ).toEqual([expense()]);
});
test('original currencies and saved split remain separate from payer and current settings', () => {
  const rows = [expense(102), { ...expense(101), currency: 'UYU' }];
  const result = mapSharedExpensePage(id(1), id(20), page(rows));
  expect(result.expenses.map((row) => row.currency)).toEqual(['USD', 'UYU']);
  expect(
    result.expenses[0].splits.map((row) => row.responsibility_amount_minor),
  ).toEqual([71, 30, 0]);
  expect(result.expenses[0].payer_member_id).toBe(id(41));
});
test.each([
  { profile_id: id(2) },
  { household_id: id(21) },
  { total: 101 },
  { next_cursor: id(100) },
  { expenses: [expense(), expense()] },
  { expenses: [expense(100), expense(101)] },
  { expenses: [expense(101), expense(100, '2026-10-02')] },
  { expenses: [expense(), { ...expense(99), owner_profile_id: id(2) }] },
  { expenses: [expense(), { ...expense(99), household_id: id(21) }] },
  { expenses: [expense(), { ...expense(99), profile_id: id(2) }] },
  { expenses: [expense(), { ...expense(99), amount_minor: 102 }] },
  { expenses: [expense(), { ...expense(99), splits: [] }] },
  { expenses: [expense(), null] },
  { expenses: Array.from({ length: 21 }, (_, index) => expense(150 - index)) },
  { next_cursor: 'invalid' },
  { next_cursor: undefined },
])(
  'rejects whole page, never silently drops malformed/foreign rows %j',
  (change) => {
    expect(() =>
      mapSharedExpensePage(id(1), id(20), { ...page(), ...change }),
    ).toThrow();
  },
);
test('cursor continuation must identify the last row of a full page', () => {
  const rows = [expense(102), expense(101)];
  expect(
    mapSharedExpensePage(id(1), id(20), page(rows, id(101)), id(103), 2)
      .next_cursor,
  ).toBe(id(101));
  expect(() =>
    mapSharedExpensePage(id(1), id(20), page(rows, id(102)), null, 2),
  ).toThrow();
  expect(() =>
    mapSharedExpensePage(id(1), id(20), page(rows), id(102), 2),
  ).toThrow();
  expect(() =>
    mapSharedExpensePage(id(1), id(20), page(), 'malformed'),
  ).toThrow();
  for (const limit of [0, 51, 1.5, NaN])
    expect(() =>
      mapSharedExpensePage(id(1), id(20), page(), null, limit),
    ).toThrow();
});
test('cross-page order and identities are validated instead of silently deduplicated', () => {
  const first = page([expense(103), expense(102)], id(102));
  expect(sharedExpenseHistoryRows([first, page([expense(101)])])).toHaveLength(
    3,
  );
  expect(sharedExpenseHistoryRows([first, page([])])).toHaveLength(2);
  for (const second of [
    page([expense(102)]),
    page([expense(104)]),
    page([expense(101, '2026-10-02')]),
    { ...page([expense(101)]), profile_id: id(2) },
    { ...page([expense(101)]), household_id: id(21) },
  ])
    expect(() => sharedExpenseHistoryRows([first, second])).toThrow();
  expect(() =>
    sharedExpenseHistoryRows([page([expense(103)]), page([expense(102)])]),
  ).toThrow();
});
test('adapter bounds requests, omits only null cursor and supports cancellation', async () => {
  const signal = new AbortController().signal;
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: page(), error: null });
  jest.mocked(supabase.rpc).mockReturnValueOnce({ abortSignal } as never);
  await expect(
    readSharedExpensePage(id(1), id(20), null, signal),
  ).resolves.toEqual(page());
  expect(supabase.rpc).toHaveBeenCalledWith('list_shared_expenses', {
    p_household_id: id(20),
    p_limit: 20,
  });
  expect(abortSignal).toHaveBeenCalledWith(signal);
  jest
    .mocked(supabase.rpc)
    .mockResolvedValueOnce({ data: page(), error: null } as never);
  await readSharedExpensePage(id(1), id(20), id(101));
  expect(supabase.rpc).toHaveBeenLastCalledWith('list_shared_expenses', {
    p_household_id: id(20),
    p_limit: 20,
    p_before_expense_id: id(101),
  });
});
test('invalid request identifiers do not send; authorization/transport failure never becomes empty history', async () => {
  await expect(readSharedExpensePage('invalid', id(20))).rejects.toThrow();
  await expect(
    readSharedExpensePage(id(1), id(20), 'invalid'),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
  const error = { code: '42501' };
  jest
    .mocked(supabase.rpc)
    .mockResolvedValueOnce({ data: null, error } as never);
  await expect(readSharedExpensePage(id(1), id(20))).rejects.toBe(error);
});

test.each(
  [
    [],
    [{ id: id(40), display_name: '' }],
    [{ id: id(40), display_name: 'Ana', base_currency: 'USD' }],
    [
      { id: id(40), display_name: 'Ana' },
      { id: id(40), display_name: 'Duplicate' },
    ],
  ].map((members) => ({ members })),
)(
  'both history readers reject malformed or expanded display roster %j',
  ({ members }) => {
    expect(() =>
      mapSharedExpensePage(id(1), id(20), { ...page(), members }),
    ).toThrow();
    expect(() =>
      mapSharedExpenseHistoryDetail(id(1), id(20), id(100), {
        ...detail(),
        members,
      }),
    ).toThrow();
  },
);
test('history detail validates every scope while departed payer and newly joined names never alter saved responsibility', () => {
  const result = detail(expense(), [
    { id: id(40), display_name: 'Ana' },
    { id: id(49), display_name: 'Nuevo' },
  ]);
  expect(
    mapSharedExpenseHistoryDetail(id(1), id(20), id(100), result).expense
      .splits,
  ).toEqual(expense().splits);
  for (const change of [
    { profile_id: id(2) },
    { household_id: id(21) },
    { expense: { ...expense(), expense_id: id(101) } },
    { private_income: 100 },
    { members: undefined },
  ])
    expect(() =>
      mapSharedExpenseHistoryDetail(id(1), id(20), id(100), {
        ...result,
        ...change,
      }),
    ).toThrow();
});
test('detail adapter uses same-snapshot authorized wrapper, cancellation and strict parser', async () => {
  const signal = new AbortController().signal;
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: detail(), error: null });
  jest.mocked(supabase.rpc).mockReturnValueOnce({ abortSignal } as never);
  await expect(
    readSharedExpenseHistoryDetail(id(1), id(20), id(100), signal),
  ).resolves.toEqual(detail());
  expect(supabase.rpc).toHaveBeenCalledWith(
    'get_shared_expense_history_detail',
    { p_household_id: id(20), p_expense_id: id(100) },
  );
  expect(abortSignal).toHaveBeenCalledWith(signal);
  const error = { code: '42501' };
  jest
    .mocked(supabase.rpc)
    .mockResolvedValueOnce({ data: null, error } as never);
  await expect(
    readSharedExpenseHistoryDetail(id(1), id(20), id(100)),
  ).rejects.toBe(error);
});
