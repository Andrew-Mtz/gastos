import { type BudgetPeriod } from '../../budget/budget-setup';
export const period: BudgetPeriod = {
  id: 'f1030000-0000-4000-8000-000000000001',
  profile_id: 'f0050000-0000-4000-8000-000000000001',
  starts_on: '2026-10-01',
  ends_on: '2026-10-31',
  status: 'OPEN',
  base_currency: 'USD',
  expected_income_minor: 150000,
};
export const request = {
  id: 'f1090000-0000-4000-8000-000000000001',
  form: {
    amount: '1000',
    date: '2026-10-20',
    description: 'Food',
    categoryId: 'f1070000-0000-4000-8000-000000000001',
  },
};
export const profile = {
  id: period.profile_id,
  display_name: 'Test',
  base_currency: 'USD',
  timezone: 'UTC',
  created_at: '',
  updated_at: '',
};

export const bucket = {
  id: 'f1040000-0000-4000-8000-000000000001',
  profile_id: profile.id,
  name: 'Needs',
  type: 'SPENDABLE' as const,
  is_system: false,
  system_key: null,
  archived_at: null,
};
export const category = {
  id: request.form.categoryId,
  profile_id: profile.id,
  name: 'Food',
  budget_bucket_id: bucket.id,
  archived_at: null,
};
