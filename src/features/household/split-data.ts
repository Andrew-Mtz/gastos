import { z } from 'zod';
import {
  createHouseholdSplit,
  sameHouseholdRoster,
} from '../../domain/household/default-split';
import { supabase } from '../../infrastructure/supabase/client';
import { decimalText, parseDecimal } from '../budget/budget-setup';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const shareSchema = z.strictObject({
  member_id: uuid,
  basis_points: z.number().int().min(0).max(10000),
});
const templateSchema = z.strictObject({
  id: uuid,
  version: z.number().int().min(1).max(2147483647),
  roster: z.array(uuid).min(1),
  shares: z.array(shareSchema).min(1),
});
const snapshotSchema = z.strictObject({
  profile_id: uuid,
  household_id: uuid,
  roster: z
    .array(
      z.strictObject({
        id: uuid,
        profile_id: uuid,
        display_name: z
          .string()
          .trim()
          .min(1)
          .refine((value) => Array.from(value).length <= 100),
        role: z.enum(['OWNER', 'MEMBER']),
      }),
    )
    .min(1),
  status: z.enum(['UNCONFIGURED', 'READY', 'STALE']),
  version: z.number().int().min(0).max(2147483647),
  template: templateSchema.nullable(),
});
export type SplitSnapshot = z.infer<typeof snapshotSchema>;
export const splitKey = (profileId: string, householdId: string) =>
  ['household-default-split', profileId, householdId] as const;
export const pendingSplitKey = (profileId: string, householdId: string) =>
  ['pending-household-split', profileId, householdId] as const;
export const splitRequestSchema = z
  .strictObject({
    id: uuid,
    householdId: uuid,
    expectedVersion: z.number().int().min(0).max(2147483646),
    roster: z.array(uuid).min(1),
    shares: z.array(shareSchema).min(1),
  })
  .superRefine((value, ctx) => {
    try {
      createHouseholdSplit(
        value.roster,
        value.shares.map((share) => ({
          memberId: share.member_id,
          basisPoints: share.basis_points,
        })),
      );
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'El reparto debe incluir a cada miembro y sumar 100%.',
      });
    }
  });
export type SplitRequest = z.infer<typeof splitRequestSchema>;
export type PendingSplit = SplitRequest & { inFlight: boolean };
export function mapSplitSnapshot(
  profileId: string,
  householdId: string,
  value: unknown,
): SplitSnapshot {
  const data = snapshotSchema.parse(value);
  if (
    data.profile_id !== uuid.parse(profileId) ||
    data.household_id !== uuid.parse(householdId) ||
    data.roster.filter((member) => member.profile_id === data.profile_id)
      .length !== 1 ||
    new Set(data.roster.map((member) => member.id)).size !==
      data.roster.length ||
    new Set(data.roster.map((member) => member.profile_id)).size !==
      data.roster.length
  )
    throw new Error('Invalid split scope or roster.');
  if (data.template)
    createHouseholdSplit(
      data.template.roster,
      data.template.shares.map((share) => ({
        memberId: share.member_id,
        basisPoints: share.basis_points,
      })),
    );
  if (
    data.template &&
    (data.template.version !== data.version ||
      !sameHouseholdRoster(
        data.template.roster,
        data.roster.map((member) => member.id),
      ))
  )
    throw new Error('Invalid template roster/version.');
  const expected =
    data.version === 0 ? 'UNCONFIGURED' : data.template ? 'READY' : 'STALE';
  if (data.status !== expected || (data.version === 0 && data.template))
    throw new Error('Invalid split status.');
  return data;
}
export async function readDefaultSplit(
  profileId: string,
  householdId: string,
  signal?: AbortSignal,
) {
  uuid.parse(profileId);
  const query = supabase.rpc('get_household_default_split', {
    p_household_id: uuid.parse(householdId),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapSplitSnapshot(profileId, householdId, data);
}
export function mapSplitReceipt(request: SplitRequest, value: unknown) {
  const result = z
    .strictObject({
      request_id: uuid,
      household_id: uuid,
      version: z.number().int().min(1).max(2147483647),
    })
    .parse(value);
  if (
    result.request_id !== request.id ||
    result.household_id !== request.householdId ||
    result.version !== request.expectedVersion + 1
  )
    throw new Error('Split receipt does not match the request.');
  return result;
}
export async function saveDefaultSplit(input: SplitRequest) {
  const request = splitRequestSchema.parse(input);
  const { data, error } = await supabase.rpc('save_household_default_split', {
    p_request_id: request.id,
    p_household_id: request.householdId,
    p_expected_version: request.expectedVersion,
    p_roster: request.roster,
    p_shares: request.shares,
  });
  if (error) throw error;
  return mapSplitReceipt(request, data);
}
export const splitFormSchema = z
  .object({ percentages: z.array(z.string()).min(1) })
  .superRefine((form, ctx) => {
    const values = form.percentages.map((value) => parseDecimal(value, 2));
    values.forEach((value, index) => {
      if (value === null || value > 10000)
        ctx.addIssue({
          code: 'custom',
          path: ['percentages', index],
          message: 'Ingresa de 0 a 100 con hasta dos decimales.',
        });
    });
    if (
      values.every((value) => value !== null && value <= 10000) &&
      values.reduce<number>((sum, value) => sum + (value ?? 0), 0) !== 10000
    )
      ctx.addIssue({
        code: 'custom',
        path: ['percentages', 0],
        message: 'Los porcentajes deben sumar 100%.',
      });
  });
export type SplitForm = z.infer<typeof splitFormSchema>;
export function initialSplitForm(snapshot: SplitSnapshot): SplitForm {
  return {
    percentages: snapshot.roster.map((member) => {
      const share = snapshot.template?.shares.find(
        (entry) => entry.member_id === member.id,
      );
      return share ? decimalText(share.basis_points, 2) : '';
    }),
  };
}
export function splitRequestFromForm(
  snapshot: SplitSnapshot,
  id: string,
  input: SplitForm,
): SplitRequest {
  const form = splitFormSchema.parse(input);
  if (form.percentages.length !== snapshot.roster.length)
    throw new Error('Roster changed.');
  return splitRequestSchema.parse({
    id,
    householdId: snapshot.household_id,
    expectedVersion: snapshot.version,
    roster: snapshot.roster.map((member) => member.id),
    shares: snapshot.roster.map((member, index) => ({
      member_id: member.id,
      basis_points: parseDecimal(form.percentages[index], 2),
    })),
  });
}
export function sameSplitRequest(a: SplitRequest, b: SplitRequest) {
  return (
    a.id === b.id &&
    a.householdId === b.householdId &&
    a.expectedVersion === b.expectedVersion &&
    sameHouseholdRoster(a.roster, b.roster) &&
    a.shares.length === b.shares.length &&
    a.shares.every((share) =>
      b.shares.some(
        (other) =>
          other.member_id === share.member_id &&
          other.basis_points === share.basis_points,
      ),
    )
  );
}
function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
export function isRejectedSplit(error: unknown) {
  return [
    '42501',
    '23505',
    '23514',
    '23502',
    '23503',
    '22023',
    '25001',
    '40001',
  ].includes(String(errorCode(error)));
}
export function splitErrorMessage(error: unknown) {
  const code = errorCode(error);
  if (code === '40001')
    return 'Cambió el reparto o la lista de miembros. Actualiza y revisa los porcentajes antes de guardar.';
  if (code === '42501')
    return 'No pudimos confirmar tu permiso de propietario. Actualiza el hogar.';
  if (isRejectedSplit(error))
    return 'No se guardó el reparto. Actualiza y revisa los porcentajes.';
  return 'No se pudo confirmar el guardado. Comprueba la solicitud pendiente antes de intentar otro reparto.';
}
