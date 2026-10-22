import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';

export const recipientCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.uuid('Copia el código completo desde la cuenta de la otra persona.'));
const invitationSchema = z.strictObject({
  id: z.uuid(),
  household_id: z.uuid(),
  household_name: z.string().min(1).max(200),
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED', 'UNAVAILABLE']),
  expires_at: z.iso.datetime({ offset: true }),
});
const outgoingSchema = invitationSchema.extend({ recipient_code: z.uuid() });
const contextSchema = z.strictObject({
  profile_id: z.uuid(),
  recipient_code: z.uuid(),
  incoming: z.array(invitationSchema),
  outgoing: z.array(outgoingSchema),
});
export type InvitationContext = z.infer<typeof contextSchema>;
export const invitationRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('CREATE'),
    id: z.uuid(),
    householdId: z.uuid(),
    recipientCode: recipientCodeSchema,
  }),
  z.strictObject({ action: z.literal('ACCEPT'), id: z.uuid() }),
  z.strictObject({ action: z.literal('REVOKE'), id: z.uuid() }),
]);
export type InvitationRequest = z.infer<typeof invitationRequestSchema>;
export type PendingInvitation = InvitationRequest & { inFlight: boolean };
export const invitationsKey = (profileId: string) =>
  ['household-invitations', profileId] as const;
export const pendingInvitationKey = (profileId: string) =>
  ['pending-household-invitation', profileId] as const;

export function mapInvitationContext(
  profileId: string,
  input: unknown,
): InvitationContext {
  z.uuid().parse(profileId);
  const result = contextSchema.parse(input);
  const ids = [...result.incoming, ...result.outgoing].map((row) => row.id);
  if (
    result.profile_id !== profileId ||
    new Set(ids).size !== ids.length ||
    result.outgoing.some((row) => row.recipient_code === result.recipient_code)
  )
    throw new Error('Invalid invitation response.');
  return result;
}
export async function readInvitations(profileId: string, signal?: AbortSignal) {
  z.uuid().parse(profileId);
  const query = supabase.rpc('get_my_household_invitations');
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapInvitationContext(profileId, data);
}
export async function submitInvitation(input: InvitationRequest) {
  const request = invitationRequestSchema.parse(input);
  const result =
    request.action === 'CREATE'
      ? await supabase.rpc('create_household_invitation', {
          p_invitation_id: request.id,
          p_household_id: request.householdId,
          p_recipient_code: request.recipientCode,
        })
      : request.action === 'ACCEPT'
        ? await supabase.rpc('accept_household_invitation', {
            p_invitation_id: request.id,
          })
        : await supabase.rpc('revoke_household_invitation', {
            p_invitation_id: request.id,
          });
  if (result.error) throw result.error;
  const ack =
    request.action === 'ACCEPT'
      ? z
          .strictObject({ invitation_id: z.uuid(), household_id: z.uuid() })
          .parse(result.data)
      : z.strictObject({ invitation_id: z.uuid() }).parse(result.data);
  if (ack.invitation_id !== request.id)
    throw new Error('Invalid invitation acknowledgement.');
  return ack;
}
// An invitation can carry a later action while an earlier response is still in
// flight. The invitation ID alone is not the identity of that client operation.
export function sameInvitationRequest(
  a: InvitationRequest,
  b: InvitationRequest,
) {
  return (
    a.id === b.id &&
    a.action === b.action &&
    (a.action !== 'CREATE' ||
      (b.action === 'CREATE' &&
        a.householdId === b.householdId &&
        a.recipientCode === b.recipientCode))
  );
}

export function invitationContextConfirms(
  context: InvitationContext,
  request: InvitationRequest,
) {
  if (request.action === 'CREATE')
    return context.outgoing.some(
      (row) =>
        row.id === request.id &&
        row.household_id === request.householdId &&
        row.recipient_code === request.recipientCode,
    );
  const rows =
    request.action === 'ACCEPT' ? context.incoming : context.outgoing;
  return rows.some(
    (row) =>
      row.id === request.id &&
      row.status === (request.action === 'ACCEPT' ? 'ACCEPTED' : 'REVOKED'),
  );
}
export function invitationErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '22023' || code === '23505' || code === '23514')
    return 'La invitación no está disponible. Revisa el código, actualiza o inténtalo más tarde. No se reactivan membresías anteriores.';
  if (code === '42501')
    return 'No pudimos confirmar tu acceso a esta invitación. Actualiza para revisar el estado.';
  return 'No se pudo confirmar la operación. Conservamos la misma solicitud para comprobarla sin duplicarla.';
}
