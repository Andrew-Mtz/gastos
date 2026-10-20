import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { createTransaction } from '../../domain/transaction/transaction';
import { readBudget } from '../budget/budget-data';
import {
  currencyDigits,
  parseDecimal,
  type BudgetPeriod,
  type BudgetBucket,
} from '../budget/budget-setup';
import { validateExpenseForm, type ExpenseRequest } from './expense-form';

export const expenseOwnerKey = (profileId: string) =>
  ['expenses', profileId] as const;
export const expenseKey = (profileId: string, month: string) =>
  [...expenseOwnerKey(profileId), month] as const;
export const categoryRowSchema = z.object({
  id: z.uuid(),
  profile_id: z.uuid(),
  name: z.string(),
  budget_bucket_id: z.uuid().nullable(),
  archived_at: z.string().nullable(),
});
export type ExpenseCategory = z.infer<typeof categoryRowSchema>;
export function eligibleCategories(
  categories: ExpenseCategory[],
  buckets: BudgetBucket[],
) {
  return categories.filter(
    (c) =>
      c.archived_at === null &&
      buckets.some(
        (b) =>
          b.id === c.budget_bucket_id &&
          b.profile_id === c.profile_id &&
          b.type === 'SPENDABLE' &&
          b.archived_at === null,
      ),
  );
}
export async function readExpenseMonth(
  profileId: string,
  month: string,
  signal?: AbortSignal,
) {
  const budget = await readBudget(profileId, month, signal);
  const query = supabase
    .from('categories')
    .select('*')
    .eq('profile_id', profileId)
    .order('name')
    .order('id');
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return {
    ...budget,
    categories: eligibleCategories(
      z.array(categoryRowSchema).parse(data),
      budget.buckets,
    ),
  };
}
export async function createExpenseCategory(
  profileId: string,
  bucketId: string,
  name: string,
) {
  const { data, error } = await supabase
    .from('categories')
    .insert({
      profile_id: z.uuid().parse(profileId),
      budget_bucket_id: z.uuid().parse(bucketId),
      name: z.string().trim().min(1).max(120).parse(name),
    })
    .select('*')
    .single();
  if (error) throw error;
  return categoryRowSchema.parse(data);
}
export async function registerExpense(
  period: BudgetPeriod,
  request: ExpenseRequest,
) {
  const form = validateExpenseForm(period).parse(request.form);
  const { data, error } = await supabase.rpc('register_personal_expense', {
    p_transaction_id: z.uuid().parse(request.id),
    p_budget_period_id: period.id,
    p_amount_minor: parseDecimal(
      form.amount,
      currencyDigits(period.base_currency),
    )!,
    p_currency: period.base_currency,
    p_transaction_date: form.date,
    p_category_id: form.categoryId,
    ...(form.description.trim()
      ? { p_description: form.description.trim() }
      : {}),
  });
  if (error) throw error;
  const row = z
    .object({
      id: z.string(),
      owner_profile_id: z.string(),
      budget_period_id: z.string(),
      scope: z.string(),
      type: z.literal('EXPENSE'),
      amount_minor: z.number(),
      currency: z.string(),
      transaction_date: z.string(),
      category_id: z.string(),
      description: z.string().nullable(),
      deleted_at: z.string().nullable(),
    })
    .parse(data);
  return createTransaction({
    id: row.id,
    ownerProfileId: row.owner_profile_id,
    budgetPeriodId: row.budget_period_id,
    scope: row.scope,
    type: row.type,
    amountMinor: row.amount_minor,
    currency: row.currency,
    transactionDate: row.transaction_date,
    categoryId: row.category_id,
    description: row.description,
    deletedAt: row.deleted_at,
  });
}
