import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { calculateSavingsAvailability } from '../../domain/savings/savings-availability';
import { createTransaction } from '../../domain/transaction/transaction';
import { readBudget } from '../budget/budget-data';
import {
  currencyDigits,
  parseDecimal,
  type BudgetPeriod,
} from '../budget/budget-setup';
import { validateSavingsRequest, type SavingsRequest } from './savings-form';
export const savingsOwnerKey = (profileId: string) =>
  ['savings', profileId] as const;
export const savingsKey = (profileId: string, month: string) =>
  [...savingsOwnerKey(profileId), month] as const;
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const summarySchema = z.object({
  budget_period_id: z.uuid(),
  base_currency: z.string().regex(/^[A-Z]{3}$/),
  opening_protected_minor: minor,
  allocated_savings_minor: minor,
  contributions_minor: minor,
  withdrawals_minor: minor,
  spendable_allocated_minor: minor,
  spent_minor: minor,
  configured: z.boolean(),
});
export async function readSavingsMonth(
  profileId: string,
  month: string,
  signal?: AbortSignal,
) {
  const { period } = await readBudget(profileId, month, signal);
  if (!period) return { period: null, availability: null, configured: false };
  const query = supabase.rpc('get_savings_availability', {
    p_budget_period_id: period.id,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const row = summarySchema.parse(data);
  if (
    row.budget_period_id !== period.id ||
    row.base_currency !== period.base_currency
  )
    throw new Error('Savings response does not match its period.');
  return {
    period,
    configured: row.configured,
    availability: calculateSavingsAvailability(row.base_currency, {
      openingProtectedMinor: row.opening_protected_minor,
      allocatedSavingsMinor: row.allocated_savings_minor,
      contributionsMinor: row.contributions_minor,
      withdrawalsMinor: row.withdrawals_minor,
      spendableAllocatedMinor: row.spendable_allocated_minor,
      spentMinor: row.spent_minor,
    }),
  };
}
export async function registerSavings(
  period: BudgetPeriod,
  request: SavingsRequest,
) {
  const parsed = validateSavingsRequest(period, request);
  const amount = parseDecimal(
    parsed.form.amount,
    currencyDigits(period.base_currency),
  )!;
  const description = parsed.form.description.trim() || null;
  const { data, error } = await supabase.rpc('register_savings_movement', {
    p_transaction_id: parsed.id,
    p_budget_period_id: period.id,
    p_type: parsed.type,
    p_amount_minor: amount,
    p_currency: period.base_currency,
    p_transaction_date: parsed.form.date,
    p_withdrawal_confirmed: parsed.withdrawalConfirmed,
    ...(description === null ? {} : { p_description: description }),
  });
  if (error) throw error;
  const row = z
    .object({
      id: z.uuid(),
      owner_profile_id: z.uuid(),
      budget_period_id: z.uuid(),
      scope: z.literal('PERSONAL'),
      type: z.enum(['SAVINGS_CONTRIBUTION', 'SAVINGS_WITHDRAWAL']),
      amount_minor: minor.positive(),
      currency: z.string(),
      transaction_date: z.iso.date(),
      category_id: z.null(),
      description: z.string().nullable(),
      deleted_at: z.null(),
      withdrawal_confirmed: z.boolean(),
      savings_validated: z.literal(true),
    })
    .parse(data);
  if (
    row.id !== parsed.id ||
    row.owner_profile_id !== period.profile_id ||
    row.budget_period_id !== period.id ||
    row.type !== parsed.type ||
    row.amount_minor !== amount ||
    row.currency !== period.base_currency ||
    row.transaction_date !== parsed.form.date ||
    row.description !== description ||
    row.withdrawal_confirmed !== parsed.withdrawalConfirmed
  )
    throw new Error('Savings response does not match its request.');
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
