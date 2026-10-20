import { z } from 'zod';
import { addMoney, createMoney } from '../money/money';

const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bucketSchema = z
  .object({
    budgetBucketId: z.uuid().transform((value) => value.toLowerCase()),
    confirmedMinor: safeCount,
    estimatedMinor: safeCount,
    confirmedCount: safeCount,
    estimatedCount: safeCount,
    unknownCount: safeCount,
  })
  .refine(
    (v) =>
      (v.confirmedCount === 0
        ? v.confirmedMinor === 0
        : v.confirmedMinor >= v.confirmedCount) &&
      (v.estimatedCount !== 0 || v.estimatedMinor === 0),
    'Commitment counts must match their known amounts.',
  );
const inputSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  priorUnresolvedCount: safeCount,
  buckets: z.array(bucketSchema),
});

/** Only complete monthly server aggregates are accepted. Older unresolved counts
 * are warnings, never a carried monetary total. Unknown amounts are never zero. */
export function calculateCommittedMoney(input: z.input<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  let confirmed = createMoney(0, parsed.currency);
  let estimated = createMoney(0, parsed.currency);
  let confirmedCount = 0;
  let estimatedCount = 0;
  let unknownCount = 0;
  const seen = new Set<string>();
  const buckets = parsed.buckets.map((b) => {
    if (seen.has(b.budgetBucketId))
      throw new Error('Commitments require unique buckets.');
    seen.add(b.budgetBucketId);
    const amounts = {
      confirmed: createMoney(b.confirmedMinor, parsed.currency),
      estimated: createMoney(b.estimatedMinor, parsed.currency),
    };
    confirmed = addMoney(confirmed, amounts.confirmed);
    estimated = addMoney(estimated, amounts.estimated);
    confirmedCount = safeCount.parse(confirmedCount + b.confirmedCount);
    estimatedCount = safeCount.parse(estimatedCount + b.estimatedCount);
    unknownCount = safeCount.parse(unknownCount + b.unknownCount);
    return Object.freeze({
      budgetBucketId: b.budgetBucketId,
      ...amounts,
      confirmedCount: b.confirmedCount,
      estimatedCount: b.estimatedCount,
      unknownCount: b.unknownCount,
    });
  });
  // Validate the entire known exposure, without displaying estimates as exact.
  addMoney(confirmed, estimated);
  const unresolvedCount = safeCount.parse(
    confirmedCount + estimatedCount + unknownCount,
  );
  buckets.sort((a, b) => a.budgetBucketId.localeCompare(b.budgetBucketId));
  return Object.freeze({
    confirmed,
    estimated,
    confirmedCount,
    estimatedCount,
    unknownCount,
    unresolvedCount,
    priorUnresolvedCount: parsed.priorUnresolvedCount,
    buckets: Object.freeze(buckets),
  });
}
