import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { createTransaction } from '../../domain/transaction/transaction';
import { readBudget } from '../budget/budget-data';
import {
  currencyDigits,
  parseDecimal,
  type BudgetPeriod,
} from '../budget/budget-setup';
import { validateIncomeForm, type IncomeRequest } from './income-form';

export const incomeKey = (profileId: string, month: string) =>
  ['income', profileId, month] as const;
export async function readReceivedIncome(
  periodId: string,
  signal?: AbortSignal,
) {
  const query = supabase.rpc('get_received_income', {
    p_budget_period_id: z.uuid().parse(periodId),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(data);
}
export async function readIncomeMonth(
  profileId: string,
  month: string,
  signal?: AbortSignal,
) {
  const budget = await readBudget(profileId, month, signal);
  return {
    ...budget,
    receivedMinor: budget.period
      ? await readReceivedIncome(budget.period.id, signal)
      : 0,
  };
}
export async function registerIncome(
  period: BudgetPeriod,
  request: IncomeRequest,
) {
  const form = validateIncomeForm(period).parse(request.form);
  const { data, error } = await supabase.rpc('register_income', {
    p_transaction_id: z.uuid().parse(request.id),
    p_budget_period_id: period.id,
    p_amount_minor: parseDecimal(
      form.amount,
      currencyDigits(period.base_currency),
    )!,
    p_currency: period.base_currency,
    p_transaction_date: form.date,
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
      type: z.string(),
      amount_minor: z.number(),
      currency: z.string(),
      transaction_date: z.string(),
      category_id: z.string().nullable(),
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
