import { period, profile } from '../../income/__tests__/fixtures';
export { period, profile };
export function snapshot() {
  const spendable = 'f1040000-0000-4000-8000-000000000001';
  const savings = 'f1040000-0000-4000-8000-000000000002';
  return {
    shared_responsibilities: {
      owner_profile_id: profile.id,
      month: period.starts_on,
      period: {
        id: period.id,
        status: period.status,
        base_currency: period.base_currency,
      },
      entries: [],
    },
    snapshot_version: 2 as const,
    owner_profile_id: profile.id,
    month: period.starts_on,
    period: { ...period, expected_income_minor: 99999 },
    received_income_minor: 1000,
    allocations: [
      {
        budget_period_id: period.id,
        budget_bucket_id: spendable,
        percentage_basis_points: 8000,
      },
      {
        budget_period_id: period.id,
        budget_bucket_id: savings,
        percentage_basis_points: 2000,
      },
    ],
    buckets: [
      {
        id: spendable,
        profile_id: profile.id,
        name: 'Necesidades',
        type: 'SPENDABLE',
        is_system: true,
        system_key: 'NEEDS',
        archived_at: null as string | null,
      },
      {
        id: savings,
        profile_id: profile.id,
        name: 'Ahorro',
        type: 'SAVINGS',
        is_system: true,
        system_key: 'SAVINGS',
        archived_at: null as string | null,
      },
    ],
    consumption: {
      budget_period_id: period.id,
      base_currency: 'USD',
      buckets: [
        {
          budget_bucket_id: spendable,
          name: 'Necesidades',
          system_key: 'NEEDS',
          spent_minor: 150,
        },
      ],
    },
    availability: {
      savings: {
        budget_period_id: period.id,
        base_currency: 'USD',
        configured: true,
        snapshot_version: 2 as const,
        carry: {
          incoming_minor: 0,
          outgoing_minor: 0,
          unallocated_minor: 0,
          buckets: [] as { budget_bucket_id: string; amount_minor: number }[],
        },
        opening_protected_minor: 500,
        allocated_savings_minor: 200,
        contributions_minor: 100,
        withdrawals_minor: 50,
        spendable_allocated_minor: 800,
        spent_minor: 150,
        goal_reserved_minor: 100,
        unassigned_savings_minor: 650,
      },
      commitments: {
        owner_profile_id: profile.id,
        budget_period_id: period.id,
        month: period.starts_on,
        base_currency: 'USD',
        prior_unresolved_count: 0,
        buckets: [
          {
            budget_bucket_id: spendable,
            name: 'Necesidades',
            confirmed_minor: 100,
            estimated_minor: 20,
            confirmed_count: 1,
            estimated_count: 1,
            unknown_count: 0,
          },
        ],
      },
    },
    upcoming: [
      {
        template_id: 'f1170000-0000-4000-8000-000000000001',
        name: 'Alquiler',
        amount_mode: 'FIXED',
        default_amount_minor: 100 as number | null,
        currency: 'USD',
        due_date: '2026-10-01',
      },
      {
        template_id: 'f1170000-0000-4000-8000-000000000002',
        name: 'Electricidad',
        amount_mode: 'VARIABLE',
        default_amount_minor: 20 as number | null,
        currency: 'USD',
        due_date: '2026-10-31',
      },
    ],
  };
}
