import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { mapSharedExpense, type SharedExpense } from './shared-expense-data';

const uuid = z.uuid().transform((value) => value.toLowerCase());
export const sharedExpensePageSize = 20;
export const sharedExpenseHistoryKey = (
  profileId: string,
  householdId: string,
) => ['shared-expense-history', profileId, householdId] as const;
export const sharedExpenseHistoryListKey = (
  profileId: string,
  householdId: string,
) => [...sharedExpenseHistoryKey(profileId, householdId), 'list'] as const;
export const sharedExpenseHistoryDetailKey = (
  profileId: string,
  householdId: string,
  expenseId: string,
) =>
  [
    ...sharedExpenseHistoryKey(profileId, householdId),
    'detail',
    expenseId,
  ] as const;

export type SharedExpensePage = {
  profile_id: string;
  household_id: string;
  expenses: SharedExpense[];
  next_cursor: string | null;
  members: HistoryMember[];
};
const membersSchema = z
  .array(
    z.strictObject({
      id: uuid,
      display_name: z
        .string()
        .trim()
        .min(1)
        .refine((value) => Array.from(value).length <= 100),
    }),
  )
  .min(1)
  .refine(
    (members) =>
      new Set(members.map((member) => member.id)).size === members.length,
  );
type HistoryMember = z.infer<typeof membersSchema>[number];
const pageSchema = z.strictObject({
  profile_id: uuid,
  household_id: uuid,
  expenses: z.array(z.unknown()).max(50),
  next_cursor: uuid.nullable(),
  members: membersSchema,
});
export function mapSharedExpensePage(
  profileId: string,
  householdId: string,
  value: unknown,
  before: string | null = null,
  limit = sharedExpensePageSize,
): SharedExpensePage {
  const owner = uuid.parse(profileId);
  const household = uuid.parse(householdId);
  const cursor = uuid.nullable().parse(before);
  z.number().int().min(1).max(50).parse(limit);
  const page = pageSchema.parse(value);
  if (
    page.profile_id !== owner ||
    page.household_id !== household ||
    page.expenses.length > limit
  )
    throw new Error('Invalid household history scope or page size.');
  const expenses = page.expenses.map((value) => {
    const identity = z.object({ expense_id: uuid }).parse(value);
    // Validate every row, including exact historical rounding, before exposing any.
    return mapSharedExpense(owner, household, identity.expense_id, value);
  });
  if (
    new Set(expenses.map((row) => row.expense_id)).size !== expenses.length ||
    expenses.some((row, index) => {
      if (row.expense_id === cursor) return true;
      const previous = expenses[index - 1];
      return (
        previous &&
        (row.transaction_date > previous.transaction_date ||
          (row.transaction_date === previous.transaction_date &&
            row.expense_id >= previous.expense_id))
      );
    }) ||
    (page.next_cursor !== null &&
      (expenses.length !== limit ||
        page.next_cursor !== expenses.at(-1)?.expense_id))
  )
    throw new Error('Invalid household history ordering or cursor.');
  return { ...page, expenses };
}
export function sharedExpenseHistoryRows(pages: SharedExpensePage[]) {
  const rows = pages.flatMap((page) => page.expenses);
  // Pages are individually parsed, but also reject duplication/order discontinuity
  // across page boundaries. Never silently deduplicate or drop a malformed result.
  if (
    pages.some((page, index) => {
      const previous = pages[index - 1];
      if (!previous) return false;
      const last = previous.expenses.at(-1);
      const first = page.expenses[0];
      return (
        page.profile_id !== previous.profile_id ||
        page.household_id !== previous.household_id ||
        !previous.next_cursor ||
        !last ||
        (first &&
          (first.transaction_date > last.transaction_date ||
            (first.transaction_date === last.transaction_date &&
              first.expense_id >= last.expense_id)))
      );
    }) ||
    new Set(rows.map((row) => row.expense_id)).size !== rows.length
  )
    throw new Error('Invalid household history page continuity.');
  return rows;
}
export async function readSharedExpensePage(
  profileId: string,
  householdId: string,
  before: string | null = null,
  signal?: AbortSignal,
) {
  uuid.parse(profileId);
  const cursor = uuid.nullable().parse(before);
  const query = supabase.rpc('list_shared_expenses', {
    p_household_id: uuid.parse(householdId),
    p_limit: sharedExpensePageSize,
    ...(cursor === null ? {} : { p_before_expense_id: cursor }),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapSharedExpensePage(profileId, householdId, data, cursor);
}

const detailSchema = z.strictObject({
  profile_id: uuid,
  household_id: uuid,
  expense: z.unknown(),
  members: membersSchema,
});
export function mapSharedExpenseHistoryDetail(
  profileId: string,
  householdId: string,
  expenseId: string,
  value: unknown,
) {
  const detail = detailSchema.parse(value);
  if (
    detail.profile_id !== uuid.parse(profileId) ||
    detail.household_id !== uuid.parse(householdId)
  )
    throw new Error('Invalid household history detail scope.');
  return {
    ...detail,
    expense: mapSharedExpense(
      profileId,
      householdId,
      expenseId,
      detail.expense,
    ),
  };
}
export async function readSharedExpenseHistoryDetail(
  profileId: string,
  householdId: string,
  expenseId: string,
  signal?: AbortSignal,
) {
  uuid.parse(profileId);
  const query = supabase.rpc('get_shared_expense_history_detail', {
    p_household_id: uuid.parse(householdId),
    p_expense_id: uuid.parse(expenseId),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapSharedExpenseHistoryDetail(profileId, householdId, expenseId, data);
}
