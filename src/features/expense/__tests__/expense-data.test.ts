import { supabase } from '../../../infrastructure/supabase/client';
import { registerExpense, eligibleCategories } from '../expense-data';
import { period, request, category, bucket } from './fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
beforeEach(() => jest.clearAllMocks());
test('registration sends exact money, fixed period currency and repeatable identity', async () => {
  jest.mocked(supabase.rpc).mockResolvedValue({
    error: null,
    data: {
      id: request.id,
      owner_profile_id: period.profile_id,
      budget_period_id: period.id,
      scope: 'PERSONAL',
      type: 'EXPENSE',
      amount_minor: 100000,
      currency: 'USD',
      transaction_date: request.form.date,
      category_id: request.form.categoryId,
      description: 'Food',
      deleted_at: null,
    },
  } as never);
  const result = await registerExpense(period, request);
  expect(result.amountMinor).toBe(100000);
  expect(supabase.rpc).toHaveBeenCalledWith('register_personal_expense', {
    p_transaction_id: request.id,
    p_budget_period_id: period.id,
    p_amount_minor: 100000,
    p_currency: 'USD',
    p_transaction_date: request.form.date,
    p_description: 'Food',
    p_category_id: request.form.categoryId,
  });
});
test('invalid amount never reaches database', async () => {
  await expect(
    registerExpense(period, {
      ...request,
      form: { ...request.form, amount: '0' },
    }),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});

test('expense choices exclude saving, archived, unmapped and foreign buckets', () => {
  expect(eligibleCategories([category], [bucket])).toEqual([category]);
  expect(
    eligibleCategories(
      [{ ...category, archived_at: '2026-10-20T00:00:00Z' }],
      [bucket],
    ),
  ).toEqual([]);
  expect(
    eligibleCategories([{ ...category, budget_bucket_id: null }], [bucket]),
  ).toEqual([]);
  expect(
    eligibleCategories([category], [{ ...bucket, type: 'SAVINGS' }]),
  ).toEqual([]);
  expect(
    eligibleCategories(
      [category],
      [{ ...bucket, archived_at: '2026-10-20T00:00:00Z' }],
    ),
  ).toEqual([]);
  expect(
    eligibleCategories(
      [category],
      [{ ...bucket, profile_id: 'f0050000-0000-4000-8000-000000000002' }],
    ),
  ).toEqual([]);
});
