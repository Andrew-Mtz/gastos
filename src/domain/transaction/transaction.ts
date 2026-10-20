import { z } from 'zod';
import { createMoney, type Money } from '../money/money';

export const transactionTypes = [
  'INCOME',
  'EXPENSE',
  'SAVINGS_CONTRIBUTION',
  'SAVINGS_WITHDRAWAL',
] as const;
const transactionSchema = z.object({
  id: z.uuid(),
  ownerProfileId: z.uuid(),
  budgetPeriodId: z.uuid(),
  scope: z.literal('PERSONAL'),
  type: z.enum(transactionTypes),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  transactionDate: z.iso.date(),
  categoryId: z.uuid().nullable(),
  description: z.string().nullable(),
  deletedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type Transaction = Readonly<z.output<typeof transactionSchema>>;

export function createTransaction(value: unknown): Transaction {
  return Object.freeze(transactionSchema.parse(value));
}

export function transactionMoney(transaction: Transaction): Money {
  const value = createTransaction(transaction);
  return createMoney(value.amountMinor, value.currency);
}

export function isTransactionActive(transaction: Transaction): boolean {
  return createTransaction(transaction).deletedAt === null;
}
