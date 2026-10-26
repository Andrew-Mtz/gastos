import { supabase } from '../../../infrastructure/supabase/client';
import {
  mapSharedResponsibilities,
  readSharedResponsibilities,
  sharedResponsibilityKey,
} from '../shared-responsibility-data';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
const id = (n: number) =>
  `f2100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const month = '2025-01-01';
const entry = () => ({
  expense_id: id(50),
  household_id: id(20),
  household_name: 'Casa',
  transaction_date: '2025-01-02',
  description: 'Cena',
  budget_classification: 'LEISURE',
  responsibility_amount_minor: 250,
  currency: 'UYU',
  application_status: 'NO_PERIOD',
  included_in_closed_period: null,
});
const data = () => ({
  owner_profile_id: id(1),
  month,
  period: null,
  entries: [entry()],
});
test('own original classification and amount remain visible without period, plan or income', () => {
  expect(mapSharedResponsibilities(id(1), month, data()).entries[0]).toEqual(
    entry(),
  );
});
test('former-member source stays available with neutral provenance and no current shared metadata', () => {
  expect(
    mapSharedResponsibilities(id(1), month, {
      ...data(),
      entries: [{ ...entry(), household_name: null }],
    }).entries[0].household_name,
  ).toBeNull();
});
test.each([
  'payer_member_id',
  'splits',
  'income_minor',
  'budget_bucket_id',
  'category_id',
  'profile',
])('strict source rejects unrelated metadata %s', (field) => {
  expect(() =>
    mapSharedResponsibilities(id(1), month, {
      ...data(),
      entries: [{ ...entry(), [field]: id(99) }],
    }),
  ).toThrow();
});
test.each([
  { owner_profile_id: id(2) },
  { month: '2025-02-01' },
  { entries: [entry(), entry()] },
  { entries: [{ ...entry(), transaction_date: '2025-02-02' }] },
  { entries: [{ ...entry(), responsibility_amount_minor: -1 }] },
  {
    entries: [
      { ...entry(), responsibility_amount_minor: Number.MAX_SAFE_INTEGER + 1 },
    ],
  },
  { entries: [{ ...entry(), budget_classification: 'SAVINGS' }] },
  { entries: [{ ...entry(), included_in_closed_period: true }] },
  { entries: [{ ...entry(), application_status: 'APPLIED' }] },
])('rejects incomplete or cross-scope source %j', (patch) =>
  expect(() =>
    mapSharedResponsibilities(id(1), month, { ...data(), ...patch }),
  ).toThrow(),
);
test('zero responsibility is real data, and different currencies remain separate entries', () => {
  const value = {
    ...data(),
    entries: [
      {
        ...entry(),
        responsibility_amount_minor: 0,
        application_status: 'NO_IMPACT',
      },
      { ...entry(), expense_id: id(51), currency: 'USD' },
    ],
  };
  expect(
    mapSharedResponsibilities(id(1), month, value).entries.map(
      (row) => row.currency,
    ),
  ).toEqual(['UYU', 'USD']);
});
test('legacy unclassified source is never inferred as a canonical bucket', () => {
  const value = {
    ...data(),
    entries: [
      {
        ...entry(),
        budget_classification: null,
        application_status: 'UNCLASSIFIED',
      },
    ],
  };
  expect(
    mapSharedResponsibilities(id(1), month, value).entries[0]
      .budget_classification,
  ).toBeNull();
});
test('closed applied and pending sources remain distinct while totals are never manufactured', () => {
  const value = {
    ...data(),
    period: { id: id(90), status: 'CLOSED', base_currency: 'UYU' },
    entries: [
      {
        ...entry(),
        application_status: 'CLOSED_INCLUDED',
        included_in_closed_period: true,
      },
      {
        ...entry(),
        expense_id: id(51),
        application_status: 'CLOSED_PENDING',
        included_in_closed_period: false,
      },
    ],
  };
  expect(
    mapSharedResponsibilities(id(1), month, value).entries.map(
      (row) => row.included_in_closed_period,
    ),
  ).toEqual([true, false]);
  expect(() =>
    mapSharedResponsibilities(id(1), month, {
      ...value,
      entries: [{ ...value.entries[0], application_status: 'CLOSED_PENDING' }],
    }),
  ).toThrow();
});
test('cache separates account/month and RPC retains cancellation', async () => {
  expect(sharedResponsibilityKey(id(1), month)).not.toEqual(
    sharedResponsibilityKey(id(2), month),
  );
  expect(sharedResponsibilityKey(id(1), month)).not.toEqual(
    sharedResponsibilityKey(id(1), '2025-02-01'),
  );
  const signal = new AbortController().signal;
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: data(), error: null });
  jest.mocked(supabase.rpc).mockReturnValue({ abortSignal } as never);
  await expect(
    readSharedResponsibilities(id(1), month, signal),
  ).resolves.toEqual(data());
  expect(abortSignal).toHaveBeenCalledWith(signal);
  expect(supabase.rpc).toHaveBeenCalledWith('get_my_shared_responsibilities', {
    p_month: month,
  });
});
