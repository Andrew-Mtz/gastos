import { z } from 'zod';

const monthSchema = z.iso
  .date()
  .refine(
    (value) => value >= '0001-01-01' && value.endsWith('-01'),
    'A canonical calendar month is required.',
  );
const templateSchema = z
  .object({
    id: z.uuid(),
    ownerProfileId: z.uuid(),
    scope: z.literal('PERSONAL'),
    name: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => value.trim() === value && /\S/.test(value)),
    categoryId: z.uuid(),
    frequency: z.literal('MONTHLY'),
    amountMode: z.enum(['FIXED', 'VARIABLE']),
    defaultAmountMinor: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    dueDay: z.number().int().min(1).max(31),
    activeFrom: monthSchema,
    activeUntil: monthSchema.nullable(),
    stoppedFrom: monthSchema.nullable(),
  })
  .refine(
    (value) =>
      value.amountMode !== 'FIXED' ||
      (value.defaultAmountMinor !== null && value.defaultAmountMinor > 0),
    'A fixed template requires a positive amount.',
  )
  .refine(
    (value) =>
      value.activeUntil === null || value.activeUntil >= value.activeFrom,
    'The last month cannot precede the first month.',
  );

export type RecurringExpense = Readonly<z.output<typeof templateSchema>>;

// Historical definitions remain parseable after their start month or a stop.
// The trusted database separately checks creation-time eligibility and ownership.
export function createRecurringExpense(value: unknown): RecurringExpense {
  return Object.freeze(templateSchema.parse(value));
}

/** A due date is a calendar label, not an occurrence or actual expense. */
export function recurringDueDate(
  template: RecurringExpense,
  month: string,
): string | null {
  const value = createRecurringExpense(template);
  const selected = monthSchema.parse(month);
  if (
    selected < value.activeFrom ||
    (value.activeUntil !== null && selected > value.activeUntil) ||
    (value.stoppedFrom !== null && selected >= value.stoppedFrom)
  ) {
    return null;
  }
  const year = Number(selected.slice(0, 4));
  const monthNumber = Number(selected.slice(5, 7));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days =
    monthNumber === 2
      ? leap
        ? 29
        : 28
      : [4, 6, 9, 11].includes(monthNumber)
        ? 30
        : 31;
  return `${selected.slice(0, 8)}${String(Math.min(value.dueDay, days)).padStart(2, '0')}`;
}
