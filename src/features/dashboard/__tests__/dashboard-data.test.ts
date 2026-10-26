import { supabase } from '../../../infrastructure/supabase/client';
import { dashboardKey, mapDashboard, readDashboard } from '../dashboard-data';
import { recurringOwnerKey } from '../../recurring/recurring-data';
import { period, profile, snapshot } from './fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
beforeEach(() => jest.clearAllMocks());
const map = (data: unknown) => mapDashboard(profile.id, period.starts_on, data);
test('one abortable owner/month RPC; exact existing formula and distinct allocation/cumulative figures', async () => {
  const query = Object.assign(
    Promise.resolve({ data: snapshot(), error: null }),
    { abortSignal: jest.fn().mockReturnThis() },
  );
  jest.mocked(supabase.rpc).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  const data = await readDashboard(profile.id, period.starts_on, signal);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('get_personal_dashboard', {
    p_month: period.starts_on,
  });
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(data.receivedIncome?.amountMinor).toBe(1000);
  expect(data.expectedIncome?.amountMinor).toBe(99999);
  expect(data.availability?.components.allocated_savings_minor).toBe(200);
  expect(data.availability?.savings.protectedSavings.amountMinor).toBe(750);
  expect(data.availability?.confirmedMargin?.amountMinor).toBe(500);
  expect(data.availability?.estimatedMargin?.amountMinor).toBe(480);
  expect(data.usage?.[0].allocatedAmount?.amountMinor).toBe(800);
  expect(data.usage?.[0].spentAmount.amountMinor).toBe(150);
  expect(dashboardKey(profile.id, period.starts_on).slice(0, 2)).toEqual(
    recurringOwnerKey(profile.id),
  );
  expect(dashboardKey(profile.id, period.starts_on)).not.toEqual(
    dashboardKey(period.id, period.starts_on),
  );
  expect(dashboardKey(profile.id, period.starts_on)).not.toEqual(
    dashboardKey(profile.id, '2026-11-01'),
  );
});
test('missing period is not a zero availability and does not require secondary reads', () => {
  expect(
    map({
      snapshot_version: 2,
      owner_profile_id: profile.id,
      month: period.starts_on,
      period: null,
    }),
  ).toEqual({ period: null, sharedResponsibilities: null });
});
test.each([
  [
    'wrong owner',
    (s: ReturnType<typeof snapshot>) => {
      s.owner_profile_id = period.id;
    },
  ],
  [
    'wrong month',
    (s) => {
      s.month = '2026-11-01';
    },
  ],
  [
    'wrong period owner',
    (s) => {
      s.period.profile_id = period.id;
    },
  ],
  [
    'wrong consumption period',
    (s) => {
      s.consumption.budget_period_id = profile.id;
    },
  ],
  [
    'wrong consumption currency',
    (s) => {
      s.consumption.base_currency = 'EUR';
    },
  ],
  [
    'wrong bucket owner',
    (s) => {
      s.buckets[0].profile_id = period.id;
    },
  ],
  [
    'duplicate bucket',
    (s) => {
      s.buckets.push(s.buckets[0]);
    },
  ],
  [
    'missing classification',
    (s) => {
      s.buckets.pop();
    },
  ],
  [
    'wrong allocation period',
    (s) => {
      s.allocations[0].budget_period_id = profile.id;
    },
  ],
  [
    'duplicate allocation',
    (s) => {
      s.allocations.push(s.allocations[0]);
    },
  ],
  [
    'incomplete allocation',
    (s) => {
      s.allocations.pop();
    },
  ],
  [
    'mismatched income allocation',
    (s) => {
      s.received_income_minor = 2000;
    },
  ],
  [
    'mismatched savings allocation',
    (s) => {
      s.availability.savings.spendable_allocated_minor++;
    },
  ],
  [
    'mismatched consumed total',
    (s) => {
      s.consumption.buckets[0].spent_minor++;
    },
  ],
  [
    'duplicated consumption',
    (s) => {
      s.consumption.buckets.push(s.consumption.buckets[0]);
    },
  ],
  [
    'unsafe income',
    (s) => {
      s.received_income_minor = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'preview count',
    (s) => {
      s.upcoming.pop();
    },
  ],
  [
    'preview duplicate',
    (s) => {
      s.upcoming[1].template_id = s.upcoming[0].template_id;
    },
  ],
  [
    'preview wrong currency',
    (s) => {
      s.upcoming[0].currency = 'EUR';
    },
  ],
  [
    'preview wrong month',
    (s) => {
      s.upcoming[0].due_date = '2026-09-30';
    },
  ],
  [
    'preview unordered',
    (s) => {
      s.upcoming.reverse();
    },
  ],
  [
    'fixed unknown',
    (s) => {
      s.upcoming[0].default_amount_minor = null;
    },
  ],
  [
    'fixed zero',
    (s) => {
      s.upcoming[0].default_amount_minor = 0;
    },
  ],
] satisfies [string, (s: ReturnType<typeof snapshot>) => void][])(
  'rejects %s instead of a partial dashboard',
  (_name, edit) => {
    const s = snapshot();
    edit(s);
    expect(() => map(s)).toThrow();
  },
);
test('unknown, old obligations and absent plans all withhold numeric availability', () => {
  const old = snapshot();
  old.availability.commitments.prior_unresolved_count = 1;
  expect(map(old).availability?.confirmedMargin).toBeNull();
  const unknown = snapshot();
  unknown.availability.commitments.buckets[0].estimated_count = 0;
  unknown.availability.commitments.buckets[0].estimated_minor = 0;
  unknown.availability.commitments.buckets[0].unknown_count = 1;
  unknown.upcoming[1].default_amount_minor = null;
  expect(map(unknown).availability?.estimatedMargin).toBeNull();
  const noPlan = snapshot();
  noPlan.allocations = [];
  noPlan.availability.savings.configured = false;
  noPlan.availability.savings.allocated_savings_minor = 0;
  noPlan.availability.savings.spendable_allocated_minor = 0;
  noPlan.availability.savings.unassigned_savings_minor = 450;
  expect(map(noPlan).availability?.confirmedMargin).toBeNull();
  expect(map(noPlan).usage?.[0].allocatedAmount).toBeNull();
});
test('unallocated archived spending stays visible; known zero estimate remains approximate and negatives survive', () => {
  const s = snapshot();
  const id = 'f1040000-0000-4000-8000-000000000003';
  s.buckets.push({
    ...s.buckets[0],
    id,
    name: 'Archivado',
    archived_at: '2026-10-01',
  });
  s.consumption.buckets.push({
    ...s.consumption.buckets[0],
    budget_bucket_id: id,
    spent_minor: 600,
  });
  s.availability.savings.spent_minor += 600;
  s.availability.commitments.buckets[0].estimated_minor = 0;
  s.upcoming[1].default_amount_minor = 0;
  const result = map(s);
  expect(result.usage?.[1].allocatedAmount?.amountMinor).toBe(0);
  expect(result.usage?.[1].spentAmount.amountMinor).toBe(600);
  expect(result.availability?.confirmedMargin?.amountMinor).toBe(-100);
  expect(result.availability?.estimatedMargin?.amountMinor).toBe(-100);
});
test('five-item preview never limits the complete commitment totals', () => {
  const s = snapshot();
  s.availability.commitments.buckets[0].confirmed_count = 1001;
  s.availability.commitments.buckets[0].confirmed_minor = 1001;
  s.upcoming = Array.from({ length: 5 }, (_, i) => ({
    ...s.upcoming[0],
    template_id: `f1170000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  }));
  expect(map(s).availability?.commitments.unresolvedCount).toBe(1002);
  expect(map(s).availability?.commitments.confirmed.amountMinor).toBe(1001);
});
test('infrastructure errors and bad requests never become an empty dashboard', async () => {
  await expect(readDashboard('invalid', period.starts_on)).rejects.toThrow();
  await expect(readDashboard(profile.id, '2026-10-02')).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: null, error: { code: '23514' } } as never);
  await expect(
    readDashboard(profile.id, period.starts_on),
  ).rejects.toMatchObject({
    reason: 'INCOMPATIBLE_DATA',
  });
});

test.each(['OTHER_CURRENCY', 'UNCLASSIFIED', 'NO_BUCKET'] as const)(
  'live complete dashboard rejects contradictory positive source %s',
  (status) => {
    const s = snapshot();
    expect(() =>
      map({
        ...s,
        shared_responsibilities: {
          ...s.shared_responsibilities,
          entries: [
            {
              expense_id: 'f2100000-0000-4000-8000-000000000050',
              household_id: 'f2100000-0000-4000-8000-000000000020',
              household_name: 'Casa',
              transaction_date: '2026-10-02',
              description: null,
              budget_classification: status === 'UNCLASSIFIED' ? null : 'NEEDS',
              responsibility_amount_minor: 100,
              currency: status === 'OTHER_CURRENCY' ? 'UYU' : 'USD',
              application_status: status,
              included_in_closed_period: null,
            },
          ],
        },
      }),
    ).toThrow();
  },
);
test('closed dashboard may show new foreign facts outside unchanged recognized consumption', () => {
  const s = snapshot();
  const result = map({
    ...s,
    period: { ...s.period, status: 'CLOSED' },
    shared_responsibilities: {
      ...s.shared_responsibilities,
      period: { ...s.shared_responsibilities.period, status: 'CLOSED' },
      entries: [
        {
          expense_id: 'f2100000-0000-4000-8000-000000000050',
          household_id: 'f2100000-0000-4000-8000-000000000020',
          household_name: 'Casa',
          transaction_date: '2026-10-02',
          description: null,
          budget_classification: 'NEEDS',
          responsibility_amount_minor: 250,
          currency: 'UYU',
          application_status: 'CLOSED_PENDING',
          included_in_closed_period: false,
        },
      ],
    },
  });
  expect(result.availability?.components.spent_minor).toBe(150);
  expect(
    result.sharedResponsibilities?.entries[0].responsibility_amount_minor,
  ).toBe(250);
});
