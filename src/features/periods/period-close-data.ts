import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { periodSchema } from '../budget/budget-setup';
import { mapDashboard } from '../dashboard/dashboard-data';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { monthSchema } from '../history/history-data';

const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{32}$/);
const lifecyclePeriod = periodSchema.extend({ lifecycle_version: version });
const closureSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  budget_period_id: z.uuid(),
  expected_lifecycle_version: version,
  lifecycle_version: version.positive(),
  snapshot_hash: hash,
  snapshot_version: z.literal(1),
  summary: z.unknown(),
  financial_timezone: z.string().min(1),
  closed_at: z.iso.datetime({ offset: true }),
});
export const reopeningSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  budget_period_id: z.uuid(),
  closure_id: z.uuid().nullable(),
  expected_lifecycle_version: version,
  lifecycle_version: version.positive(),
  closed_state_hash: hash,
  previous_closed_at: z.iso.datetime({ offset: true }),
  reopened_at: z.iso.datetime({ offset: true }),
});
const header = z.object({
  owner_profile_id: z.uuid(),
  month: monthSchema,
  period: lifecyclePeriod.nullable(),
  financial_month: monthSchema,
  financial_timezone: z.string().min(1),
});
const contextSchema = header.extend({
  period: lifecyclePeriod,
  closure: closureSchema.nullable(),
  summary: z.unknown(),
  snapshot_hash: hash.nullable(),
  can_close: z.boolean(),
  reopen_hash: hash.nullable(),
  history: z.object({
    closures: z.array(closureSchema),
    reopenings: z.array(reopeningSchema),
  }),
});
export type LifecycleHistory = z.infer<typeof contextSchema>['history'];
export const periodCloseKey = (owner: string, month: string) =>
  [...recurringOwnerKey(owner), 'period-close', month] as const;
export function mapPeriodClose(owner: string, month: string, value: unknown) {
  const base = header.parse(value);
  if (base.owner_profile_id !== owner || base.month !== month)
    throw new Error('Close owner/month mismatch.');
  if (!base.period) return { ...base, period: null } as const;
  const row = contextSchema.parse(value),
    period = row.period;
  if (period.profile_id !== owner || period.starts_on !== month)
    throw new Error('Close period mismatch.');
  if ((period.status === 'CLOSED') !== (row.reopen_hash !== null))
    throw new Error('Reopen preview mismatch.');
  const versions = new Set<number>();
  for (const event of [...row.history.closures, ...row.history.reopenings]) {
    if (
      event.owner_profile_id !== owner ||
      event.budget_period_id !== period.id ||
      event.lifecycle_version !== event.expected_lifecycle_version + 1 ||
      event.lifecycle_version > period.lifecycle_version ||
      versions.has(event.lifecycle_version)
    )
      throw new Error('Lifecycle history mismatch.');
    versions.add(event.lifecycle_version);
  }
  for (const event of row.history.closures) {
    const facts = mapDashboard(owner, month, event.summary);
    const original = lifecyclePeriod.parse(
      z.object({ period: z.unknown() }).parse(event.summary).period,
    );
    if (
      !facts.period ||
      facts.period.id !== period.id ||
      original.status !== 'OPEN' ||
      original.lifecycle_version !== event.expected_lifecycle_version
    )
      throw new Error('Historical close summary mismatch.');
  }
  for (const event of row.history.reopenings) {
    if (
      event.closure_id !== null &&
      !row.history.closures.some(
        (c) =>
          c.id === event.closure_id &&
          c.lifecycle_version === event.expected_lifecycle_version &&
          c.closed_at === event.previous_closed_at,
      )
    )
      throw new Error('Reopen history link mismatch.');
  }
  const summary =
    row.summary == null ? null : mapDashboard(owner, month, row.summary);
  if (summary && (!summary.period || summary.period.id !== period.id))
    throw new Error('Close summary mismatch.');
  const closure = row.closure;
  if (closure) {
    const stored = lifecyclePeriod.parse(
      z.object({ period: z.unknown() }).parse(closure.summary).period,
    );
    if (
      period.status !== 'CLOSED' ||
      closure.owner_profile_id !== owner ||
      closure.budget_period_id !== period.id ||
      closure.lifecycle_version !== period.lifecycle_version ||
      closure.lifecycle_version !== closure.expected_lifecycle_version + 1 ||
      closure.snapshot_hash !== row.snapshot_hash ||
      stored.lifecycle_version !== closure.expected_lifecycle_version ||
      stored.status !== 'OPEN' ||
      JSON.stringify(closure.summary) !== JSON.stringify(row.summary)
    )
      throw new Error('Close evidence mismatch.');
  }
  if (
    period.status === 'OPEN' &&
    (!summary?.period || !row.snapshot_hash || closure)
  )
    throw new Error('Close preview is incomplete.');
  if (period.status === 'CLOSED' && (summary !== null) !== (closure !== null))
    throw new Error('Closed summary requires evidence.');
  const eligible =
    period.status === 'OPEN' &&
    month < row.financial_month &&
    !!summary?.period &&
    summary.availability.commitments.unresolvedCount === 0 &&
    summary.availability.commitments.priorUnresolvedCount === 0;
  if (row.can_close !== eligible)
    throw new Error('Close eligibility mismatch.');
  return { ...row, summary };
}
export type PeriodCloseContext = ReturnType<typeof mapPeriodClose>;
export type CloseRequest = Readonly<{
  id: string;
  owner: string;
  periodId: string;
  month: string;
  version: number;
  hash: string;
}>;
export function buildCloseRequest(
  id: string,
  context: PeriodCloseContext,
): CloseRequest {
  if (
    !context.period ||
    !('can_close' in context) ||
    !context.can_close ||
    !context.snapshot_hash
  )
    throw new Error('An eligible current preview is required.');
  return {
    id: z.uuid().parse(id),
    owner: context.owner_profile_id,
    periodId: context.period.id,
    month: context.month,
    version: context.period.lifecycle_version,
    hash: context.snapshot_hash,
  };
}
export async function readPeriodClose(
  owner: string,
  month: string,
  signal?: AbortSignal,
) {
  z.uuid().parse(owner);
  const query = supabase.rpc('get_personal_period_close_context', {
    p_month: monthSchema.parse(month),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapPeriodClose(owner, month, data);
}
export async function closePeriod(request: CloseRequest) {
  const { data, error } = await supabase.rpc('close_personal_budget_period', {
    p_id: z.uuid().parse(request.id),
    p_budget_period_id: z.uuid().parse(request.periodId),
    p_expected_lifecycle_version: version.parse(request.version),
    p_snapshot_hash: hash.parse(request.hash),
    p_confirmed: true,
  });
  if (error) throw error;
  const row = closureSchema.parse(data);
  if (
    row.id !== request.id ||
    row.owner_profile_id !== request.owner ||
    row.budget_period_id !== request.periodId ||
    row.expected_lifecycle_version !== request.version ||
    row.lifecycle_version !== request.version + 1 ||
    row.snapshot_hash !== request.hash
  )
    throw new Error('Close result does not match request.');
  const summary = mapDashboard(request.owner, request.month, row.summary);
  if (
    !summary.period ||
    summary.period.id !== request.periodId ||
    summary.period.status !== 'OPEN'
  )
    throw new Error('Close result summary mismatch.');
  return row;
}
function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}
export function isRejectedClose(error: unknown) {
  return [
    '42501',
    '22023',
    '23514',
    '23505',
    '40001',
    '22003',
    '25001',
  ].includes(errorCode(error) ?? '');
}
export function closeErrorMessage(error: unknown) {
  const code = errorCode(error);
  if (code === '40001' || code === '23505')
    return 'El período o el resumen cambió. Actualiza y vuelve a revisar antes de cerrar.';
  if (code === '23514')
    return 'Solo puedes cerrar un mes terminado sin obligaciones pendientes actuales ni anteriores. Revisa sus registros; no cambies fechas para omitir pendientes.';
  if (code === '42501')
    return 'No se pudo acceder al período. Revisa tu sesión.';
  return 'No se pudo confirmar el cierre. Comprueba la misma solicitud antes de intentar otro cierre.';
}

export type ReopenRequest = CloseRequest;
export function buildReopenRequest(
  id: string,
  context: PeriodCloseContext,
): ReopenRequest {
  if (
    !context.period ||
    !('reopen_hash' in context) ||
    context.period.status !== 'CLOSED' ||
    !context.reopen_hash
  )
    throw new Error('A current closed-period preview is required.');
  return {
    id: z.uuid().parse(id),
    owner: context.owner_profile_id,
    periodId: context.period.id,
    month: context.month,
    version: context.period.lifecycle_version,
    hash: context.reopen_hash,
  };
}
export async function reopenPeriod(request: ReopenRequest) {
  const { data, error } = await supabase.rpc('reopen_personal_budget_period', {
    p_id: z.uuid().parse(request.id),
    p_budget_period_id: z.uuid().parse(request.periodId),
    p_expected_lifecycle_version: version.parse(request.version),
    p_closed_state_hash: hash.parse(request.hash),
    p_confirmed: true,
  });
  if (error) throw error;
  const row = reopeningSchema.parse(data);
  if (
    row.id !== request.id ||
    row.owner_profile_id !== request.owner ||
    row.budget_period_id !== request.periodId ||
    row.expected_lifecycle_version !== request.version ||
    row.lifecycle_version !== request.version + 1 ||
    row.closed_state_hash !== request.hash
  )
    throw new Error('Reopen result does not match request.');
  return row;
}
export function reopenErrorMessage(error: unknown) {
  const code = errorCode(error);
  if (code === '40001' || code === '23505')
    return 'El estado del período cambió. Actualiza y vuelve a revisar antes de reabrir.';
  if (code === '42501')
    return 'No se pudo acceder al período. Revisa tu sesión.';
  return 'No se pudo confirmar la reapertura. Comprueba la misma solicitud antes de intentar otra.';
}
export type PendingLifecycle = Readonly<{
  kind: 'close' | 'reopen';
  request: CloseRequest;
  inFlight: boolean;
}>;
export const pendingLifecycleKey = (owner: string) =>
  ['pending-period-lifecycle', owner] as const;
