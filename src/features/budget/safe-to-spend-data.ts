import { z } from 'zod';
import { calculateSafeToSpend } from '../../domain/budget/safe-to-spend';
import { supabase } from '../../infrastructure/supabase/client';
import { commitmentSnapshotSchema } from '../recurring/commitment-data';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { parseSavingsSummary } from '../savings/savings-data';
import { type BudgetPeriod } from './budget-setup';
import { MarginReadError, marginRpcError } from './margin-read-error';

export { safeToSpendErrorMessage } from './margin-read-error';

// Every relevant mutation already invalidates this owner-wide financial family,
// including template-only changes and cross-month savings/goal corrections.
export const safeToSpendKey = (owner: string, periodId: string) =>
  [...recurringOwnerKey(owner), 'safe-to-spend', periodId] as const;
const snapshotSchema = z.object({
  savings: z.unknown(),
  commitments: commitmentSnapshotSchema,
});
export async function readSafeToSpend(
  period: BudgetPeriod,
  signal?: AbortSignal,
) {
  const periodId = z.uuid().parse(period.id);
  let response;
  try {
    const query = supabase.rpc('get_personal_safe_to_spend', {
      p_budget_period_id: periodId,
    });
    response = await (signal ? query.abortSignal(signal) : query);
  } catch {
    throw new MarginReadError('TRANSPORT');
  }
  if (response.error) throw marginRpcError(response.error, response.status);
  try {
    return mapSafeToSpend(period, response.data);
  } catch {
    throw new MarginReadError('INVALID_CONTRACT');
  }
}
export function mapSafeToSpend(
  period: BudgetPeriod,
  data: unknown,
  snapshotVersion: 1 | 2 = 2,
) {
  const { savings, commitments: c } = snapshotSchema.parse(data);
  const s = parseSavingsSummary(savings, snapshotVersion);
  if (
    s.budget_period_id !== period.id ||
    c.budget_period_id !== period.id ||
    s.base_currency !== period.base_currency ||
    c.base_currency !== period.base_currency ||
    c.owner_profile_id !== period.profile_id ||
    c.month !== period.starts_on
  )
    throw new Error('Availability snapshot mismatch.');
  const result = calculateSafeToSpend({
    configured: s.configured,
    carry: {
      incomingMinor: s.carry.incoming_minor,
      outgoingMinor: s.carry.outgoing_minor,
    },
    savings: {
      openingProtectedMinor: s.opening_protected_minor,
      allocatedSavingsMinor: s.allocated_savings_minor,
      contributionsMinor: s.contributions_minor,
      withdrawalsMinor: s.withdrawals_minor,
      spendableAllocatedMinor: s.spendable_allocated_minor,
      spentMinor: s.spent_minor,
    },
    commitments: {
      currency: c.base_currency,
      priorUnresolvedCount: c.prior_unresolved_count,
      buckets: c.buckets.map((b) => ({
        budgetBucketId: b.budget_bucket_id,
        confirmedMinor: b.confirmed_minor,
        estimatedMinor: b.estimated_minor,
        confirmedCount: b.confirmed_count,
        estimatedCount: b.estimated_count,
        unknownCount: b.unknown_count,
      })),
    },
  });
  const partition = s.goal_reserved_minor + s.unassigned_savings_minor;
  if (
    !Number.isSafeInteger(partition) ||
    partition !== result.savings.protectedSavings.amountMinor
  )
    throw new Error('Goal reserves must partition protected savings.');
  return { ...result, components: s };
}
