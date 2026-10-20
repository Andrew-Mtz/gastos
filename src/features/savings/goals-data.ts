import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import {
  goalProgress,
  savingsGoalSchema,
} from '../../domain/savings/savings-goal';
import { createTransaction } from '../../domain/transaction/transaction';
import { currencyDigits, parseDecimal } from '../budget/budget-setup';
import { monthBounds, type HistoryCursor } from '../history/history-data';
import { savingsOwnerKey } from './savings-data';
import { validateGoalRequest, type GoalRequest } from './goals-form';

export const goalsKey = (profileId: string, month: string) =>
  [...savingsOwnerKey(profileId), 'goals', month] as const;
export const goalHistoryKey = (
  profileId: string,
  goalId: string,
  month: string,
) => [...savingsOwnerKey(profileId), 'goal-history', goalId, month] as const;
const fundedGoalSchema = savingsGoalSchema.extend({
  balance_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export async function readSavingsGoals(
  profileId: string,
  month: string,
  signal?: AbortSignal,
) {
  z.uuid().parse(profileId);
  monthBounds(month);
  const query = supabase.rpc('get_personal_savings_goals', {
    p_through_month: month,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const result = z
    .object({
      owner_profile_id: z.uuid(),
      through_month: z.iso.date(),
      goals: z.array(fundedGoalSchema),
    })
    .parse(data);
  if (
    result.owner_profile_id !== profileId ||
    result.through_month !== month ||
    result.goals.some((goal) => goal.owner_profile_id !== profileId) ||
    new Set(result.goals.map((goal) => goal.id)).size !== result.goals.length
  )
    throw new Error('Goals response does not match its owner or month.');
  return result.goals.map((goal) => ({
    ...goal,
    progress: goalProgress(
      goal.target_amount_minor,
      goal.balance_minor,
      goal.currency,
    ),
  }));
}
export async function createSavingsGoal(
  profileId: string,
  request: GoalRequest,
) {
  z.uuid().parse(profileId);
  const { id, form } = validateGoalRequest(request);
  const target = parseDecimal(form.target, currencyDigits(form.currency))!;
  const { data, error } = await supabase.rpc('create_personal_savings_goal', {
    p_goal_id: id,
    p_name: form.name,
    p_target_amount_minor: target,
    p_currency: form.currency,
    ...(form.targetDate ? { p_target_date: form.targetDate } : {}),
  });
  if (error) throw error;
  const goal = savingsGoalSchema.parse(data);
  if (
    goal.id !== id ||
    goal.owner_profile_id !== profileId ||
    goal.name !== form.name ||
    goal.target_amount_minor !== target ||
    goal.currency !== form.currency ||
    goal.target_date !== (form.targetDate || null)
  )
    throw new Error('Goal response does not match its request.');
  return goal;
}
const movementSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  budget_period_id: z.uuid(),
  scope: z.literal('PERSONAL'),
  savings_goal_id: z.uuid(),
  type: z.enum(['SAVINGS_CONTRIBUTION', 'SAVINGS_WITHDRAWAL']),
  amount_minor: z.number(),
  currency: z.string(),
  transaction_date: z.iso.date(),
  description: z.string().nullable(),
  deleted_at: z.null(),
  category_id: z.null(),
  savings_validated: z.literal(true),
});
export async function readGoalHistory(
  profileId: string,
  goalId: string,
  month: string,
  cursor: HistoryCursor | null,
  signal?: AbortSignal,
) {
  z.uuid().parse(profileId);
  z.uuid().parse(goalId);
  const { end } = monthBounds(month);
  let query = supabase
    .from('transactions')
    .select('*')
    .eq('owner_profile_id', profileId)
    .eq('savings_goal_id', goalId)
    .is('deleted_at', null)
    .lte('transaction_date', end)
    .order('transaction_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(51);
  if (cursor) {
    const parsed = z.object({ date: z.iso.date(), id: z.uuid() }).parse(cursor);
    query = query.or(
      `transaction_date.lt.${parsed.date},and(transaction_date.eq.${parsed.date},id.lt.${parsed.id})`,
    );
  }
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const rows = z.array(movementSchema).parse(data);
  if (
    rows.some(
      (row) =>
        row.owner_profile_id !== profileId ||
        row.savings_goal_id !== goalId ||
        row.transaction_date > end,
    )
  )
    throw new Error('Goal history response mismatch.');
  const items = rows.slice(0, 50).map((row) =>
    createTransaction({
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
    }),
  );
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > 50 && last
        ? { id: last.id, date: last.transactionDate }
        : null,
  };
}
