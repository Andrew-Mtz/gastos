import { z } from 'zod';
import { createMoney, subtractMoney } from '../money/money';

const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const savingsGoalSchema = z.object({
  id: z.uuid(),
  owner_profile_id: z.uuid(),
  scope: z.literal('PERSONAL'),
  name: z
    .string()
    .min(1)
    .max(120)
    .refine((value) => value.trim() === value),
  target_amount_minor: minor.positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  target_date: z.iso
    .date()
    .refine((value) => value >= '0001-01-01')
    .nullable(),
});
export type SavingsGoal = z.infer<typeof savingsGoalSchema>;

/** A goal balance is a subset of protected savings, never another account. */
export function goalProgress(
  targetMinor: number,
  balanceMinor: number,
  currency: string,
) {
  const target = createMoney(minor.positive().parse(targetMinor), currency);
  const balance = createMoney(minor.parse(balanceMinor), currency);
  return Object.freeze({
    target,
    balance,
    remaining: subtractMoney(
      target,
      createMoney(Math.min(balanceMinor, targetMinor), currency),
    ),
    attained: balanceMinor >= targetMinor,
  });
}
