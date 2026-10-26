import { z } from 'zod';
import { createMoney } from '../../domain/money/money';
import { supabase } from '../../infrastructure/supabase/client';
import { calculateSavingsAvailability } from '../../domain/savings/savings-availability';
import { createTransaction } from '../../domain/transaction/transaction';
import { periodSchema } from '../budget/budget-setup';
import { mapSharedResponsibilities } from '../budget/shared-responsibility-data';
import { recurringMonthSchema } from '../recurring/recurring-form';
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
const legacySavingsSummarySchema = z.object({
  budget_period_id: z.uuid(),
  base_currency: z.string().regex(/^[A-Z]{3}$/),
  opening_protected_minor: minor,
  allocated_savings_minor: minor,
  contributions_minor: minor,
  withdrawals_minor: minor,
  spendable_allocated_minor: minor,
  spent_minor: minor,
  configured: z.boolean(),
  goal_reserved_minor: minor,
  unassigned_savings_minor: minor,
});
export const carrySchema = z.object({
  incoming_minor: minor,
  outgoing_minor: minor,
  unallocated_minor: minor,
  buckets: z.array(
    z.object({ budget_bucket_id: z.uuid(), amount_minor: minor.positive() }),
  ),
});
export const savingsSummarySchema = legacySavingsSummarySchema.extend({
  snapshot_version: z.literal(2),
  carry: carrySchema,
});
export function parseSavingsSummary(data: unknown, snapshotVersion: 1 | 2 = 2) {
  if (snapshotVersion === 2) {
    const row = savingsSummarySchema.parse(data);
    const ids = new Set(row.carry.buckets.map((b) => b.budget_bucket_id));
    const total = row.carry.buckets.reduce(
      (sum, b) => sum + b.amount_minor,
      row.carry.unallocated_minor,
    );
    if (
      ids.size !== row.carry.buckets.length ||
      !Number.isSafeInteger(total) ||
      total !== row.carry.incoming_minor
    )
      throw new Error(
        'Carry buckets and unallocated credit must partition incoming carry.',
      );
    return row;
  }
  // Only explicitly versioned v1 immutable close evidence may lack carry.
  const row = legacySavingsSummarySchema.strict().parse(data);
  return {
    ...row,
    snapshot_version: 2 as const,
    carry: {
      incoming_minor: 0,
      outgoing_minor: 0,
      unallocated_minor: 0,
      buckets: [],
    },
  };
}
const reserveSchema = legacySavingsSummarySchema.omit({ spent_minor: true });
export function mapSavingsContext(
  profileId: string,
  month: string,
  value: unknown,
) {
  const data = z
    .object({
      owner_profile_id: z.uuid(),
      month: recurringMonthSchema,
      period: periodSchema.nullable(),
      reserve: reserveSchema.nullable(),
      availability: z.unknown(),
      shared_responsibilities: z.unknown(),
    })
    .parse(value);
  if (data.owner_profile_id !== profileId || data.month !== month)
    throw new Error('Savings context identity mismatch.');
  const sharedResponsibilities = mapSharedResponsibilities(
    profileId,
    month,
    data.shared_responsibilities,
  );
  const period = data.period;
  if (
    sharedResponsibilities.period?.id !== period?.id ||
    sharedResponsibilities.period?.status !== period?.status ||
    sharedResponsibilities.period?.base_currency !== period?.base_currency
  )
    throw new Error('Savings source context mismatch.');
  if (!period) {
    if (data.reserve !== null || data.availability !== null)
      throw new Error('Missing period cannot have savings.');
    return {
      period: null,
      availability: null,
      protectedSavings: null,
      configured: false,
      sharedResponsibilities,
    } as const;
  }
  const row = reserveSchema.parse(data.reserve);
  if (
    period.profile_id !== profileId ||
    period.starts_on !== month ||
    row.budget_period_id !== period.id ||
    row.base_currency !== period.base_currency
  )
    throw new Error('Savings response does not match its period.');
  const protectedMinor =
    row.opening_protected_minor +
    row.allocated_savings_minor +
    row.contributions_minor -
    row.withdrawals_minor;
  if (
    !Number.isSafeInteger(protectedMinor) ||
    protectedMinor < 0 ||
    !Number.isSafeInteger(
      row.goal_reserved_minor + row.unassigned_savings_minor,
    ) ||
    row.goal_reserved_minor + row.unassigned_savings_minor !== protectedMinor
  )
    throw new Error('Goal reserves must partition protected savings.');
  const incomplete =
    period.status === 'OPEN' &&
    sharedResponsibilities.entries.some(
      (e) =>
        e.responsibility_amount_minor > 0 && e.application_status !== 'APPLIED',
    );
  if ((data.availability === null) !== incomplete)
    throw new Error('Savings completeness mismatch.');
  let availability = null;
  if (data.availability !== null) {
    const full = parseSavingsSummary(data.availability);
    for (const key of Object.keys(row) as (keyof typeof row)[])
      if (full[key] !== row[key])
        throw new Error('Savings reserve disagrees with availability.');
    availability = calculateSavingsAvailability(
      row.base_currency,
      {
        openingProtectedMinor: row.opening_protected_minor,
        allocatedSavingsMinor: row.allocated_savings_minor,
        contributionsMinor: row.contributions_minor,
        withdrawalsMinor: row.withdrawals_minor,
        spendableAllocatedMinor: row.spendable_allocated_minor,
        spentMinor: full.spent_minor,
      },
      {
        incomingMinor: full.carry.incoming_minor,
        outgoingMinor: full.carry.outgoing_minor,
      },
    );
  }
  return {
    period,
    sharedResponsibilities,
    configured: row.configured,
    availability,
    protectedSavings: createMoney(protectedMinor, row.base_currency),
    goalReserved: createMoney(row.goal_reserved_minor, row.base_currency),
    unassignedSavings: createMoney(
      row.unassigned_savings_minor,
      row.base_currency,
    ),
  };
}
export async function readSavingsMonth(
  profileId: string,
  month: string,
  signal?: AbortSignal,
) {
  z.uuid().parse(profileId);
  const query = supabase.rpc('get_personal_savings_context', {
    p_month: recurringMonthSchema.parse(month),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapSavingsContext(profileId, month, data);
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
    ...(parsed.savingsGoalId
      ? { p_savings_goal_id: parsed.savingsGoalId }
      : {}),
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
      savings_goal_id: z.uuid().nullable(),
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
    row.withdrawal_confirmed !== parsed.withdrawalConfirmed ||
    row.savings_goal_id !== (parsed.savingsGoalId ?? null)
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
