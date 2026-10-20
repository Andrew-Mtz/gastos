import { z } from 'zod';
import { currencyDigits, parseDecimal } from '../budget/budget-setup';

export const goalFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Ingresa un nombre.')
      .max(120, 'Usa hasta 120 caracteres.'),
    target: z.string(),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Selecciona una moneda.'),
    targetDate: z.union([
      z.literal(''),
      z.iso.date().refine((value) => value >= '0001-01-01', 'Fecha inválida.'),
    ]),
  })
  .superRefine((form, ctx) => {
    const amount = parseDecimal(form.target, currencyDigits(form.currency));
    if (amount === null || amount <= 0)
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message:
          'Ingresa un objetivo positivo válido, sin separadores de miles.',
      });
  });
export type GoalForm = z.infer<typeof goalFormSchema>;
export type GoalRequest = Readonly<{ id: string; form: GoalForm }>;
export function validateGoalRequest(request: GoalRequest) {
  return z.object({ id: z.uuid(), form: goalFormSchema }).parse(request);
}
