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
  form: { amount: '1000', date: '2026-10-20', description: 'Salary' },
};
export const profile = {
  id: period.profile_id,
  display_name: 'Test',
  base_currency: 'USD',
  timezone: 'UTC',
  created_at: '',
  updated_at: '',
};
