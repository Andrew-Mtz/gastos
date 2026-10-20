import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import {
  allocationSchema,
  bucketSchema,
  periodSchema,
  setupPreview,
  type BudgetBucket,
  type SetupForm,
} from './budget-setup';

export const budgetKey = (profileId: string, startsOn: string) =>
  ['budget-setup', profileId, startsOn] as const;
export async function readBudget(
  profileId: string,
  startsOn: string,
  signal?: AbortSignal,
) {
  const periodQuery = supabase
    .from('budget_periods')
    .select('*')
    .eq('profile_id', profileId)
    .eq('starts_on', startsOn);
  const { data, error } = await (
    signal ? periodQuery.abortSignal(signal) : periodQuery
  ).maybeSingle();
  if (error) throw error;
  const period = data ? periodSchema.parse(data) : null;
  if (!period) return { period: null, buckets: [], allocations: [] };
  let bucketQuery = supabase
    .from('budget_buckets')
    .select('*')
    .eq('profile_id', profileId);
  let allocationQuery = supabase
    .from('budget_allocations')
    .select('budget_period_id,budget_bucket_id,percentage_basis_points')
    .eq('budget_period_id', period.id)
    .is('deleted_at', null);
  if (signal) {
    bucketQuery = bucketQuery.abortSignal(signal);
    allocationQuery = allocationQuery.abortSignal(signal);
  }
  const [buckets, allocations] = await Promise.all([
    bucketQuery,
    allocationQuery,
  ]);
  if (buckets.error) throw buckets.error;
  if (allocations.error) throw allocations.error;
  return {
    period,
    buckets: z.array(bucketSchema).parse(buckets.data),
    allocations: z.array(allocationSchema).parse(allocations.data),
  };
}
export async function prepareBudgetBuckets() {
  const { data, error } = await supabase.rpc('prepare_initial_budget_buckets');
  if (error) throw error;
  return z.array(bucketSchema).length(3).parse(data);
}
export async function saveInitialBudget(
  startsOn: string,
  currency: string,
  buckets: BudgetBucket[],
  form: SetupForm,
) {
  const preview = setupPreview(currency, buckets, form);
  const { data, error } = await supabase.rpc('save_initial_budget', {
    p_starts_on: z.iso.date().parse(startsOn),
    p_base_currency: currency,
    ...(preview.expectedIncomeMinor === null
      ? {}
      : { p_expected_income_minor: preview.expectedIncomeMinor }),
    p_allocations: preview.allocations.map((allocation) => ({
      budget_bucket_id: allocation.budgetBucketId,
      percentage_basis_points: allocation.percentageBasisPoints,
    })),
  });
  if (error) throw error;
  return periodSchema.parse(data);
}
export function budgetErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '23505')
    return 'Este mes ya tiene un presupuesto. Cancela y actualiza para ver el plan guardado.';
  if (code === '42501')
    return 'No se puede guardar este presupuesto. Revisa tu sesión y que el período esté abierto.';
  if (code === '23514' || code === '22023')
    return 'Revisa los importes, la moneda y los porcentajes antes de guardar.';
  return 'No se pudo completar la operación. Revisa tu conexión e intenta nuevamente.';
}
