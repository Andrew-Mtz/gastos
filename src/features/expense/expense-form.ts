import { z } from 'zod';
import { type BudgetPeriod } from '../budget/budget-setup';
import { validateIncomeForm } from '../income/income-form';

export function validateExpenseForm(period: BudgetPeriod) {
  return validateIncomeForm(period).safeExtend({
    categoryId: z.uuid('Selecciona una categoría.'),
  });
}
export type ExpenseForm = z.infer<ReturnType<typeof validateExpenseForm>>;
export type ExpenseRequest = Readonly<{ id: string; form: ExpenseForm }>;
export function expenseErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '42501')
    return 'Revisa tu sesión, que el mes esté abierto y que la categoría pertenezca a un fondo disponible.';
  if (code === '23514' || code === '23502')
    return 'Revisa el importe, la fecha y la moneda del presupuesto.';
  if (code === '23505')
    return 'Este registro ya existe o fue modificado. Actualiza antes de crear otro.';
  return 'No se pudo confirmar la operación. Reintenta el mismo gasto para evitar duplicados.';
}
