import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { calculateBucketConsumption } from '../../domain/budget/bucket-consumption';

export const consumptionOwnerKey = (profileId: string) =>
  ['bucket-consumption', profileId] as const;
export const consumptionKey = (profileId: string, periodId: string) =>
  [...consumptionOwnerKey(profileId), periodId] as const;
export const consumptionSnapshotSchema = z.object({
  budget_period_id: z.uuid(),
  base_currency: z.string().regex(/^[A-Z]{3}$/),
  buckets: z.array(
    z.object({
      budget_bucket_id: z.uuid(),
      name: z.string().trim().min(1),
      system_key: z.enum(['NEEDS', 'LEISURE', 'SAVINGS']).nullable(),
      spent_minor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
  ),
});
export async function readBucketConsumption(
  periodId: string,
  currency: string,
  signal?: AbortSignal,
) {
  const id = z.uuid().parse(periodId).toLowerCase();
  const query = supabase.rpc('get_bucket_consumption', {
    p_budget_period_id: id,
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const parsed = consumptionSnapshotSchema.parse(data);
  if (
    parsed.budget_period_id.toLowerCase() !== id ||
    parsed.base_currency !== currency
  )
    throw new Error('Consumption response does not match its period.');
  const result = calculateBucketConsumption(
    currency,
    parsed.buckets.map((item) => ({
      budgetBucketId: item.budget_bucket_id,
      spentMinor: item.spent_minor,
    })),
  );
  const metadata = new Map(
    parsed.buckets.map((item) => [item.budget_bucket_id.toLowerCase(), item]),
  );
  return {
    totalSpent: result.totalSpent,
    buckets: result.buckets.map((item) => ({
      ...item,
      name: metadata.get(item.budgetBucketId)!.name,
      systemKey: metadata.get(item.budgetBucketId)!.system_key,
    })),
  };
}
export function consumptionErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '23514')
    return 'Hay gastos históricos con otra moneda o sin un fondo de gasto válido. Revisa el historial; no se mostrará un total incompleto.';
  if (code === '22003')
    return 'El total supera el importe que puede calcularse con precisión. No se mostrará un valor aproximado.';
  if (code === '42501')
    return 'No se pudo acceder al consumo de este período. Revisa tu sesión.';
  return 'No se pudo calcular el consumo. Revisa tu conexión e intenta nuevamente.';
}
