import {
  invitationsKey,
  pendingInvitationKey,
  mapInvitationContext,
  readInvitations,
  recipientCodeSchema,
  submitInvitation,
  invitationContextConfirms,
  invitationErrorMessage,
  sameInvitationRequest,
} from '../invitation-data';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
const mockRpc = jest.fn();
const id = (n: number) =>
  `f2030000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const invite = () => ({
  id: id(30),
  household_id: id(20),
  household_name: 'Casa',
  status: 'PENDING',
  expires_at: '2026-10-28T02:00:00+00:00',
});
const context = () => ({
  profile_id: id(1),
  recipient_code: id(10),
  incoming: [invite()],
  outgoing: [{ ...invite(), id: id(31), recipient_code: id(11) }],
});
let data: unknown;
let error: unknown;
const abortSignal = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  data = context();
  error = null;
  mockRpc.mockImplementation(() => {
    const result = Promise.resolve({ data, error });
    return Object.assign(result, {
      abortSignal: abortSignal.mockReturnValue(result),
    });
  });
});
test('own-subject read takes no identity parameter and cancellation stays attached', async () => {
  const signal = new AbortController().signal;
  expect(await readInvitations(id(1), signal)).toEqual(context());
  expect(mockRpc).toHaveBeenCalledWith('get_my_household_invitations');
  expect(abortSignal).toHaveBeenCalledWith(signal);
  expect(invitationsKey(id(1))).not.toEqual(invitationsKey(id(2)));
  expect(pendingInvitationKey(id(1))).not.toEqual(pendingInvitationKey(id(2)));
});
test.each([
  'email',
  'display_name',
  'timezone',
  'members',
  'issuer_profile_id',
  'recipient_profile_id',
  'finances',
])('rejects unexpected private field %s on incoming DTO', (field) => {
  const value = context();
  Object.assign(value.incoming[0], { [field]: 'private' });
  expect(() => mapInvitationContext(id(1), value)).toThrow();
});
test.each(['recipient_code', 'owner', 'role'])(
  'prejoin incoming never accepts field %s',
  (field) => {
    const value = context();
    Object.assign(value.incoming[0], { [field]: id(10) });
    expect(() => mapInvitationContext(id(1), value)).toThrow();
  },
);
test('rejects another subject, duplicate identities, self-code output, invalid timestamps and states', () => {
  expect(() => mapInvitationContext(id(2), context())).toThrow();
  const duplicated = context();
  duplicated.outgoing[0].id = id(30);
  expect(() => mapInvitationContext(id(1), duplicated)).toThrow();
  const self = context();
  self.outgoing[0].recipient_code = id(10);
  expect(() => mapInvitationContext(id(1), self)).toThrow();
  const invalid = context();
  invalid.incoming[0].expires_at = 'infinity';
  expect(() => mapInvitationContext(id(1), invalid)).toThrow();
  invalid.incoming[0].expires_at = invite().expires_at;
  invalid.incoming[0].status = 'OWNER';
  expect(() => mapInvitationContext(id(1), invalid)).toThrow();
});
test('normalizes a copied code without making it authorization', () => {
  expect(recipientCodeSchema.parse(` ${id(10).toUpperCase()}\n`)).toBe(id(10));
  expect(() => recipientCodeSchema.parse('user@example.com')).toThrow();
});
test('create sends only explicit target, copied code and stable identity', async () => {
  data = { invitation_id: id(31) };
  const request = {
    action: 'CREATE' as const,
    id: id(31),
    householdId: id(20),
    recipientCode: id(11),
  };
  await submitInvitation(request);
  await submitInvitation(request);
  expect(mockRpc).toHaveBeenNthCalledWith(1, 'create_household_invitation', {
    p_invitation_id: id(31),
    p_household_id: id(20),
    p_recipient_code: id(11),
  });
  expect(mockRpc).toHaveBeenNthCalledWith(2, 'create_household_invitation', {
    p_invitation_id: id(31),
    p_household_id: id(20),
    p_recipient_code: id(11),
  });
});
test.each(['ACCEPT', 'REVOKE'] as const)(
  '%s uses invitation identity, never accepts actor or role',
  async (action) => {
    data =
      action === 'ACCEPT'
        ? { invitation_id: id(30), household_id: id(20) }
        : { invitation_id: id(30) };
    await submitInvitation({ action, id: id(30) });
    expect(mockRpc).toHaveBeenCalledWith(
      action === 'ACCEPT'
        ? 'accept_household_invitation'
        : 'revoke_household_invitation',
      { p_invitation_id: id(30) },
    );
    await expect(
      submitInvitation(
        Object.assign({ action, id: id(30) }, { role: 'OWNER' }),
      ),
    ).rejects.toThrow();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  },
);
test('rejects wrong, missing and extra acknowledgement fields rather than declaring success', async () => {
  for (const value of [
    { invitation_id: id(99) },
    { invitation_id: id(30), email: 'private' },
    {},
  ]) {
    data = value;
    await expect(
      submitInvitation({ action: 'REVOKE', id: id(30) }),
    ).rejects.toThrow();
  }
  data = { invitation_id: id(30) };
  await expect(
    submitInvitation({ action: 'ACCEPT', id: id(30) }),
  ).rejects.toThrow();
});
test('read confirmation checks exact request intent and accepted/cancelled state', () => {
  const value = mapInvitationContext(id(1), context());
  expect(
    invitationContextConfirms(value, {
      action: 'CREATE',
      id: id(31),
      householdId: id(20),
      recipientCode: id(11),
    }),
  ).toBe(true);
  expect(
    invitationContextConfirms(value, {
      action: 'CREATE',
      id: id(31),
      householdId: id(20),
      recipientCode: id(12),
    }),
  ).toBe(false);
  expect(
    invitationContextConfirms(value, { action: 'ACCEPT', id: id(30) }),
  ).toBe(false);
  value.incoming[0].status = 'ACCEPTED';
  expect(
    invitationContextConfirms(value, { action: 'ACCEPT', id: id(30) }),
  ).toBe(true);
  value.outgoing[0].status = 'REVOKED';
  expect(
    invitationContextConfirms(value, { action: 'REVOKE', id: id(31) }),
  ).toBe(true);
});
test.each(['42501', '22023', '23505', '23514', 'NETWORK'])(
  'error %s never echoes raw backend or personal content',
  (code) => {
    const message = invitationErrorMessage({
      code,
      message: 'Private sensitive detail',
    });
    expect(message).not.toContain('Private sensitive detail');
    expect(message.length).toBeGreaterThan(20);
  },
);
test('infrastructure failure rejects without parsing an apparent cached payload', async () => {
  error = { code: '42501' };
  await expect(readInvitations(id(1))).rejects.toEqual(error);
  await expect(
    submitInvitation({ action: 'ACCEPT', id: id(30) }),
  ).rejects.toEqual(error);
});

test('operation identity distinguishes same-invitation actions and exact create payloads', () => {
  const request = {
    action: 'CREATE' as const,
    id: id(31),
    householdId: id(20),
    recipientCode: id(11),
  };
  expect(sameInvitationRequest(request, { ...request })).toBe(true);
  expect(
    sameInvitationRequest(request, { action: 'REVOKE', id: request.id }),
  ).toBe(false);
  expect(
    sameInvitationRequest(request, { ...request, householdId: id(21) }),
  ).toBe(false);
  expect(
    sameInvitationRequest(request, { ...request, recipientCode: id(12) }),
  ).toBe(false);
  expect(
    sameInvitationRequest(
      { action: 'ACCEPT', id: id(30) },
      { action: 'REVOKE', id: id(30) },
    ),
  ).toBe(false);
});
