import {
  addMoney,
  createMoney,
  subtractMoney,
  type Money,
} from '../money/money';

export type SavingsComponents = Readonly<{
  openingProtectedMinor: number;
  allocatedSavingsMinor: number;
  contributionsMinor: number;
  withdrawalsMinor: number;
  spendableAllocatedMinor: number;
  spentMinor: number;
}>;
export type OrdinaryCarry = Readonly<{
  incomingMinor: number;
  outgoingMinor: number;
}>;
export type SavingsAvailability = Readonly<{
  protectedSavings: Money;
  ordinaryMovementAdjustment: Money;
  ordinaryRemainderBeforeCommitments: Money;
}>;

/** Extra earmarking is not income, an expense, or a physical account transfer.
 * The database supplies one validated monthly snapshot and opening reserve. */
export function calculateSavingsAvailability(
  currency: string,
  components: SavingsComponents,
  carry: OrdinaryCarry = { incomingMinor: 0, outgoingMinor: 0 },
): SavingsAvailability {
  const values = Object.values(components);
  if (
    values.length !== 6 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    throw new Error('Savings components require nonnegative safe minor units.');
  if (
    [carry.incomingMinor, carry.outgoingMinor].some(
      (v) => !Number.isSafeInteger(v) || v < 0,
    )
  )
    throw new Error('Carry components require nonnegative safe minor units.');
  const opening = createMoney(components.openingProtectedMinor, currency);
  const allocated = createMoney(components.allocatedSavingsMinor, currency);
  const contributions = createMoney(components.contributionsMinor, currency);
  const withdrawals = createMoney(components.withdrawalsMinor, currency);
  const protectedSavings = subtractMoney(
    addMoney(addMoney(opening, allocated), contributions),
    withdrawals,
  );
  if (protectedSavings.amountMinor < 0)
    throw new Error('Protected savings cannot be overdrawn.');
  return Object.freeze({
    protectedSavings,
    ordinaryMovementAdjustment: subtractMoney(withdrawals, contributions),
    ordinaryRemainderBeforeCommitments: subtractMoney(
      subtractMoney(
        subtractMoney(
          addMoney(
            addMoney(
              createMoney(components.spendableAllocatedMinor, currency),
              createMoney(carry.incomingMinor, currency),
            ),
            withdrawals,
          ),
          contributions,
        ),
        createMoney(components.spentMinor, currency),
      ),
      createMoney(carry.outgoingMinor, currency),
    ),
  });
}
