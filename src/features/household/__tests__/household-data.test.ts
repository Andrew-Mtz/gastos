import {
  createFirstHousehold,
  householdErrorMessage,
  householdFormSchema,
  householdKey,
  isRejectedHousehold,
  mapHouseholdSnapshot,
  pendingHouseholdKey,
  readHouseholdMemberships,
  snapshotConfirmsRequest,
} from '../household-data';

jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));
const mockRpc = jest.fn();
const owner = 'f2020000-0000-4000-8000-000000000001';
const partner = 'f2020000-0000-4000-8000-000000000002';
const id = 'f2021000-0000-4000-8000-000000000001';
const request = { id, form: { name: 'Nuestro hogar', currency: 'UYU' } };
const empty = () => ({
  profile_id: owner,
  creation_status: 'ELIGIBLE',
  households: [],
});
const snapshot = () => ({
  profile_id: owner,
  creation_status: 'ACTIVE_MEMBERSHIP',
  households: [
    {
      id,
      name: 'Nuestro hogar',
      default_currency: 'UYU',
      members: [
        {
          id: 'f2022000-0000-4000-8000-000000000001',
          profile_id: owner,
          display_name: 'Persona A',
          role: 'OWNER',
        },
        {
          id: 'f2022000-0000-4000-8000-000000000002',
          profile_id: partner,
          display_name: 'Persona B',
          role: 'MEMBER',
        },
      ],
    },
  ],
});
let data: unknown;
let error: unknown;
const abortSignal = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  data = empty();
  error = null;
  mockRpc.mockImplementation(() => {
    const result = Promise.resolve({ data, error });
    return Object.assign(result, {
      abortSignal: abortSignal.mockReturnValue(result),
    });
  });
});

test('reads only the current-subject RPC, supports cancellation, and isolates owner keys', async () => {
  const signal = new AbortController().signal;
  expect(await readHouseholdMemberships(owner, signal)).toEqual(empty());
  expect(mockRpc).toHaveBeenCalledWith('get_my_household_memberships');
  expect(abortSignal).toHaveBeenCalledWith(signal);
  expect(householdKey(owner)).not.toEqual(householdKey(partner));
  expect(pendingHouseholdKey(owner)).not.toEqual(pendingHouseholdKey(partner));
});
test('rejects invalid subject before transport and mismatching returned subject', async () => {
  await expect(readHouseholdMemberships('not-a-uuid')).rejects.toThrow();
  expect(mockRpc).not.toHaveBeenCalled();
  data = { ...empty(), profile_id: partner };
  await expect(readHouseholdMemberships(owner)).rejects.toThrow(
    'Invalid household',
  );
});
test('propagates transport failure only to the feature error boundary', async () => {
  error = { code: '42501', message: 'private source information' };
  await expect(readHouseholdMemberships(owner)).rejects.toEqual(error);
  expect(householdErrorMessage(error)).not.toContain('private source');
});
test('accepts active collections without a two-member or household cardinality cap', () => {
  const value = snapshot();
  value.households[0].members.push({
    id: 'f2022000-0000-4000-8000-000000000003',
    profile_id: 'f2020000-0000-4000-8000-000000000003',
    display_name: 'Persona C',
    role: 'OWNER',
  });
  value.households.push({
    ...value.households[0],
    id: 'f2021000-0000-4000-8000-000000000002',
    members: [
      {
        ...value.households[0].members[0],
        id: 'f2022000-0000-4000-8000-000000000004',
      },
    ],
  });
  expect(mapHouseholdSnapshot(owner, value).households).toHaveLength(2);
  expect(mapHouseholdSnapshot(owner, value).households[0].members).toHaveLength(
    3,
  );
});
test('inactive-only history exposes status, not historical household data', () => {
  expect(
    mapHouseholdSnapshot(owner, {
      ...empty(),
      creation_status: 'PREVIOUS_MEMBERSHIP',
    }).households,
  ).toEqual([]);
  expect(() =>
    mapHouseholdSnapshot(owner, {
      ...snapshot(),
      creation_status: 'PREVIOUS_MEMBERSHIP',
    }),
  ).toThrow();
});
test.each(['ELIGIBLE', 'PREVIOUS_MEMBERSHIP'])(
  'rejects active data marked %s',
  (creation_status) => {
    expect(() =>
      mapHouseholdSnapshot(owner, { ...snapshot(), creation_status }),
    ).toThrow();
  },
);
test('rejects empty active claims, absent current membership, and duplicate identities', () => {
  expect(() =>
    mapHouseholdSnapshot(owner, {
      ...empty(),
      creation_status: 'ACTIVE_MEMBERSHIP',
    }),
  ).toThrow();
  const absent = snapshot();
  absent.households[0].members.shift();
  expect(() => mapHouseholdSnapshot(owner, absent)).toThrow();
  const duplicate = snapshot();
  duplicate.households.push(duplicate.households[0]);
  expect(() => mapHouseholdSnapshot(owner, duplicate)).toThrow();
  const members = snapshot();
  members.households[0].members.push(members.households[0].members[0]);
  expect(() => mapHouseholdSnapshot(owner, members)).toThrow();
  const profile = snapshot();
  profile.households[0].members.push({
    ...profile.households[0].members[0],
    id: 'f2022000-0000-4000-8000-000000000009',
  });
  expect(() => mapHouseholdSnapshot(owner, profile)).toThrow();
});
test('rejects a membership identity incorrectly reused across household scopes', () => {
  const value = snapshot();
  value.households.push({
    ...value.households[0],
    id: 'f2021000-0000-4000-8000-000000000002',
  });
  expect(() => mapHouseholdSnapshot(owner, value)).toThrow();
});
test.each(['email', 'base_currency', 'timezone', 'balance_minor', 'left_at'])(
  'refuses unreviewed member field %s',
  (field) => {
    const value = snapshot();
    Object.assign(value.households[0].members[1], { [field]: 'private' });
    expect(() => mapHouseholdSnapshot(owner, value)).toThrow();
  },
);
test('refuses unreviewed snapshot/household fields and malformed role/currency', () => {
  expect(() =>
    mapHouseholdSnapshot(owner, { ...empty(), profiles: [] }),
  ).toThrow();
  const value = snapshot();
  Object.assign(value.households[0], { created_by: owner });
  expect(() => mapHouseholdSnapshot(owner, value)).toThrow();
  const role = snapshot();
  role.households[0].members[0].role = 'ADMIN';
  expect(() => mapHouseholdSnapshot(owner, role)).toThrow();
  const currency = snapshot();
  currency.households[0].default_currency = 'usd';
  expect(() => mapHouseholdSnapshot(owner, currency)).toThrow();
});
test('validates Unicode character length without imposing a narrower currency registry', () => {
  expect(
    householdFormSchema.parse({ name: '  Casa  ', currency: 'UYU' }).name,
  ).toBe('Casa');
  expect(
    householdFormSchema.safeParse({ name: '🏡'.repeat(100), currency: 'JPY' })
      .success,
  ).toBe(true);
  expect(
    householdFormSchema.safeParse({ name: '🏡'.repeat(101), currency: 'UYU' })
      .success,
  ).toBe(false);
  expect(
    householdFormSchema.safeParse({ name: '\t \n', currency: 'UYU' }).success,
  ).toBe(false);
  expect(
    householdFormSchema.safeParse({ name: 'Casa', currency: 'usd' }).success,
  ).toBe(false);
});
test('sends only stable request identity and chosen household metadata, never a client actor/role', async () => {
  data = { household_id: id };
  expect(await createFirstHousehold(request)).toEqual(data);
  expect(mockRpc).toHaveBeenCalledWith('create_first_household', {
    p_household_id: id,
    p_name: request.form.name,
    p_default_currency: request.form.currency,
  });
});
test('rejects invalid create before transport and mismatched or widened acknowledgments', async () => {
  await expect(
    createFirstHousehold({ ...request, id: 'bad' }),
  ).rejects.toThrow();
  expect(mockRpc).not.toHaveBeenCalled();
  data = { household_id: 'f2021000-0000-4000-8000-000000000099' };
  await expect(createFirstHousehold(request)).rejects.toThrow('does not match');
  data = { household_id: id, private_profile: { timezone: 'UTC' } };
  await expect(createFirstHousehold(request)).rejects.toThrow();
});
test('an exact authorized snapshot confirms a lost response but different metadata does not', () => {
  const value = mapHouseholdSnapshot(owner, snapshot());
  expect(snapshotConfirmsRequest(value, request)).toBe(true);
  expect(
    snapshotConfirmsRequest(value, {
      ...request,
      form: { ...request.form, name: 'Different' },
    }),
  ).toBe(false);
  expect(
    snapshotConfirmsRequest(value, {
      ...request,
      form: { ...request.form, currency: 'USD' },
    }),
  ).toBe(false);
  expect(
    snapshotConfirmsRequest(mapHouseholdSnapshot(owner, empty()), request),
  ).toBe(false);
});
test.each(['42501', '23505', '23514', '23502', '23503', '22023', '25001'])(
  'recognizes definite rejection %s while suppressing raw errors',
  (code) => {
    const failure = {
      code,
      message: 'raw secret detail',
      details: 'sensitive',
      hint: 'private',
    };
    expect(isRejectedHousehold(failure)).toBe(true);
    expect(householdErrorMessage(failure)).not.toMatch(
      /raw secret|sensitive|private/,
    );
  },
);
test.each([
  null,
  undefined,
  new Error('sensitive raw'),
  { code: 'NETWORK_ERROR' },
  { code: 42501 },
  {
    code: {
      toString() {
        throw new Error('must not stringify arbitrary objects');
      },
    },
  },
])('retains uncertainty for unknown transport error %#', (failure) => {
  expect(isRejectedHousehold(failure)).toBe(false);
  expect(householdErrorMessage(failure)).toBe(
    'No se pudo confirmar la operación. Revisa tu conexión e intenta nuevamente.',
  );
});
