import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import {
  bucketSchema,
  periodSchema,
  parseDecimal,
  currencyDigits,
} from '../budget/budget-setup';
import { mapDashboard } from '../dashboard/dashboard-data';
import { monthSchema, shiftMonth } from '../history/history-data';
import { recurringOwnerKey } from '../recurring/recurring-data';
import {
  mapPeriodClose,
  reopeningSchema,
  type CloseRequest,
} from './period-close-data';
import {
  dispositionSchema,
  reversalSchema,
  dispositionActionSchema,
} from './remainder-schema';

const hash = z.string().regex(/^[a-f0-9]{32}$/);
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const destinationSchema = periodSchema.extend({ lifecycle_version: version });
const envelope = z.object({
  close: z.unknown(),
  preview_hash: hash,
  destination: destinationSchema.nullable(),
  destination_configured: z.boolean(),
  destination_buckets: z.array(bucketSchema),
  dispositions: z.array(dispositionSchema),
  reversals: z.array(reversalSchema),
});
export function mapRemainder(owner: string, month: string, data: unknown) {
  const row = envelope.parse(data),
    close = mapPeriodClose(owner, month, row.close);
  if (!close.period || !('summary' in close))
    throw new Error('A source period is required.');
  if (
    (row.destination &&
      (month === '9999-12-01' ||
        row.destination.profile_id !== owner ||
        row.destination.starts_on !== shiftMonth(month, 1))) ||
    row.destination_buckets.some(
      (b) =>
        b.profile_id !== owner ||
        b.type !== 'SPENDABLE' ||
        b.archived_at !== null,
    ) ||
    new Set(row.destination_buckets.map((b) => b.id)).size !==
      row.destination_buckets.length ||
    JSON.stringify(row.dispositions) !==
      JSON.stringify(close.history.dispositions) ||
    JSON.stringify(row.reversals) !== JSON.stringify(close.history.reversals)
  )
    throw new Error('Remainder context mismatch.');
  const cap =
    close.period.status === 'OPEN' &&
    close.can_close &&
    close.summary?.period &&
    close.summary.availability.configured
      ? close.summary.availability.savings.ordinaryRemainderBeforeCommitments
      : null;
  return { ...row, close, cap };
}
export type RemainderContext = ReturnType<typeof mapRemainder>;
export const remainderKey = (owner: string, month: string) =>
  [...recurringOwnerKey(owner), 'remainder', month] as const;
export async function readRemainder(
  owner: string,
  month: string,
  signal?: AbortSignal,
) {
  z.uuid().parse(owner);
  const query = supabase.rpc('get_personal_remainder_context', {
    p_month: monthSchema.parse(month),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapRemainder(owner, month, data);
}
export type DisposeRequest = CloseRequest &
  Readonly<{
    action: z.infer<typeof dispositionActionSchema>;
    amount: number;
    currency: string;
    destinationPeriodId: string | null;
    destinationBucketId: string | null;
  }>;
export function buildDisposeRequest(
  id: string,
  context: RemainderContext,
  action: DisposeRequest['action'],
  amountText: string,
  bucketId: string | null,
): DisposeRequest {
  const source = context.close.period;
  const amount = parseDecimal(amountText, currencyDigits(source.base_currency));
  dispositionActionSchema.parse(action);
  if (
    amount === null ||
    amount <= 0 ||
    !context.cap ||
    amount > context.cap.amountMinor
  )
    throw new Error(
      'El importe debe ser positivo y no superar el remanente neto.',
    );
  if (
    action !== 'SAVINGS' &&
    (!context.destination ||
      !context.destination_configured ||
      context.destination.status !== 'OPEN' ||
      context.destination.base_currency !== source.base_currency)
  )
    throw new Error(
      'Configura y abre el mes siguiente con la misma moneda antes de arrastrar dinero.',
    );
  if (
    (action === 'CARRY_BUCKET' &&
      !context.destination_buckets.some((b) => b.id === bucketId)) ||
    (action !== 'CARRY_BUCKET' && bucketId !== null)
  )
    throw new Error('Elige explícitamente un fondo de destino válido.');
  return {
    id: z.uuid().parse(id),
    owner: context.close.owner_profile_id,
    periodId: source.id,
    month: context.close.month,
    version: source.lifecycle_version,
    hash: context.preview_hash,
    action,
    amount,
    currency: source.base_currency,
    destinationPeriodId: action === 'SAVINGS' ? null : context.destination!.id,
    destinationBucketId: bucketId,
  };
}
export async function disposeRemainder(request: DisposeRequest) {
  const { data, error } = await supabase.rpc(
    'close_and_dispose_personal_remainder',
    {
      p_id: z.uuid().parse(request.id),
      p_budget_period_id: z.uuid().parse(request.periodId),
      p_expected_lifecycle_version: version.parse(request.version),
      p_preview_hash: hash.parse(request.hash),
      p_action: dispositionActionSchema.parse(request.action),
      p_amount_minor: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse(request.amount),
      p_destination_period_id: request.destinationPeriodId ?? undefined,
      p_destination_bucket_id: request.destinationBucketId ?? undefined,
      p_confirmed: true,
    },
  );
  if (error) throw error;
  const result = z
      .object({ disposition: dispositionSchema, closure: z.unknown() })
      .parse(data),
    d = result.disposition;
  if (
    d.id !== request.id ||
    d.owner_profile_id !== request.owner ||
    d.source_period_id !== request.periodId ||
    d.currency !== request.currency ||
    d.request_payload.version !== request.version ||
    d.request_payload.preview_hash !== request.hash ||
    d.action !== request.action ||
    d.amount_minor !== request.amount ||
    d.destination_period_id !== request.destinationPeriodId ||
    d.destination_bucket_id !== request.destinationBucketId
  )
    throw new Error('Disposition result mismatch.');
  const c = z
    .object({
      id: z.uuid(),
      owner_profile_id: z.uuid(),
      budget_period_id: z.uuid(),
      expected_lifecycle_version: version,
      lifecycle_version: version,
      snapshot_version: z.literal(2),
      summary: z.unknown(),
    })
    .parse(result.closure);
  const facts = mapDashboard(request.owner, request.month, c.summary);
  if (
    c.id !== d.closure_id ||
    c.owner_profile_id !== request.owner ||
    c.budget_period_id !== request.periodId ||
    c.expected_lifecycle_version !== request.version ||
    c.lifecycle_version !== request.version + 1 ||
    !facts.period ||
    facts.period.id !== request.periodId
  )
    throw new Error('Disposition close result mismatch.');
  return result;
}
const reversalEnvelope = z.object({
  disposition: dispositionSchema,
  source: z.unknown(),
  destination: z.unknown(),
  can_reverse: z.boolean(),
  preview_hash: hash,
});
export function mapReversal(
  owner: string,
  dispositionId: string,
  data: unknown,
) {
  const row = reversalEnvelope.parse(data),
    d = row.disposition;
  const sourceMonth = z.object({ month: monthSchema }).parse(row.source).month;
  const source = mapPeriodClose(owner, sourceMonth, row.source);
  if (!source.period || !('history' in source))
    throw new Error('Reversal source missing.');
  const destination = mapDashboard(
    owner,
    shiftMonth(sourceMonth, 1),
    row.destination,
  );
  const destinationPeriod = destinationSchema.parse(
    z.object({ period: z.unknown() }).parse(row.destination).period,
  );
  if (
    d.id !== dispositionId ||
    d.owner_profile_id !== owner ||
    d.action === 'SAVINGS' ||
    d.source_period_id !== source.period.id ||
    !source.history.dispositions.some(
      (saved) => JSON.stringify(saved) === JSON.stringify(d),
    ) ||
    !destination.period ||
    !destination.sharedResponsibilities ||
    d.destination_period_id !== destination.period.id
  )
    throw new Error('Reversal references mismatch.');
  const available = destination.availability;
  const eligible =
    source.period.status === 'CLOSED' &&
    destination.period.status === 'OPEN' &&
    available.configured &&
    available.commitments.unresolvedCount === 0 &&
    available.commitments.priorUnresolvedCount === 0 &&
    available.savings.ordinaryRemainderBeforeCommitments.amountMinor >=
      d.amount_minor &&
    !source.history.reversals.some((r) => r.disposition_id === d.id);
  if (eligible !== row.can_reverse)
    throw new Error('Reversal eligibility mismatch.');
  return { ...row, source, destination, destinationPeriod };
}
export type ReversalContext = ReturnType<typeof mapReversal>;
export const reversalKey = (owner: string, dispositionId: string) =>
  [...recurringOwnerKey(owner), 'carry-reversal', dispositionId] as const;
export async function readReversal(
  owner: string,
  dispositionId: string,
  signal?: AbortSignal,
) {
  const query = supabase.rpc('get_personal_carry_reversal_context', {
    p_disposition_id: z.uuid().parse(dispositionId),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapReversal(owner, dispositionId, data);
}
export type ReverseRequest = CloseRequest &
  Readonly<{
    dispositionId: string;
    destinationVersion: number;
    destinationMonth: string;
    amount: number;
    currency: string;
  }>;
export function buildReverseRequest(
  id: string,
  context: ReversalContext,
): ReverseRequest {
  if (!context.can_reverse)
    throw new Error('La reversión no está disponible con estos datos.');
  return {
    id: z.uuid().parse(id),
    owner: context.source.owner_profile_id,
    periodId: context.source.period.id,
    month: context.source.month,
    version: context.source.period.lifecycle_version,
    hash: context.preview_hash,
    dispositionId: context.disposition.id,
    destinationVersion: context.destinationPeriod.lifecycle_version,
    destinationMonth: context.destinationPeriod.starts_on,
    amount: context.disposition.amount_minor,
    currency: context.disposition.currency,
  };
}
export async function reverseCarry(request: ReverseRequest) {
  const { data, error } = await supabase.rpc(
    'reverse_carry_and_reopen_personal_period',
    {
      p_id: z.uuid().parse(request.id),
      p_disposition_id: z.uuid().parse(request.dispositionId),
      p_expected_source_version: version.parse(request.version),
      p_expected_destination_version: version.parse(request.destinationVersion),
      p_preview_hash: hash.parse(request.hash),
      p_confirmed: true,
    },
  );
  if (error) throw error;
  const result = z
      .object({ reversal: reversalSchema, reopening: reopeningSchema })
      .parse(data),
    r = result.reversal,
    p = r.request_payload;
  if (
    r.id !== request.id ||
    r.owner_profile_id !== request.owner ||
    p.disposition_id !== request.dispositionId ||
    p.source_version !== request.version ||
    p.destination_version !== request.destinationVersion ||
    p.preview_hash !== request.hash ||
    result.reopening.id !== request.id ||
    result.reopening.owner_profile_id !== request.owner ||
    result.reopening.budget_period_id !== request.periodId ||
    result.reopening.closure_id !== request.dispositionId ||
    result.reopening.expected_lifecycle_version !== request.version ||
    result.reopening.lifecycle_version !== request.version + 1
  )
    throw new Error('Reversal and reopening result mismatch.');
  return result;
}
export function remainderErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : null;
  if (code === '40001' || code === '23505')
    return 'Los datos o la solicitud cambiaron. Actualiza y revisa otra vez; no se aplicará una acción nueva automáticamente.';
  if (code === '23514')
    return 'No se cumplen las condiciones: revisa el remanente neto, las obligaciones y los estados de ambos meses. No se usarán ahorros ni se cancelarán pendientes automáticamente.';
  if (code === '42501')
    return 'No se pudo acceder a los períodos. Revisa tu sesión.';
  return 'No se pudo confirmar el resultado. Comprueba la misma solicitud antes de iniciar otra.';
}
