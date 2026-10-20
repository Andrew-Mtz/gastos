import { supabase } from '../../../infrastructure/supabase/client';
import { readHistory, monthBounds, shiftMonth } from '../history-data';
import { period, profile } from '../../expense/__tests__/fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { from: jest.fn() },
}));
function row(index: number) {
  return {
    id: `f1120000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    owner_profile_id: profile.id,
    budget_period_id: period.id,
    scope: 'PERSONAL',
    type: 'EXPENSE',
    amount_minor: 1234,
    currency: 'USD',
    transaction_date: '2026-10-20',
    category_id: 'f1070000-0000-4000-8000-000000000001',
    category: { name: 'Archived food' },
    description: null,
    deleted_at: null,
  };
}
function database(rows: unknown = [row(1)]) {
  const query = Object.assign(
    Promise.resolve({ data: rows, error: null }),
    Object.fromEntries(
      [
        'select',
        'eq',
        'is',
        'not',
        'gte',
        'lte',
        'order',
        'limit',
        'or',
        'abortSignal',
      ].map((name) => [name, jest.fn().mockReturnThis()]),
    ),
  );
  jest.mocked(supabase.from).mockReturnValue(query as never);
  return query;
}
beforeEach(() => jest.clearAllMocks());
test('keyset history is private, month-bounded, cancellable and excludes deleted rows', async () => {
  const query = database();
  const signal = new AbortController().signal;
  const page = await readHistory(
    profile.id,
    '2026-10-01',
    { date: '2026-10-21', id: row(2).id },
    signal,
  );
  expect(supabase.from).toHaveBeenCalledWith('transactions');
  expect(query.eq).toHaveBeenCalledWith('owner_profile_id', profile.id);
  expect(query.eq).toHaveBeenCalledWith('scope', 'PERSONAL');
  expect(query.is).toHaveBeenCalledWith('deleted_at', null);
  expect(query.gte).toHaveBeenCalledWith('transaction_date', '2026-10-01');
  expect(query.lte).toHaveBeenCalledWith('transaction_date', '2026-10-31');
  expect(query.order.mock.calls).toEqual([
    ['transaction_date', { ascending: false }],
    ['id', { ascending: false }],
  ]);
  expect(query.limit).toHaveBeenCalledWith(51);
  expect(query.or).toHaveBeenCalledWith(
    `transaction_date.lt.2026-10-21,and(transaction_date.eq.2026-10-21,id.lt.${row(2).id})`,
  );
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(page.items[0].categoryName).toBe('Archived food');
  expect(page.items[0].transaction.amountMinor).toBe(1234);
  expect(page.nextCursor).toBeNull();
});
test('lookahead is not displayed and next cursor uses last displayed row', async () => {
  database(Array.from({ length: 51 }, (_, i) => row(100 - i)));
  const result = await readHistory(profile.id, '2026-10-01', null);
  expect(result.items).toHaveLength(50);
  expect(result.nextCursor).toEqual({ date: '2026-10-20', id: row(51).id });
});
test('empty month is empty, not another month fallback', async () => {
  database([]);
  expect(await readHistory(profile.id, '2026-11-01', null)).toEqual({
    items: [],
    nextCursor: null,
  });
});
test('invalid cursor cannot become a query expression', async () => {
  const query = database();
  await expect(
    readHistory(profile.id, '2026-10-01', {
      date: '2026-10-20',
      id: 'id.or.true',
    }),
  ).rejects.toThrow();
  expect(query.or).not.toHaveBeenCalled();
});
test.each([
  ['2024-02-01', '2024-02-29'],
  ['2026-02-01', '2026-02-28'],
  ['0001-02-01', '0001-02-28'],
  ['2000-02-01', '2000-02-29'],
  ['1900-02-01', '1900-02-28'],
])('month boundaries %s', (month, end) => {
  expect(monthBounds(month).end).toBe(end);
});
test('month shifting respects year and supported date boundaries', () => {
  expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
  expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
  expect(shiftMonth('0001-01-01', -1)).toBe('0001-01-01');
  expect(shiftMonth('9999-12-01', 1)).toBe('9999-12-01');
  expect(() => monthBounds('2026-10-02')).toThrow();
  expect(() => monthBounds('0000-01-01')).toThrow();
});

test('deleted history has explicit tombstone filtering and remains owner bounded', async () => {
  const query = database([{ ...row(1), deleted_at: '2026-10-20T00:00:00Z' }]);
  const page = await readHistory(
    profile.id,
    '2026-10-01',
    null,
    undefined,
    true,
  );
  expect(query.not).toHaveBeenCalledWith('deleted_at', 'is', null);
  expect(query.is).not.toHaveBeenCalled();
  expect(page.items[0].transaction.deletedAt).not.toBeNull();
});
test('wrong owner and tombstone appearing in active history fail closed', async () => {
  database([
    { ...row(1), owner_profile_id: 'f0050000-0000-4000-8000-000000000002' },
  ]);
  await expect(readHistory(profile.id, '2026-10-01', null)).rejects.toThrow();
  database([{ ...row(1), deleted_at: '2026-10-20T00:00:00Z' }]);
  await expect(readHistory(profile.id, '2026-10-01', null)).rejects.toThrow();
});
