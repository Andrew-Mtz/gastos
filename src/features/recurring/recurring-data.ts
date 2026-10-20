import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';
import {
  createRecurringExpense,
  recurringDueDate,
  type RecurringExpense,
} from '../../domain/recurring/recurring-expense';
import { createTransaction } from '../../domain/transaction/transaction';
import { categoryRowSchema } from '../expense/expense-data';
import { readBudget } from '../budget/budget-data';
import {
  currencyDigits,
  parseDecimal,
  type BudgetPeriod,
} from '../budget/budget-setup';
import { validateIncomeForm, type IncomeRequest } from '../income/income-form';
import {
  recurringMonthSchema,
  templateFormSchema,
  type TemplateRequest,
} from './recurring-form';

export const recurringOwnerKey = (profileId: string) =>
  ['recurring', profileId] as const;
export const recurringKey = (profileId: string, month: string) =>
  [...recurringOwnerKey(profileId), month] as const;
const templateRowSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  scope: z.literal('PERSONAL'),
  name: z.string(),
  category_id: z.uuid(),
  frequency: z.literal('MONTHLY'),
  amount_mode: z.enum(['FIXED', 'VARIABLE']),
  default_amount_minor: z.number().nullable(),
  currency: z.string(),
  due_day: z.number(),
  active_from: z.string(),
  active_until: z.string().nullable(),
  stopped_from: z.string().nullable(),
});
function mapTemplate(data: unknown) {
  const r = templateRowSchema.parse(data);
  return createRecurringExpense({
    id: r.id,
    ownerProfileId: r.owner_profile_id,
    scope: r.scope,
    name: r.name,
    categoryId: r.category_id,
    frequency: r.frequency,
    amountMode: r.amount_mode,
    defaultAmountMinor: r.default_amount_minor,
    currency: r.currency,
    dueDay: r.due_day,
    activeFrom: r.active_from,
    activeUntil: r.active_until,
    stoppedFrom: r.stopped_from,
  });
}
const actualSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  budget_period_id: z.uuid(),
  scope: z.literal('PERSONAL'),
  type: z.literal('EXPENSE'),
  amount_minor: z.number(),
  currency: z.string(),
  transaction_date: z.iso.date(),
  category_id: z.uuid(),
  description: z.string().nullable(),
  deleted_at: z.string().nullable(),
  recurring_template_id: z.uuid(),
  recurring_month: recurringMonthSchema,
});
function mapActual(data: unknown) {
  const r = actualSchema.parse(data);
  return {
    ...createTransaction({
      id: r.id,
      ownerProfileId: r.owner_profile_id,
      budgetPeriodId: r.budget_period_id,
      scope: r.scope,
      type: r.type,
      amountMinor: r.amount_minor,
      currency: r.currency,
      transactionDate: r.transaction_date,
      categoryId: r.category_id,
      description: r.description,
      deletedAt: r.deleted_at,
    }),
    recurringTemplateId: r.recurring_template_id,
    recurringMonth: r.recurring_month,
  };
}
export async function readRecurringMonth(
  profileId: string,
  month: string,
  signal?: AbortSignal,
) {
  z.uuid().parse(profileId);
  recurringMonthSchema.parse(month);
  const query = supabase.rpc('get_personal_recurring_month', {
    p_month: month,
  });
  const [{ data, error }, budget] = await Promise.all([
    signal ? query.abortSignal(signal) : query,
    readBudget(profileId, month, signal),
  ]);
  if (error) throw error;
  const result = z
    .object({
      owner_profile_id: z.uuid(),
      month: recurringMonthSchema,
      items: z.array(
        z.object({
          template: templateRowSchema,
          transaction: actualSchema.nullable(),
        }),
      ),
      categories: z.array(categoryRowSchema),
    })
    .parse(data);
  if (
    result.owner_profile_id !== profileId ||
    result.month !== month ||
    result.categories.some((c) => c.profile_id !== profileId) ||
    new Set(result.items.map((i) => i.template.id)).size !== result.items.length
  )
    throw new Error('Recurring snapshot mismatch.');
  const items = result.items.map((item) => {
    const template = mapTemplate(item.template),
      actual = item.transaction ? mapActual(item.transaction) : null;
    if (
      template.ownerProfileId !== profileId ||
      (actual &&
        (actual.ownerProfileId !== profileId ||
          actual.recurringTemplateId !== template.id ||
          actual.recurringMonth !== month ||
          actual.currency !== template.currency ||
          actual.categoryId !== template.categoryId ||
          actual.transactionDate.slice(0, 7) !== month.slice(0, 7)))
    )
      throw new Error('Recurring occurrence mismatch.');
    const dueDate = recurringDueDate(template, month);
    const status = actual
      ? actual.deletedAt
        ? 'CANCELLED'
        : 'RESOLVED'
      : dueDate
        ? 'PENDING'
        : 'INACTIVE';
    return { template, actual, dueDate, status };
  });
  return { ...budget, items, categories: result.categories };
}
export async function createTemplate(
  profileId: string,
  request: TemplateRequest,
) {
  const id = z.uuid().parse(request.id),
    form = templateFormSchema.parse(request.form);
  const amount =
    form.amount.trim() === ''
      ? null
      : parseDecimal(form.amount, currencyDigits(form.currency));
  const { data, error } = await supabase.rpc(
    'create_personal_recurring_expense',
    {
      p_template_id: id,
      p_name: form.name,
      p_category_id: form.categoryId,
      p_amount_mode: form.amountMode,
      p_currency: form.currency,
      p_due_day: Number(form.dueDay),
      p_active_from: form.activeFrom,
      ...(form.activeUntil ? { p_active_until: form.activeUntil } : {}),
      ...(amount === null ? {} : { p_default_amount_minor: amount }),
    },
  );
  if (error) throw error;
  const template = mapTemplate(data);
  if (
    template.id !== id ||
    template.ownerProfileId !== profileId ||
    template.name !== form.name ||
    template.categoryId !== form.categoryId ||
    template.amountMode !== form.amountMode ||
    template.defaultAmountMinor !== amount ||
    template.currency !== form.currency ||
    template.dueDay !== Number(form.dueDay) ||
    template.activeFrom !== form.activeFrom ||
    template.activeUntil !== (form.activeUntil || null)
  )
    throw new Error('Template response mismatch.');
  return template;
}
export async function stopTemplate(
  profileId: string,
  template: RecurringExpense,
  month: string,
) {
  recurringMonthSchema.parse(month);
  const { data, error } = await supabase.rpc(
    'stop_personal_recurring_expense',
    { p_template_id: template.id, p_stopped_from: month },
  );
  if (error) throw error;
  const result = mapTemplate(data);
  if (
    result.id !== template.id ||
    result.ownerProfileId !== profileId ||
    result.stoppedFrom !== month
  )
    throw new Error('Stop response mismatch.');
  return result;
}
export async function resolveRecurring(
  period: BudgetPeriod,
  template: RecurringExpense,
  request: IncomeRequest,
) {
  const form = validateIncomeForm(period).parse(request.form),
    id = z.uuid().parse(request.id);
  if (
    template.ownerProfileId !== period.profile_id ||
    template.currency !== period.base_currency
  )
    throw new Error('Invalid resolution target.');
  const amount = parseDecimal(
    form.amount,
    currencyDigits(period.base_currency),
  )!;
  if (template.amountMode === 'FIXED' && amount !== template.defaultAmountMinor)
    throw new Error('Fixed confirmation requires the original amount.');
  const { data, error } = await supabase.rpc(
    'resolve_personal_recurring_expense',
    {
      p_transaction_id: id,
      p_template_id: template.id,
      p_budget_period_id: period.id,
      p_month: period.starts_on,
      p_amount_minor: amount,
      p_currency: template.currency,
      p_transaction_date: form.date,
      ...(form.description.trim()
        ? { p_description: form.description.trim() }
        : {}),
    },
  );
  if (error) throw error;
  const actual = mapActual(data);
  if (
    actual.id !== id ||
    actual.ownerProfileId !== period.profile_id ||
    actual.budgetPeriodId !== period.id ||
    actual.recurringTemplateId !== template.id ||
    actual.recurringMonth !== period.starts_on ||
    actual.amountMinor !== amount ||
    actual.currency !== template.currency ||
    actual.categoryId !== template.categoryId ||
    actual.transactionDate !== form.date ||
    actual.description !== (form.description.trim() || null) ||
    actual.deletedAt !== null
  )
    throw new Error('Resolution response mismatch.');
  return actual;
}
