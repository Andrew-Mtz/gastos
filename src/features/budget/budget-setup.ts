import { z } from 'zod';
import {
  calculatePlannedBudgetAllocation,
  createBudgetAllocationPlan,
} from '../../domain/budget/budget-allocation';
import { type Money } from '../../domain/money/money';

export const bucketKeys = ['NEEDS', 'LEISURE', 'SAVINGS'] as const;
export type BucketKey = (typeof bucketKeys)[number];
export const bucketLabels: Record<BucketKey, string> = {
  NEEDS: 'Necesidades',
  LEISURE: 'Ocio',
  SAVINGS: 'Ahorro',
};
export const strategies = {
  BALANCED: { label: 'Equilibrado', shares: ['50', '30', '20'] },
  SAVER: { label: 'Ahorrador', shares: ['50', '20', '30'] },
  AGGRESSIVE: { label: 'Ahorro intensivo', shares: ['45', '15', '40'] },
} as const;
export type Strategy = keyof typeof strategies | 'CUSTOM';
export const bucketSchema = z.object({
  id: z.uuid(),
  profile_id: z.uuid(),
  name: z.string(),
  type: z.enum(['SPENDABLE', 'SAVINGS']),
  is_system: z.boolean(),
  system_key: z.enum(bucketKeys).nullable(),
  archived_at: z.string().nullable(),
});
export type BudgetBucket = z.infer<typeof bucketSchema>;
export const periodSchema = z.object({
  id: z.uuid(),
  profile_id: z.uuid(),
  starts_on: z.iso.date(),
  ends_on: z.iso.date(),
  status: z.enum(['OPEN', 'CLOSED']),
  base_currency: z.string().regex(/^[A-Z]{3}$/),
  expected_income_minor: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
});
export type BudgetPeriod = z.infer<typeof periodSchema>;
export const allocationSchema = z.object({
  budget_period_id: z.uuid(),
  budget_bucket_id: z.uuid(),
  percentage_basis_points: z.number().int().min(0).max(10000),
});
export type Allocation = z.infer<typeof allocationSchema>;

export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('es-UY', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
// Parse digits, never a floating-point amount multiplied by a decimal scale.
export function parseDecimal(value: string, digits: number): number | null {
  const input = value.trim();
  const pattern =
    digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:[.,]\\d{1,${digits}})?$`);
  if (!pattern.test(input)) return null;
  const [whole, fraction = ''] = input.split(/[.,]/);
  const result = Number(whole + fraction.padEnd(digits, '0'));
  return Number.isSafeInteger(result) ? result : null;
}
export const setupFormSchema = z.object({
  expectedIncome: z.string(),
  NEEDS: z.string(),
  LEISURE: z.string(),
  SAVINGS: z.string(),
});
export type SetupForm = z.infer<typeof setupFormSchema>;
export function validateSetupForm(currency: string) {
  return setupFormSchema.superRefine((form, ctx) => {
    if (
      form.expectedIncome.trim() &&
      parseDecimal(form.expectedIncome, currencyDigits(currency)) === null
    )
      ctx.addIssue({
        code: 'custom',
        path: ['expectedIncome'],
        message: 'Ingresa un importe válido, sin separadores de miles.',
      });
    const shares = bucketKeys.map((key) => parseDecimal(form[key], 2));
    shares.forEach((share, index) => {
      if (share === null || share > 10000)
        ctx.addIssue({
          code: 'custom',
          path: [bucketKeys[index]],
          message: 'Usa de 0 a 100, con hasta dos decimales.',
        });
    });
    if (
      shares.every((share) => share !== null && share <= 10000) &&
      shares.reduce<number>((sum, share) => sum + (share ?? 0), 0) !== 10000
    )
      ctx.addIssue({
        code: 'custom',
        path: ['SAVINGS'],
        message: 'Los porcentajes deben sumar 100%.',
      });
  });
}
export function currentMonth(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-01`;
}
export function decimalText(value: number, digits: number): string {
  const scale = 10 ** digits;
  const whole = Math.floor(value / scale);
  return digits === 0
    ? String(whole)
    : `${whole}.${String(value % scale).padStart(digits, '0')}`;
}
export function formatMoney(money: Money): string {
  const digits = currencyDigits(money.currency);
  const whole = Math.floor(money.amountMinor / 10 ** digits);
  const fraction = String(money.amountMinor % 10 ** digits).padStart(
    digits,
    '0',
  );
  return new Intl.NumberFormat('es-UY', {
    style: 'currency',
    currency: money.currency,
    currencyDisplay: 'code',
  })
    .formatToParts(whole)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}
export function setupPreview(
  currency: string,
  buckets: BudgetBucket[],
  form: SetupForm,
) {
  const values = validateSetupForm(currency).parse(form);
  const expectedIncomeMinor =
    values.expectedIncome.trim() === ''
      ? null
      : parseDecimal(values.expectedIncome, currencyDigits(currency));
  const allocations = bucketKeys.map((key) => {
    const bucket = buckets.find((item) => item.system_key === key);
    if (!bucket) throw new Error('Missing default bucket');
    return {
      budgetBucketId: bucket.id,
      percentageBasisPoints: parseDecimal(values[key], 2)!,
    };
  });
  // A preview needs no persisted period. Bucket identities are the same ones
  // saved later, preserving FIN-105 rounding tie-breaking before and after save.
  const plan = createBudgetAllocationPlan(
    '00000000-0000-0000-0000-000000000000',
    currency,
    allocations,
  );
  return {
    expectedIncomeMinor,
    allocations: calculatePlannedBudgetAllocation(plan, expectedIncomeMinor),
  };
}
