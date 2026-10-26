import { z } from 'zod';
import { sameHouseholdRoster } from '../../domain/household/default-split';
import { createMoney } from '../../domain/money/money';
import { calculateSharedExpenseSplit } from '../../domain/shared-expenses/shared-expense-split';
import { currencyDigits, parseDecimal } from '../budget/budget-setup';
import { mapSplitSnapshot, type SplitSnapshot } from './split-data';
import {
  sharedExpenseRequestSchema,
  sharedBudgetClassificationSchema,
  type SharedExpenseRequest,
} from './shared-expense-data';

export const sharedExpenseContextKey = (
  profileId: string,
  householdId: string,
) => ['shared-expense-context', profileId, householdId] as const;
export const pendingSharedExpenseKey = (
  profileId: string,
  householdId: string,
) => ['pending-shared-expense', profileId, householdId] as const;
export const sharedExpenseReceiptKey = (
  profileId: string,
  householdId: string,
  expenseId: string | null,
) => ['shared-expense-receipt', profileId, householdId, expenseId] as const;
export type PendingSharedExpense = {
  request: SharedExpenseRequest;
  inFlight: boolean;
};

export function sharedExpenseFormSchema(currency: string) {
  createMoney(1, currency);
  return z.strictObject({
    budgetClassification: sharedBudgetClassificationSchema,
    amount: z.string().refine((value) => {
      const amount = parseDecimal(value, currencyDigits(currency));
      return amount !== null && amount > 0;
    }, 'Ingresa un importe positivo válido, sin separadores de miles.'),
    date: z.iso
      .date('Ingresa una fecha válida (AAAA-MM-DD).')
      .refine(
        (value) => value >= '0001-01-01',
        'Ingresa una fecha válida (AAAA-MM-DD).',
      ),
    payerMemberId: z
      .uuid('Selecciona quién pagó.')
      .transform((value) => value.toLowerCase()),
    description: z
      .string()
      .refine(
        (value) => Array.from(value).length <= 500,
        'La descripción admite hasta 500 caracteres.',
      ),
  });
}
export type SharedExpenseForm = z.infer<
  ReturnType<typeof sharedExpenseFormSchema>
>;

// Currency is an explicit household-entry dependency, never a personal budget read.
export function prepareSharedExpense(
  profileId: string,
  householdId: string,
  currency: string,
  snapshot: SplitSnapshot,
  id: string,
  input: SharedExpenseForm,
) {
  const current = mapSplitSnapshot(profileId, householdId, snapshot);
  if (current.status !== 'READY' || !current.template)
    throw new Error('A current owner-reviewed household template is required.');
  const form = sharedExpenseFormSchema(currency).parse(input);
  const request = sharedExpenseRequestSchema.parse({
    id,
    householdId,
    payerMemberId: form.payerMemberId,
    templateId: current.template.id,
    templateVersion: current.template.version,
    roster: current.template.roster,
    amountMinor: parseDecimal(form.amount, currencyDigits(currency)),
    currency,
    transactionDate: form.date,
    budgetClassification: form.budgetClassification,
    description: form.description === '' ? null : form.description,
  });
  const responsibilities = calculateSharedExpenseSplit(
    createMoney(request.amountMinor, request.currency),
    current.template.shares.map((share) => ({
      memberId: share.member_id,
      basisPoints: share.basis_points,
    })),
  );
  return {
    request: { ...request, budgetClassification: form.budgetClassification },
    responsibilities,
  };
}
export type SharedExpenseReview = ReturnType<typeof prepareSharedExpense>;
export function templateConfirmsSharedExpense(
  request: SharedExpenseRequest,
  snapshot: SplitSnapshot,
) {
  return (
    snapshot.household_id === request.householdId &&
    snapshot.status === 'READY' &&
    snapshot.template?.id === request.templateId &&
    snapshot.template.version === request.templateVersion &&
    sameHouseholdRoster(snapshot.template.roster, request.roster) &&
    snapshot.roster.some((member) => member.id === request.payerMemberId)
  );
}
export function sameSharedExpenseRequest(
  a: SharedExpenseRequest,
  b: SharedExpenseRequest,
) {
  return (
    a.id === b.id &&
    a.householdId === b.householdId &&
    a.payerMemberId === b.payerMemberId &&
    a.templateId === b.templateId &&
    a.templateVersion === b.templateVersion &&
    sameHouseholdRoster(a.roster, b.roster) &&
    a.amountMinor === b.amountMinor &&
    a.currency === b.currency &&
    a.transactionDate === b.transactionDate &&
    a.description === b.description &&
    a.budgetClassification === b.budgetClassification
  );
}
function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : null;
}
export function isRejectedSharedExpense(error: unknown) {
  return [
    '42501',
    '23505',
    '23514',
    '23502',
    '23503',
    '22023',
    '22003',
    '25001',
    '40001',
  ].includes(String(errorCode(error)));
}
export function sharedExpenseErrorMessage(error: unknown) {
  if (errorCode(error) === '40001')
    return 'Cambió el reparto o la lista de miembros. Revisa de nuevo el gasto antes de confirmar.';
  if (errorCode(error) === '42501')
    return 'No pudimos confirmar tu acceso al hogar o al pagador. Actualiza el hogar.';
  if (errorCode(error) === '23505')
    return 'La identidad del registro está en conflicto. No se reemplazó ningún gasto.';
  if (isRejectedSharedExpense(error))
    return 'No se registró el gasto. Actualiza el hogar y revisa el importe, la fecha y su moneda.';
  return 'No se pudo confirmar el resultado. Se conserva la solicitud original para comprobarla sin duplicar el gasto.';
}
