import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { recurringMonthSchema } from '../recurring/recurring-form';
import { sharedBudgetClassificationSchema } from '../household/shared-expense-data';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const currency = z.string().regex(/^[A-Z]{3}$/);
export const sharedResponsibilityKey = (owner: string, month: string) =>
  [...recurringOwnerKey(owner), 'shared-responsibilities', month] as const;
const snapshotSchema = z.strictObject({
  owner_profile_id: uuid,
  month: recurringMonthSchema,
  period: z
    .strictObject({
      id: uuid,
      status: z.enum(['OPEN', 'CLOSED']),
      base_currency: currency,
    })
    .nullable(),
  entries: z.array(
    z.strictObject({
      expense_id: uuid,
      household_id: uuid,
      household_name: z.string().trim().min(1).nullable(),
      transaction_date: z.iso.date(),
      description: z
        .string()
        .refine((value) => Array.from(value).length <= 500)
        .nullable(),
      budget_classification: sharedBudgetClassificationSchema.nullable(),
      responsibility_amount_minor: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
      currency,
      application_status: z.enum([
        'NO_IMPACT',
        'APPLIED',
        'NO_PERIOD',
        'NO_BUCKET',
        'OTHER_CURRENCY',
        'UNCLASSIFIED',
        'CLOSED_INCLUDED',
        'CLOSED_PENDING',
      ]),
      included_in_closed_period: z.boolean().nullable(),
    }),
  ),
});
export function mapSharedResponsibilities(
  owner: string,
  month: string,
  value: unknown,
) {
  const result = snapshotSchema.parse(value);
  if (
    result.owner_profile_id !== uuid.parse(owner) ||
    result.month !== recurringMonthSchema.parse(month) ||
    new Set(result.entries.map((entry) => entry.expense_id)).size !==
      result.entries.length ||
    result.entries.some((entry, index) => {
      const previous = result.entries[index - 1];
      return (
        entry.transaction_date.slice(0, 7) !== month.slice(0, 7) ||
        (result.period?.status === 'CLOSED'
          ? entry.included_in_closed_period === null
          : entry.included_in_closed_period !== null) ||
        (entry.included_in_closed_period === true &&
          (entry.budget_classification === null ||
            entry.currency !== result.period?.base_currency)) ||
        (entry.budget_classification === null &&
          entry.application_status !== 'NO_IMPACT') !==
          (entry.application_status === 'UNCLASSIFIED') ||
        (entry.application_status === 'NO_IMPACT') !==
          (entry.responsibility_amount_minor === 0) ||
        (entry.application_status === 'NO_PERIOD' && result.period !== null) ||
        (!result.period &&
          !['NO_PERIOD', 'UNCLASSIFIED', 'NO_IMPACT'].includes(
            entry.application_status,
          )) ||
        (entry.application_status === 'OTHER_CURRENCY' &&
          (!result.period || entry.currency === result.period.base_currency)) ||
        (entry.application_status === 'APPLIED' &&
          (result.period?.status !== 'OPEN' ||
            entry.currency !== result.period.base_currency)) ||
        (entry.application_status === 'NO_BUCKET' &&
          (result.period?.status !== 'OPEN' ||
            entry.currency !== result.period.base_currency)) ||
        (entry.application_status === 'CLOSED_INCLUDED' &&
          entry.included_in_closed_period !== true) ||
        (entry.application_status === 'CLOSED_PENDING' &&
          entry.included_in_closed_period !== false) ||
        (previous &&
          `${previous.transaction_date}/${previous.expense_id}` >=
            `${entry.transaction_date}/${entry.expense_id}`)
      );
    })
  )
    throw new Error('Invalid private shared responsibility snapshot.');
  return result;
}
export type SharedResponsibilities = ReturnType<
  typeof mapSharedResponsibilities
>;
export async function readSharedResponsibilities(
  owner: string,
  month: string,
  signal?: AbortSignal,
) {
  uuid.parse(owner);
  const query = supabase.rpc('get_my_shared_responsibilities', {
    p_month: recurringMonthSchema.parse(month),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapSharedResponsibilities(owner, month, data);
}
