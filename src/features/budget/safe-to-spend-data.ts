import { z } from 'zod';
import { calculateSafeToSpend } from '../../domain/budget/safe-to-spend';
import { supabase } from '../../infrastructure/supabase/client';
import { commitmentSnapshotSchema } from '../recurring/commitment-data';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { savingsSummarySchema } from '../savings/savings-data';
import { type BudgetPeriod } from './budget-setup';

// Every relevant mutation already invalidates this owner-wide financial family,
// including template-only changes and cross-month savings/goal corrections.
export const safeToSpendKey = (owner: string, periodId: string) =>
  [...recurringOwnerKey(owner), 'safe-to-spend', periodId] as const;
const snapshotSchema = z.object({
  savings: savingsSummarySchema,
  commitments: commitmentSnapshotSchema,
});
export async function readSafeToSpend(
  period: BudgetPeriod,
  signal?: AbortSignal,
) {
  const query = supabase.rpc('get_personal_safe_to_spend', {
    p_budget_period_id: z.uuid().parse(period.id),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const { savings: s, commitments: c } = snapshotSchema.parse(data);
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
export function safeToSpendErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '23514')
    return 'Hay datos incompatibles de moneda, fondos o ahorro. No se mostrará un margen parcial; revisa los registros.';
  if (code === '22003')
    return 'El margen supera los importes que pueden calcularse con precisión. No se mostrará una aproximación.';
  if (code === '42501')
    return 'No se pudo acceder a este período. Revisa tu sesión.';
  return 'No se pudo calcular el margen. No se considerarán cero los gastos ni compromisos; intenta nuevamente.';
}
