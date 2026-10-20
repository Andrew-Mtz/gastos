import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { calculateCommittedMoney } from '../../domain/recurring/committed-money';
import { type BudgetPeriod } from '../budget/budget-setup';
import { recurringOwnerKey } from './recurring-data';
import { recurringMonthSchema } from './recurring-form';

export const commitmentKey = (profileId: string, periodId: string) =>
  [...recurringOwnerKey(profileId), 'commitments', periodId] as const;
const responseSchema = z.object({
  owner_profile_id: z.uuid(),
  budget_period_id: z.uuid(),
  month: recurringMonthSchema,
  base_currency: z.string(),
  prior_unresolved_count: z.number(),
  buckets: z.array(
    z.object({
      budget_bucket_id: z.uuid(),
      name: z.string().trim().min(1),
      confirmed_minor: z.number(),
      estimated_minor: z.number(),
      confirmed_count: z.number(),
      estimated_count: z.number(),
      unknown_count: z.number(),
    }),
  ),
});
export async function readCommittedMoney(
  period: BudgetPeriod,
  signal?: AbortSignal,
) {
  const id = z.uuid().parse(period.id);
  const query = supabase.rpc('get_personal_committed_money', {
    p_budget_period_id: id,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const parsed = responseSchema.parse(data);
  if (
    parsed.owner_profile_id !== period.profile_id ||
    parsed.budget_period_id !== id ||
    parsed.month !== period.starts_on ||
    parsed.base_currency !== period.base_currency
  )
    throw new Error('Commitment snapshot mismatch.');
  const result = calculateCommittedMoney({
    currency: parsed.base_currency,
    priorUnresolvedCount: parsed.prior_unresolved_count,
    buckets: parsed.buckets.map((b) => ({
      budgetBucketId: b.budget_bucket_id,
      confirmedMinor: b.confirmed_minor,
      estimatedMinor: b.estimated_minor,
      confirmedCount: b.confirmed_count,
      estimatedCount: b.estimated_count,
      unknownCount: b.unknown_count,
    })),
  });
  const names = new Map(
    parsed.buckets.map((b) => [b.budget_bucket_id.toLowerCase(), b.name]),
  );
  return {
    ...result,
    buckets: result.buckets.map((b) => ({
      ...b,
      name: names.get(b.budgetBucketId)!,
    })),
  };
}
export function commitmentErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '23514')
    return 'Hay obligaciones del mes con otra moneda o sin un fondo de gasto válido. No se mostrará un total parcial ni se considerará ese dinero disponible.';
  if (code === '22003')
    return 'Las obligaciones superan el importe que puede calcularse con precisión. No se mostrará un valor aproximado.';
  if (code === '42501')
    return 'No se pudo acceder a los compromisos de este período. Revisa tu sesión.';
  return 'No se pudieron calcular los compromisos. No se considerarán cero; revisa tu conexión e intenta nuevamente.';
}
