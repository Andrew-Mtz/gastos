import { createRecurringExpense } from '../../../domain/recurring/recurring-expense';
import { period, profile } from '../../income/__tests__/fixtures';
export { period, profile };
export const templateRow = {
  id: 'f1170000-0000-4000-8000-000000000001',
  owner_profile_id: profile.id,
  scope: 'PERSONAL',
  name: 'Electricidad',
  category_id: 'f1070000-0000-4000-8000-000000000001',
  frequency: 'MONTHLY',
  amount_mode: 'VARIABLE',
  default_amount_minor: null,
  currency: 'USD',
  due_day: 31,
  active_from: period.starts_on,
  active_until: null,
  stopped_from: null,
};
export const template = createRecurringExpense({
  id: templateRow.id,
  ownerProfileId: profile.id,
  scope: 'PERSONAL',
  name: templateRow.name,
  categoryId: templateRow.category_id,
  frequency: 'MONTHLY',
  amountMode: 'VARIABLE',
  defaultAmountMinor: null,
  currency: 'USD',
  dueDay: 31,
  activeFrom: period.starts_on,
  activeUntil: null,
  stoppedFrom: null,
});
export const category = {
  id: template.categoryId,
  profile_id: profile.id,
  name: 'Servicios',
  budget_bucket_id: 'f1040000-0000-4000-8000-000000000001',
  archived_at: null,
};
export const createRequest = {
  id: template.id,
  form: {
    name: ' Electricidad ',
    categoryId: template.categoryId,
    amountMode: 'VARIABLE' as const,
    amount: '',
    currency: 'USD',
    dueDay: '31',
    activeFrom: period.starts_on,
    activeUntil: '',
  },
};
export const resolveRequest = {
  id: 'f1180000-0000-4000-8000-000000000001',
  form: { amount: '28.40', date: '2026-10-20', description: ' Actual ' },
};
export const actualRow = {
  id: resolveRequest.id,
  owner_profile_id: profile.id,
  budget_period_id: period.id,
  scope: 'PERSONAL',
  type: 'EXPENSE',
  amount_minor: 2840,
  currency: 'USD',
  transaction_date: '2026-10-20',
  category_id: template.categoryId,
  description: 'Actual',
  deleted_at: null,
  recurring_template_id: template.id,
  recurring_month: period.starts_on,
};
export const snapshot = {
  owner_profile_id: profile.id,
  month: period.starts_on,
  items: [{ template: templateRow, transaction: null }],
  categories: [category],
};
export const screenData = {
  period,
  buckets: [],
  allocations: [],
  categories: [category],
  items: [{ template, actual: null, dueDate: '2026-10-31', status: 'PENDING' }],
};
