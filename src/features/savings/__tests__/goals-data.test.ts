import { supabase } from '../../../infrastructure/supabase/client';
import {
  createSavingsGoal,
  readSavingsGoals,
  readGoalHistory,
  goalsKey,
  goalHistoryKey,
} from '../goals-data';
import { savingsOwnerKey, registerSavings } from '../savings-data';
import { period } from '../../income/__tests__/fixtures';

jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));
const goalId = '61160000-0000-4000-8000-000000000001';
const row = {
  id: goalId,
  owner_profile_id: period.profile_id,
  scope: 'PERSONAL',
  name: 'Trip',
  target_amount_minor: 1234,
  currency: 'USD',
  target_date: null,
};
const request = {
  id: goalId,
  form: { name: ' Trip ', target: '12.34', currency: 'USD', targetDate: '' },
};
const summary = {
  owner_profile_id: period.profile_id,
  through_month: period.starts_on,
  goals: [{ ...row, balance_minor: 1000 }],
};
beforeEach(() => jest.clearAllMocks());
test('creates goal using stable identity and exact amount, no budget or transaction side effect', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: row, error: null } as never);
  expect(await createSavingsGoal(period.profile_id, request)).toEqual(row);
  expect(supabase.rpc).toHaveBeenCalledWith('create_personal_savings_goal', {
    p_goal_id: goalId,
    p_name: 'Trip',
    p_target_amount_minor: 1234,
    p_currency: 'USD',
  });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.from).not.toHaveBeenCalled();
});
test.each([
  { id: period.id },
  { owner_profile_id: period.id },
  { name: 'Other' },
  { target_amount_minor: 1235 },
  { currency: 'EUR' },
  { target_date: '2026-12-01' },
  { scope: 'HOUSEHOLD' },
])('creation rejects mismatched response %s', async (patch) => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: { ...row, ...patch }, error: null } as never);
  await expect(createSavingsGoal(period.profile_id, request)).rejects.toThrow();
});
test('invalid target never reaches server', async () => {
  await expect(
    createSavingsGoal(period.profile_id, {
      ...request,
      form: { ...request.form, target: '0' },
    }),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('read snapshot validates owner/month, computes progress and consumes abort signal', async () => {
  const query = Object.assign(Promise.resolve({ data: summary, error: null }), {
    abortSignal: jest.fn().mockReturnThis(),
  });
  jest.mocked(supabase.rpc).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  expect(
    (await readSavingsGoals(period.profile_id, period.starts_on, signal))[0]
      .progress,
  ).toMatchObject({ remaining: { amountMinor: 234 }, attained: false });
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(goalsKey(period.profile_id, period.starts_on).slice(0, 2)).toEqual(
    savingsOwnerKey(period.profile_id),
  );
  expect(
    goalHistoryKey(period.profile_id, goalId, period.starts_on).slice(0, 2),
  ).toEqual(savingsOwnerKey(period.profile_id));
  expect(goalsKey(period.id, period.starts_on)).not.toEqual(
    goalsKey(period.profile_id, period.starts_on),
  );
});
test.each([
  { owner_profile_id: period.id },
  { through_month: '2026-09-01' },
  { goals: [{ ...row, owner_profile_id: period.id, balance_minor: 1 }] },
  { goals: [{ ...row, balance_minor: -1 }] },
  { goals: [{ ...row, balance_minor: 9007199254740992 }] },
  {
    goals: [
      { ...row, balance_minor: 1 },
      { ...row, balance_minor: 1 },
    ],
  },
])('invalid snapshot is never shown %s', async (patch) => {
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: { ...summary, ...patch },
    error: null,
  } as never);
  await expect(
    readSavingsGoals(period.profile_id, period.starts_on),
  ).rejects.toThrow();
});
test('linked savings registration includes immutable goal and rejects a missing/different link', async () => {
  const req = {
    id: 'a1160000-0000-4000-8000-000000000001',
    type: 'SAVINGS_CONTRIBUTION' as const,
    withdrawalConfirmed: false,
    savingsGoalId: goalId,
    form: { amount: '10', date: '2026-10-02', description: '' },
  };
  const movement = {
    id: req.id,
    owner_profile_id: period.profile_id,
    budget_period_id: period.id,
    scope: 'PERSONAL',
    type: req.type,
    amount_minor: 1000,
    currency: 'USD',
    transaction_date: req.form.date,
    category_id: null,
    description: null,
    deleted_at: null,
    withdrawal_confirmed: false,
    savings_validated: true,
    savings_goal_id: goalId,
  };
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: movement, error: null } as never);
  await registerSavings(period, req);
  expect(supabase.rpc).toHaveBeenCalledWith(
    'register_savings_movement',
    expect.objectContaining({
      p_savings_goal_id: goalId,
      p_amount_minor: 1000,
    }),
  );
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: { ...movement, savings_goal_id: null },
    error: null,
  } as never);
  await expect(registerSavings(period, req)).rejects.toThrow();
});
test('goal history is owner/goal bound and keyset-paginated through month, not used for totals', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `a1160000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    owner_profile_id: period.profile_id,
    budget_period_id: period.id,
    scope: 'PERSONAL',
    savings_goal_id: goalId,
    type: 'SAVINGS_CONTRIBUTION',
    amount_minor: 1,
    currency: 'USD',
    transaction_date: '2026-10-02',
    description: null,
    deleted_at: null,
    category_id: null,
    savings_validated: true,
  }));
  const query = Object.assign(
    Promise.resolve({ data: rows, error: null }),
    Object.fromEntries(
      ['select', 'eq', 'is', 'lte', 'order', 'limit', 'or', 'abortSignal'].map(
        (method) => [method, jest.fn().mockReturnThis()],
      ),
    ),
  );
  jest.mocked(supabase.from).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  const result = await readGoalHistory(
    period.profile_id,
    goalId,
    period.starts_on,
    { date: '2026-10-03', id: goalId },
    signal,
  );
  expect(result.items).toHaveLength(50);
  expect(result.nextCursor).toEqual({ id: rows[49].id, date: '2026-10-02' });
  expect(query.eq).toHaveBeenCalledWith('owner_profile_id', period.profile_id);
  expect(query.eq).toHaveBeenCalledWith('savings_goal_id', goalId);
  expect(query.lte).toHaveBeenCalledWith('transaction_date', '2026-10-31');
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(query.or).toHaveBeenCalledWith(
    `transaction_date.lt.2026-10-03,and(transaction_date.eq.2026-10-03,id.lt.${goalId})`,
  );
  rows[0].savings_goal_id = period.id;
  await expect(
    readGoalHistory(period.profile_id, goalId, period.starts_on, null),
  ).rejects.toThrow();
});
test('infrastructure error remains an error rather than an empty list', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: null, error: { code: '23514' } } as never);
  await expect(
    readSavingsGoals(period.profile_id, period.starts_on),
  ).rejects.toEqual({ code: '23514' });
});
