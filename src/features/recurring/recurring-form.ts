import { z } from 'zod';
import { currencyDigits, parseDecimal } from '../budget/budget-setup';

export const recurringMonthSchema = z.iso
  .date()
  .refine(
    (value) => value >= '0001-01-01' && value.endsWith('-01'),
    'Usa el primer día del mes (AAAA-MM-01).',
  );
export const templateFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Ingresa un nombre.').max(120),
    categoryId: z.uuid('Selecciona una categoría.'),
    amountMode: z.enum(['FIXED', 'VARIABLE']),
    amount: z.string(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    dueDay: z
      .string()
      .regex(/^(?:[1-9]|[12][0-9]|3[01])$/, 'Usa un día del 1 al 31.'),
    activeFrom: recurringMonthSchema,
    activeUntil: z.union([z.literal(''), recurringMonthSchema]),
  })
  .superRefine((form, ctx) => {
    const value = parseDecimal(form.amount, currencyDigits(form.currency));
    if (
      !(form.amountMode === 'VARIABLE' && form.amount.trim() === '') &&
      (value === null ||
        value < 0 ||
        (form.amountMode === 'FIXED' && value === 0))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Ingresa un importe válido; el fijo debe ser positivo.',
      });
    if (form.activeUntil && form.activeUntil < form.activeFrom)
      ctx.addIssue({
        code: 'custom',
        path: ['activeUntil'],
        message: 'El último mes no puede preceder al primero.',
      });
  });
export type TemplateForm = z.infer<typeof templateFormSchema>;
export type TemplateRequest = Readonly<{ id: string; form: TemplateForm }>;
export function recurringErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : null;
  if (code === '42501')
    return 'Revisa tu sesión, el mes abierto y la categoría disponible.';
  if (code === '23514' || code === '23502')
    return 'Revisa importe, moneda y meses. La obligación debe estar vigente en el mes elegido.';
  if (code === '23505')
    return 'La obligación ya fue registrada o cancelada. Actualiza para consultar su estado; no crees un duplicado.';
  return 'No se pudo confirmar la operación. Comprueba el mismo intento para evitar duplicados.';
}
