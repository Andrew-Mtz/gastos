import type { SharedExpense } from '../shared-expense-data';
import type { SharedExpensePage } from '../shared-expense-history-data';
export const historyId = (n: number) =>
  `f2090000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const historyExpense = (
  n = 100,
  date = '2026-10-01',
): SharedExpense => ({
  profile_id: historyId(1),
  household_id: historyId(20),
  expense_id: historyId(n),
  transaction_id: historyId(n),
  created_by: historyId(1),
  payer_member_id: historyId(41),
  template_id: historyId(30),
  template_version: 1,
  amount_minor: 101,
  currency: 'USD',
  transaction_date: date,
  description: `Gasto ${n}`,
  budget_classification: 'NEEDS',
  splits: [
    {
      member_id: historyId(40),
      basis_points: 7000,
      responsibility_amount_minor: 71,
    },
    {
      member_id: historyId(41),
      basis_points: 3000,
      responsibility_amount_minor: 30,
    },
    {
      member_id: historyId(42),
      basis_points: 0,
      responsibility_amount_minor: 0,
    },
  ],
});
export const historyPage = (
  expenses = [historyExpense()],
  next: string | null = null,
): SharedExpensePage => ({
  profile_id: historyId(1),
  household_id: historyId(20),
  expenses,
  next_cursor: next,
  members: [
    { id: historyId(40), display_name: 'Ana' },
    { id: historyId(41), display_name: 'Beatriz' },
  ],
});

export const historyDetail = (
  row = historyExpense(),
  members = historyPage().members,
) => ({
  profile_id: row.profile_id,
  household_id: row.household_id,
  expense: row,
  members,
});
