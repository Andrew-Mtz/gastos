import { z } from 'zod';
import { subtractMoney } from '../money/money';
import { calculateCommittedMoney } from '../recurring/committed-money';
import {
  calculateSavingsAvailability,
  type SavingsComponents,
} from '../savings/savings-availability';

/** A monthly budget margin, not bank cash or global solvency. All inputs must
 * describe ONE complete server snapshot; unknown obligations are never zero. */
export function calculateSafeToSpend(input: {
  configured: boolean;
  savings: SavingsComponents;
  commitments: Parameters<typeof calculateCommittedMoney>[0];
}) {
  const configured = z.boolean().parse(input.configured);
  const commitments = calculateCommittedMoney(input.commitments);
  const savings = calculateSavingsAvailability(
    commitments.confirmed.currency,
    input.savings,
  );
  const confirmedMargin = subtractMoney(
    savings.ordinaryRemainderBeforeCommitments,
    commitments.confirmed,
  );
  const estimatedMargin = subtractMoney(confirmedMargin, commitments.estimated);
  const unavailable =
    !configured ||
    commitments.unknownCount > 0 ||
    commitments.priorUnresolvedCount > 0;
  return Object.freeze({
    configured,
    savings,
    commitments,
    // Components are still explainable, but callers cannot accidentally label an
    // incomplete margin as available. Negative valid margins are not clamped.
    confirmedMargin: unavailable ? null : confirmedMargin,
    estimatedMargin:
      unavailable || commitments.estimatedCount === 0 ? null : estimatedMargin,
  });
}
