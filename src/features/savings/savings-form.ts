import { z } from 'zod';
import {
  validateIncomeForm,
  incomeErrorMessage,
  type IncomeForm,
} from '../income/income-form';
import { type BudgetPeriod } from '../budget/budget-setup';
export type SavingsType = 'SAVINGS_CONTRIBUTION' | 'SAVINGS_WITHDRAWAL';
export type SavingsRequest = Readonly<{
  id: string;
  type: SavingsType;
  withdrawalConfirmed: boolean;
  form: IncomeForm;
}>;
export function validateSavingsRequest(
  period: BudgetPeriod,
  request: SavingsRequest,
) {
  const parsed = z
    .object({
      id: z.uuid(),
      type: z.enum(['SAVINGS_CONTRIBUTION', 'SAVINGS_WITHDRAWAL']),
      withdrawalConfirmed: z.boolean(),
      form: validateIncomeForm(period),
    })
    .parse(request);
  if (parsed.type === 'SAVINGS_WITHDRAWAL' && !parsed.withdrawalConfirmed)
    throw new Error('Explicit withdrawal confirmation is required.');
  return parsed;
}
export function savingsErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '23514')
    return 'El movimiento no es válido: revisa el ahorro disponible, el resto antes de compromisos, la fecha y la moneda. Un registro histórico incompatible también requiere corrección.';
  if (code === '23505')
    return 'El identificador ya existe con otros datos o fue eliminado. Actualiza el historial antes de crear otro movimiento.';
  return incomeErrorMessage(error);
}
