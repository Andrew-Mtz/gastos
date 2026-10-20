import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { createTransaction } from '../../domain/transaction/transaction';

export const monthSchema = z.iso
  .date()
  .refine((value) => value >= '0001-01-01' && value.endsWith('-01'));
export function monthBounds(month: string) {
  const value = monthSchema.parse(month);
  const [year, number] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    number - 1
  ];
  return { start: value, end: `${value.slice(0, 7)}-${days}` };
}
export function shiftMonth(month: string, delta: -1 | 1): string {
  monthSchema.parse(month);
  const [year, number] = month.split('-').map(Number);
  const index = (year - 1) * 12 + number - 1 + delta;
  if (index < 0 || index >= 9999 * 12) return month;
  return `${String(Math.floor(index / 12) + 1).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}
export const historyOwnerKey = (profileId: string) =>
  ['history', profileId] as const;
export const historyKey = (profileId: string, month: string) =>
  [...historyOwnerKey(profileId), month] as const;
const cursorSchema = z.object({ date: z.iso.date(), id: z.uuid() });
export type HistoryCursor = z.infer<typeof cursorSchema>;
const rowSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  budget_period_id: z.uuid(),
  scope: z.string(),
  type: z.string(),
  amount_minor: z.number(),
  currency: z.string(),
  transaction_date: z.iso.date(),
  category_id: z.uuid().nullable(),
  description: z.string().nullable(),
  deleted_at: z.string().nullable(),
  category: z.object({ name: z.string() }).nullable(),
});
const pageSize = 50;
export async function readHistory(
  profileId: string,
  month: string,
  cursor: HistoryCursor | null,
  signal?: AbortSignal,
) {
  const bounds = monthBounds(month);
  let query = supabase
    .from('transactions')
    .select('*,category:categories!transactions_category_owner_fkey(name)')
    .eq('owner_profile_id', z.uuid().parse(profileId))
    .eq('scope', 'PERSONAL')
    .is('deleted_at', null)
    .gte('transaction_date', bounds.start)
    .lte('transaction_date', bounds.end)
    .order('transaction_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(pageSize + 1);
  if (cursor) {
    const parsed = cursorSchema.parse(cursor);
    query = query.or(
      `transaction_date.lt.${parsed.date},and(transaction_date.eq.${parsed.date},id.lt.${parsed.id})`,
    );
  }
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const rows = z.array(rowSchema).parse(data);
  const items = rows.slice(0, pageSize).map((row) => ({
    transaction: createTransaction({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      budgetPeriodId: row.budget_period_id,
      scope: row.scope,
      type: row.type,
      amountMinor: row.amount_minor,
      currency: row.currency,
      transactionDate: row.transaction_date,
      categoryId: row.category_id,
      description: row.description,
      deletedAt: row.deleted_at,
    }),
    categoryName: row.category?.name ?? null,
  }));
  const last = items.at(-1)?.transaction;
  return {
    items,
    nextCursor:
      rows.length > pageSize && last
        ? { date: last.transactionDate, id: last.id }
        : null,
  };
}
export type HistoryPage = Awaited<ReturnType<typeof readHistory>>;
