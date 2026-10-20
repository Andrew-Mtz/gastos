import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import { createTransaction } from '../../domain/transaction/transaction';
import { readBudget } from '../budget/budget-data';
import { categoryRowSchema, eligibleCategories } from '../expense/expense-data';
import {
  currencyDigits,
  parseDecimal,
  type BudgetPeriod,
} from '../budget/budget-setup';
import { validateIncomeForm, isRejectedIncome } from '../income/income-form';
import { historyOwnerKey } from './history-data';

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const correctionRowSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  budget_period_id: z.uuid(),
  scope: z.literal('PERSONAL'),
  type: z.enum([
    'INCOME',
    'EXPENSE',
    'SAVINGS_CONTRIBUTION',
    'SAVINGS_WITHDRAWAL',
  ]),
  amount_minor: safeInteger.positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  transaction_date: z.iso.date(),
  category_id: z.uuid().nullable(),
  description: z.string().nullable(),
  deleted_at: z.iso.datetime({ offset: true }).nullable(),
  revision: safeInteger,
  savings_goal_id: z.uuid().nullable(),
  recurring_template_id: z.uuid().nullable(),
  recurring_month: z.iso.date().nullable(),
  savings_validated: z.boolean(),
  withdrawal_confirmed: z.boolean(),
});
export type CorrectionTarget = z.infer<typeof correctionRowSchema>;
export function parseCorrectionTarget(value: unknown): CorrectionTarget {
  const row = correctionRowSchema.parse(value);
  createTransaction({
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
  });
  if (
    (row.recurring_template_id === null) !== (row.recurring_month === null) ||
    (row.recurring_template_id !== null &&
      (row.type !== 'EXPENSE' ||
        row.recurring_month !== `${row.transaction_date.slice(0, 7)}-01`)) ||
    (row.savings_goal_id !== null && !row.type.startsWith('SAVINGS_'))
  )
    throw new Error('Invalid correction identity.');
  return row;
}
export const correctionKey = (owner: string, id: string) =>
  [...historyOwnerKey(owner), 'transaction', id] as const;
export const revisionsKey = (owner: string, id: string) =>
  [...correctionKey(owner, id), 'revisions'] as const;
export async function readCorrectionContext(
  owner: string,
  id: string,
  signal?: AbortSignal,
) {
  const query = supabase
    .from('transactions')
    .select('*')
    .eq('owner_profile_id', z.uuid().parse(owner))
    .eq('id', z.uuid().parse(id));
  const { data, error } = await (
    signal ? query.abortSignal(signal) : query
  ).single();
  if (error) throw error;
  const target = parseCorrectionTarget(data);
  if (target.id !== id || target.owner_profile_id !== owner)
    throw new Error('Wrong transaction.');
  const month = `${target.transaction_date.slice(0, 7)}-01`;
  const categoryQuery = supabase
    .from('categories')
    .select('*')
    .eq('profile_id', owner)
    .order('name')
    .order('id');
  const [budget, categories] = await Promise.all([
    readBudget(owner, month, signal),
    signal ? categoryQuery.abortSignal(signal) : categoryQuery,
  ]);
  if (categories.error) throw categories.error;
  const allCategories = z.array(categoryRowSchema).parse(categories.data);
  if (
    !budget.period ||
    budget.period.id !== target.budget_period_id ||
    budget.period.profile_id !== owner ||
    allCategories.some((c) => c.profile_id !== owner)
  )
    throw new Error('Wrong correction context.');
  return {
    target,
    period: budget.period,
    allCategories,
    categories: eligibleCategories(allCategories, budget.buckets),
  };
}
export type CorrectionContext = Awaited<
  ReturnType<typeof readCorrectionContext>
>;
const changesSchema = z
  .object({
    amount_minor: safeInteger.positive(),
    transaction_date: z.iso.date(),
    category_id: z.uuid().nullable(),
    description: z.string().max(500).nullable(),
  })
  .strict();
export type CorrectionChanges = z.infer<typeof changesSchema>;
export type CorrectionAction = 'EDIT' | 'DELETE' | 'RESTORE';
export type CorrectionRequest = Readonly<{
  id: string;
  target: CorrectionTarget;
  action: CorrectionAction;
  changes: CorrectionChanges | null;
}>;
export function correctionFormSchema(period: BudgetPeriod) {
  return validateIncomeForm(period).safeExtend({
    categoryId: z.uuid().nullable(),
    description: z.string().max(500, 'Usa hasta 500 caracteres.'),
  });
}
export type CorrectionForm = z.infer<ReturnType<typeof correctionFormSchema>>;
export function amountInput(target: CorrectionTarget) {
  const digits = currencyDigits(target.currency),
    value = String(target.amount_minor).padStart(digits + 1, '0');
  return digits ? `${value.slice(0, -digits)}.${value.slice(-digits)}` : value;
}
export function buildCorrectionRequest(
  id: string,
  context: CorrectionContext,
  action: CorrectionAction,
  form?: CorrectionForm,
): CorrectionRequest {
  const target = parseCorrectionTarget(context.target);
  z.uuid().parse(id);
  if (
    context.period.status !== 'OPEN' ||
    (action !== 'DELETE' && target.currency !== context.period.base_currency)
  )
    throw new Error('An open matching-currency period is required.');
  if ((action === 'RESTORE') !== (target.deleted_at !== null))
    throw new Error('Invalid transaction state.');
  let changes: CorrectionChanges | null = null;
  if (action === 'EDIT') {
    const parsed = correctionFormSchema(context.period).parse(form);
    if (parsed.categoryId !== target.category_id) {
      if (
        target.type !== 'EXPENSE' ||
        target.recurring_template_id ||
        !context.categories.some((c) => c.id === parsed.categoryId)
      )
        throw new Error('Invalid category correction.');
    }
    changes = changesSchema.parse({
      amount_minor: parseDecimal(
        parsed.amount,
        currencyDigits(target.currency),
      ),
      transaction_date: parsed.date,
      category_id: parsed.categoryId,
      description: parsed.description.trim() || null,
    });
  }
  return { id, target, action, changes };
}
export async function correctTransaction(request: CorrectionRequest) {
  const target = parseCorrectionTarget(request.target);
  const action = z.enum(['EDIT', 'DELETE', 'RESTORE']).parse(request.action);
  const changes = action === 'EDIT' ? changesSchema.parse(request.changes) : {};
  if (action !== 'EDIT' && request.changes !== null)
    throw new Error('Unexpected changes.');
  const { data, error } = await supabase.rpc('correct_personal_transaction', {
    p_request_id: z.uuid().parse(request.id),
    p_transaction_id: target.id,
    p_expected_revision: target.revision,
    p_action: action,
    p_changes: changes,
    p_confirmed: true,
  });
  if (error) throw error;
  const row = parseCorrectionTarget(data);
  const expected = action === 'EDIT' ? changesSchema.parse(changes) : target;
  if (
    row.id !== target.id ||
    row.owner_profile_id !== target.owner_profile_id ||
    row.budget_period_id !== target.budget_period_id ||
    row.type !== target.type ||
    row.currency !== target.currency ||
    row.savings_goal_id !== target.savings_goal_id ||
    row.recurring_template_id !== target.recurring_template_id ||
    row.recurring_month !== target.recurring_month ||
    row.revision !== target.revision + 1 ||
    row.amount_minor !== expected.amount_minor ||
    row.transaction_date !== expected.transaction_date ||
    row.category_id !== expected.category_id ||
    row.description !== expected.description ||
    (row.deleted_at !== null) !== (action === 'DELETE')
  )
    throw new Error('Correction response does not match its request.');
  return row;
}
export async function readRevisionPage(
  owner: string,
  id: string,
  before: number | null,
  signal?: AbortSignal,
) {
  let query = supabase
    .from('transaction_revisions')
    .select('*')
    .eq('owner_profile_id', z.uuid().parse(owner))
    .eq('transaction_id', z.uuid().parse(id))
    .order('revision', { ascending: false })
    .limit(21);
  if (before !== null)
    query = query.lt('revision', safeInteger.positive().parse(before));
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  const rows = z
    .array(
      z.object({
        transaction_id: z.uuid(),
        owner_profile_id: z.uuid(),
        revision: safeInteger.positive(),
        action: z.enum(['EDIT', 'DELETE', 'RESTORE']),
        recorded_at: z.iso.datetime({ offset: true }),
        before_state: correctionRowSchema,
        after_state: correctionRowSchema,
      }),
    )
    .parse(data);
  const items = rows.slice(0, 20).map((row) => {
    const previous = parseCorrectionTarget(row.before_state),
      next = parseCorrectionTarget(row.after_state);
    if (
      row.transaction_id !== id ||
      row.owner_profile_id !== owner ||
      previous.id !== id ||
      next.id !== id ||
      previous.owner_profile_id !== owner ||
      next.owner_profile_id !== owner ||
      next.revision !== row.revision ||
      previous.revision + 1 !== row.revision
    )
      throw new Error('Wrong correction history.');
    return { ...row, before_state: previous, after_state: next };
  });
  return {
    items,
    nextCursor: rows.length > 20 ? items.at(-1)!.revision : null,
  };
}
export function correctionErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '40001' || code === '23505')
    return 'El movimiento cambió. Actualiza y revisa la versión nueva antes de corregirlo.';
  if (code === '42501')
    return 'Revisa tu sesión, que el mes siga abierto y que la categoría esté activa.';
  if (code === '23514')
    return 'La corrección no es válida o dejaría ahorros o una meta sin fondos. Revisa el importe y la fecha.';
  if (code === '22003') return 'El importe o total supera el máximo admitido.';
  if (code === '22023' || code === '23502')
    return 'Revisa los campos de la corrección.';
  return 'No se pudo confirmar el resultado. Comprueba la misma operación pendiente; no crees otra.';
}
export function isRejectedCorrection(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  return (
    isRejectedIncome(error) ||
    ['40001', '22023', '0A000', '22007', '22008', '22P02'].includes(
      String(code),
    )
  );
}
