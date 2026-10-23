import { supabase } from '../../../infrastructure/supabase/client';
import {
  initialSplitForm,
  mapSplitReceipt,
  mapSplitSnapshot,
  pendingSplitKey,
  readDefaultSplit,
  sameSplitRequest,
  saveDefaultSplit,
  splitErrorMessage,
  splitFormSchema,
  splitKey,
  splitRequestFromForm,
  splitRequestSchema,
} from '../split-data';
import { splitId as id, splitSnapshot } from './split-fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
const request = () =>
  splitRequestFromForm(splitSnapshot(), id(50), { percentages: ['70', '30'] });
beforeEach(() => jest.resetAllMocks());
test.each(['UNCONFIGURED', 'READY', 'STALE'] as const)(
  'strict parser accepts consistent %s and rejects cross-account/cross-household data',
  (status) => {
    const value = splitSnapshot(status);
    expect(mapSplitSnapshot(id(1), id(20), value)).toEqual(value);
    expect(() => mapSplitSnapshot(id(2), id(20), value)).toThrow();
    expect(() => mapSplitSnapshot(id(1), id(21), value)).toThrow();
    expect(() =>
      mapSplitSnapshot(id(1), id(20), { ...value, email: 'private' }),
    ).toThrow();
    expect(() =>
      mapSplitSnapshot(id(1), id(20), {
        ...value,
        roster: [...value.roster, value.roster[0]],
      }),
    ).toThrow();
  },
);
test('rejects mismatched status/version, foreign or duplicate template members and wrong sum', () => {
  const value = splitSnapshot('READY');
  expect(() =>
    mapSplitSnapshot(id(1), id(20), { ...value, status: 'STALE' }),
  ).toThrow();
  expect(() =>
    mapSplitSnapshot(id(1), id(20), { ...value, version: 2 }),
  ).toThrow();
  expect(() =>
    mapSplitSnapshot(id(1), id(20), {
      ...value,
      template: { ...value.template, roster: [id(40), id(99)] },
    }),
  ).toThrow();
  expect(() =>
    mapSplitSnapshot(id(1), id(20), {
      ...value,
      template: {
        ...value.template,
        shares: [{ member_id: id(40), basis_points: 9999 }],
      },
    }),
  ).toThrow();
  expect(() =>
    mapSplitSnapshot(id(1), id(20), {
      ...splitSnapshot('STALE'),
      template: value.template,
    }),
  ).toThrow();
});
test('no implicit default; stale requires all values anew and persists no historical member IDs', () => {
  expect(initialSplitForm(splitSnapshot())).toEqual({ percentages: ['', ''] });
  expect(initialSplitForm(splitSnapshot('STALE'))).toEqual({
    percentages: ['', ''],
  });
  expect(initialSplitForm(splitSnapshot('READY'))).toEqual({
    percentages: ['70.00', '30.00'],
  });
  expect(
    splitRequestFromForm(splitSnapshot('STALE'), id(51), {
      percentages: ['100', '0'],
    }).expectedVersion,
  ).toBe(1);
});
test.each([
  ['', '100'],
  ['70', ''],
  ['70.001', '29.999'],
  ['70', '29.99'],
  ['101', '0'],
  ['-1', '101'],
  ['NaN', '0'],
  ['1e2', '0'],
])('invalid explicit percentage inputs %j', (...percentages) => {
  expect(splitFormSchema.safeParse({ percentages }).success).toBe(false);
});
test('decimal text is parsed exactly to basis points and every member explicit', () => {
  expect(
    splitRequestFromForm(splitSnapshot(), id(50), {
      percentages: ['66,67', '33.33'],
    }).shares.map((s) => s.basis_points),
  ).toEqual([6667, 3333]);
  expect(() =>
    splitRequestFromForm(splitSnapshot(), id(50), { percentages: ['100'] }),
  ).toThrow();
  expect(() =>
    splitRequestSchema.parse({
      ...request(),
      shares: [request().shares[0], request().shares[0]],
    }),
  ).toThrow();
});
test('read is scoped, abortable and passes actual JSON through parser', async () => {
  const signal = new AbortController().signal;
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: splitSnapshot('READY'), error: null });
  jest.mocked(supabase.rpc).mockReturnValueOnce({ abortSignal } as never);
  await expect(readDefaultSplit(id(1), id(20), signal)).resolves.toEqual(
    splitSnapshot('READY'),
  );
  expect(supabase.rpc).toHaveBeenCalledWith('get_household_default_split', {
    p_household_id: id(20),
  });
  expect(abortSignal).toHaveBeenCalledWith(signal);
});
test('save sends validated original payload and accepts only its exact immutable receipt', async () => {
  const input = request();
  const receipt = {
    request_id: input.id,
    household_id: input.householdId,
    version: 1,
  };
  jest
    .mocked(supabase.rpc)
    .mockResolvedValueOnce({ data: receipt, error: null } as never);
  await expect(saveDefaultSplit(input)).resolves.toEqual(receipt);
  expect(supabase.rpc).toHaveBeenCalledWith('save_household_default_split', {
    p_request_id: input.id,
    p_household_id: input.householdId,
    p_expected_version: 0,
    p_roster: input.roster,
    p_shares: input.shares,
  });
  for (const invalid of [
    { ...receipt, version: 2 },
    { ...receipt, request_id: id(51) },
    { ...receipt, household_id: id(21) },
    { ...receipt, private_data: 42 },
  ])
    expect(() => mapSplitReceipt(input, invalid)).toThrow();
});
test('request identity matters even when percentages happen to match', () => {
  expect(sameSplitRequest(request(), request())).toBe(true);
  expect(sameSplitRequest(request(), { ...request(), id: id(51) })).toBe(false);
  expect(
    sameSplitRequest(request(), { ...request(), expectedVersion: 1 }),
  ).toBe(false);
  expect(splitKey(id(1), id(20))).not.toEqual(splitKey(id(2), id(20)));
  expect(pendingSplitKey(id(1), id(20))).not.toEqual(
    pendingSplitKey(id(1), id(21)),
  );
});
test('safe UI errors never expose infrastructure payload', () => {
  expect(
    splitErrorMessage({ code: '40001', message: 'private payload' }),
  ).toMatch(/Cambió el reparto/);
  expect(
    splitErrorMessage({ code: '42501', message: 'private payload' }),
  ).toMatch(/permiso de propietario/);
  expect(splitErrorMessage(new Error('private payload'))).not.toMatch(
    /private payload/,
  );
});

test('display names retain the existing Unicode code-point limit', () => {
  const snapshot = splitSnapshot();
  snapshot.roster[0].display_name = '😀'.repeat(100);
  expect(mapSplitSnapshot(id(1), id(20), snapshot).roster[0].display_name).toBe(
    snapshot.roster[0].display_name,
  );
  snapshot.roster[0].display_name += 'a';
  expect(() => mapSplitSnapshot(id(1), id(20), snapshot)).toThrow();
});
