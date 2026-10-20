import { z } from 'zod';
import {
  currencyDigits,
  parseDecimal,
  type BudgetPeriod,
} from '../budget/budget-setup';

export const incomeFormSchema = z.object({
  amount: z.string(),
  date: z.iso
    .date()
    .refine((value) => value >= '0001-01-01', 'Fecha inválida.'),
  description: z.string(),
});
export type IncomeForm = z.infer<typeof incomeFormSchema>;
export type IncomeRequest = Readonly<{ id: string; form: IncomeForm }>;
export function validateIncomeForm(period: BudgetPeriod) {
  return incomeFormSchema.superRefine((form, ctx) => {
    const amount = parseDecimal(
      form.amount,
      currencyDigits(period.base_currency),
    );
    if (amount === null || amount <= 0)
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message:
          'Ingresa un importe positivo válido, sin separadores de miles.',
      });
    if (form.date < period.starts_on || form.date > period.ends_on)
      ctx.addIssue({
        code: 'custom',
        path: ['date'],
        message: 'La fecha debe pertenecer a este mes.',
      });
  });
}
export function financialDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export function incomeErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '42501')
    return 'Revisa tu sesión y que el presupuesto siga abierto.';
  if (code === '23514' || code === '23502')
    return 'Revisa el importe, la fecha y la moneda del presupuesto.';
  if (code === '23505')
    return 'Este registro ya existe o fue modificado. Actualiza los ingresos antes de crear otro.';
  if (code === '22003') return 'El total supera el importe máximo admitido.';
  return 'No se pudo confirmar la operación. Reintenta el mismo registro para evitar duplicados.';
}
export function isRejectedIncome(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  return ['42501', '23514', '23502', '23505', '22003'].includes(String(code));
}
