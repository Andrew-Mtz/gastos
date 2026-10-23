import { z } from 'zod';
import { createMoney } from '../../domain/money/money';
import { calculateSharedExpenseSplit } from '../../domain/shared-expenses/shared-expense-split';
import { sameHouseholdRoster } from '../../domain/household/default-split';
import { supabase } from '../../infrastructure/supabase/client';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const amount = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[A-Z]{3}$/);
const date = z.iso.date().refine((value) => value >= '0001-01-01');
const description = z
  .string()
  .refine((value) => Array.from(value).length <= 500)
  .nullable();
const version = z.number().int().min(1).max(2147483647);

// Persistence input: FIN-208 restricts new entry to household currency, no category.
// Caller supplies template identity, never authoritative responsibility amounts.
export const sharedExpenseRequestSchema = z
  .strictObject({
    id: uuid,
    householdId: uuid,
    payerMemberId: uuid,
    templateId: uuid,
    templateVersion: version,
    roster: z.array(uuid).min(1),
    amountMinor: amount,
    currency,
    transactionDate: date,
    description,
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.roster).size !== value.roster.length ||
      !value.roster.includes(value.payerMemberId)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'A unique complete roster containing the payer is required.',
      });
  });
export type SharedExpenseRequest = z.infer<typeof sharedExpenseRequestSchema>;
const expenseSchema = z.strictObject({
  profile_id: uuid,
  expense_id: uuid,
  transaction_id: uuid,
  household_id: uuid,
  created_by: uuid,
  payer_member_id: uuid,
  template_id: uuid,
  template_version: version,
  amount_minor: amount,
  currency,
  transaction_date: date,
  description,
  splits: z
    .array(
      z.strictObject({
        member_id: uuid,
        basis_points: z.number().int().min(0).max(10000),
        responsibility_amount_minor: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1),
});
export type SharedExpense = z.infer<typeof expenseSchema>;
export function mapSharedExpense(
  profileId: string,
  householdId: string,
  expenseId: string,
  value: unknown,
): SharedExpense {
  const result = expenseSchema.parse(value);
  if (
    result.profile_id !== uuid.parse(profileId) ||
    result.household_id !== uuid.parse(householdId) ||
    result.expense_id !== uuid.parse(expenseId) ||
    result.transaction_id !== result.expense_id ||
    !result.splits.some((share) => share.member_id === result.payer_member_id)
  )
    throw new Error('Invalid shared expense scope or identity.');
  const expected = calculateSharedExpenseSplit(
    createMoney(result.amount_minor, result.currency),
    result.splits.map((share) => ({
      memberId: share.member_id,
      basisPoints: share.basis_points,
    })),
  );
  if (
    expected.some(
      (share, index) =>
        share.memberId !== result.splits[index].member_id ||
        share.responsibilityAmount.amountMinor !==
          result.splits[index].responsibility_amount_minor,
    )
  )
    throw new Error('Invalid shared expense historical responsibility.');
  return result;
}
export function mapSharedExpenseReceipt(
  profileId: string,
  input: SharedExpenseRequest,
  value: unknown,
) {
  const request = sharedExpenseRequestSchema.parse(input);
  const result = mapSharedExpense(
    profileId,
    request.householdId,
    request.id,
    value,
  );
  if (
    result.created_by !== uuid.parse(profileId) ||
    result.payer_member_id !== request.payerMemberId ||
    result.template_id !== request.templateId ||
    result.template_version !== request.templateVersion ||
    result.amount_minor !== request.amountMinor ||
    result.currency !== request.currency ||
    result.transaction_date !== request.transactionDate ||
    result.description !== request.description ||
    !sameHouseholdRoster(
      request.roster,
      result.splits.map((share) => share.member_id),
    )
  )
    throw new Error(
      'Shared expense receipt does not match the original request.',
    );
  return result;
}
export async function createSharedExpense(
  profileId: string,
  input: SharedExpenseRequest,
) {
  uuid.parse(profileId);
  const request = sharedExpenseRequestSchema.parse(input);
  const { data, error } = await supabase.rpc('create_shared_expense', {
    p_request_id: request.id,
    p_household_id: request.householdId,
    p_payer_member_id: request.payerMemberId,
    p_template_id: request.templateId,
    p_template_version: request.templateVersion,
    p_roster: request.roster,
    p_amount_minor: request.amountMinor,
    p_currency: request.currency,
    p_transaction_date: request.transactionDate,
    ...(request.description === null
      ? {}
      : { p_description: request.description }),
  });
  if (error) throw error;
  return mapSharedExpenseReceipt(profileId, request, data);
}
export async function readSharedExpense(
  profileId: string,
  householdId: string,
  expenseId: string,
  signal?: AbortSignal,
) {
  uuid.parse(profileId);
  const query = supabase.rpc('get_shared_expense', {
    p_household_id: uuid.parse(householdId),
    p_expense_id: uuid.parse(expenseId),
  });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapSharedExpense(profileId, householdId, expenseId, data);
}
