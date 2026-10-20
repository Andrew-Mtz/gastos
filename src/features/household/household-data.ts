import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Ingresa un nombre para el hogar.')
  .refine(
    (value) => Array.from(value).length <= 100,
    'Usa hasta 100 caracteres.',
  );
const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Selecciona una moneda para el hogar.');
export const householdFormSchema = z.object({
  name: nameSchema,
  currency: currencySchema,
});
export type HouseholdForm = z.infer<typeof householdFormSchema>;
export const householdRequestSchema = z.object({
  id: z.uuid(),
  form: householdFormSchema,
});
export type HouseholdRequest = z.infer<typeof householdRequestSchema>;
export type PendingHousehold = HouseholdRequest & { inFlight: boolean };

const memberSchema = z.strictObject({
  id: z.uuid(),
  profile_id: z.uuid(),
  display_name: nameSchema,
  role: z.enum(['OWNER', 'MEMBER']),
});
const householdSchema = z.strictObject({
  id: z.uuid(),
  name: nameSchema,
  default_currency: currencySchema,
  members: z.array(memberSchema).min(1),
});
const snapshotSchema = z.strictObject({
  profile_id: z.uuid(),
  creation_status: z.enum([
    'ELIGIBLE',
    'ACTIVE_MEMBERSHIP',
    'PREVIOUS_MEMBERSHIP',
  ]),
  households: z.array(householdSchema),
});
export type HouseholdSnapshot = z.infer<typeof snapshotSchema>;
export const householdKey = (profileId: string) =>
  ['household-memberships', profileId] as const;
export const pendingHouseholdKey = (profileId: string) =>
  ['pending-household-create', profileId] as const;

export function mapHouseholdSnapshot(profileId: string, value: unknown) {
  z.uuid().parse(profileId);
  const result = snapshotSchema.parse(value);
  const memberIds = result.households.flatMap((household) =>
    household.members.map((member) => member.id),
  );
  if (
    result.profile_id !== profileId ||
    new Set(memberIds).size !== memberIds.length ||
    (result.creation_status === 'ACTIVE_MEMBERSHIP') !==
      result.households.length > 0 ||
    new Set(result.households.map((row) => row.id)).size !==
      result.households.length ||
    result.households.some(
      (household) =>
        household.members.filter((member) => member.profile_id === profileId)
          .length !== 1 ||
        new Set(household.members.map((member) => member.id)).size !==
          household.members.length ||
        new Set(household.members.map((member) => member.profile_id)).size !==
          household.members.length,
    )
  )
    throw new Error('Invalid household membership response.');
  return result;
}

export async function readHouseholdMemberships(
  profileId: string,
  signal?: AbortSignal,
): Promise<HouseholdSnapshot> {
  z.uuid().parse(profileId);
  const query = supabase.rpc('get_my_household_memberships');
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapHouseholdSnapshot(profileId, data);
}

export async function createFirstHousehold(request: HouseholdRequest) {
  const { id, form } = householdRequestSchema.parse(request);
  const { data, error } = await supabase.rpc('create_first_household', {
    p_household_id: id,
    p_name: form.name,
    p_default_currency: form.currency,
  });
  if (error) throw error;
  const result = z.strictObject({ household_id: z.uuid() }).parse(data);
  if (result.household_id !== id)
    throw new Error('Household response does not match the request.');
  return result;
}

export function snapshotConfirmsRequest(
  snapshot: HouseholdSnapshot,
  request: HouseholdRequest,
) {
  return snapshot.households.some(
    (household) =>
      household.id === request.id &&
      household.name === request.form.name &&
      household.default_currency === request.form.currency,
  );
}
function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
export function isRejectedHousehold(error: unknown) {
  const code = errorCode(error);
  return (
    typeof code === 'string' &&
    ['42501', '23505', '23514', '23502', '23503', '22023', '25001'].includes(
      code,
    )
  );
}
export function householdErrorMessage(error: unknown) {
  const code = errorCode(error);
  if (code === '42501')
    return 'No pudimos confirmar tu acceso al hogar. Actualiza o vuelve a iniciar sesión.';
  if (code === '23505')
    return 'No se pudo crear otro hogar. Actualiza para revisar tus membresías actuales.';
  if (code === '23514' || code === '23502' || code === '22023')
    return 'Revisa el nombre y la moneda del hogar.';
  return 'No se pudo confirmar la operación. Revisa tu conexión e intenta nuevamente.';
}
