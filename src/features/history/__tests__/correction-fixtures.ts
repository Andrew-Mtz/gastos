import {
  type CorrectionContext,
  type CorrectionTarget,
} from '../correction-data';
import { category, period, profile } from '../../expense/__tests__/fixtures';
export const target: CorrectionTarget = {
  id: 'f1220000-0000-4000-8000-000000000001',
  owner_profile_id: profile.id,
  budget_period_id: period.id,
  scope: 'PERSONAL',
  type: 'EXPENSE',
  amount_minor: 12345,
  currency: 'USD',
  transaction_date: '2026-10-20',
  category_id: category.id,
  description: 'Lunch',
  deleted_at: null,
  revision: 3,
  savings_goal_id: null,
  recurring_template_id: null,
  recurring_month: null,
  savings_validated: false,
  withdrawal_confirmed: false,
};
export const context: CorrectionContext = {
  target,
  period,
  categories: [category],
  allCategories: [category],
};
