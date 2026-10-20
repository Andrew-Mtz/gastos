import { z } from 'zod';
import { calculateBucketConsumption } from '../../domain/budget/bucket-consumption';
import { createBudgetAllocationPlan } from '../../domain/budget/budget-allocation';
import { calculateProtectedBudgetAllocation } from '../../domain/budget/protected-budget-allocation';
import { createMoney, addMoney, subtractMoney } from '../../domain/money/money';
import { supabase } from '../../infrastructure/supabase/client';
import {
  allocationSchema,
  bucketSchema,
  periodSchema,
} from '../budget/budget-setup';
import { consumptionSnapshotSchema } from '../budget/consumption-data';
import { mapSafeToSpend } from '../budget/safe-to-spend-data';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { recurringMonthSchema } from '../recurring/recurring-form';

export const dashboardOwnerKey = (owner: string) =>
  [...recurringOwnerKey(owner), 'dashboard'] as const;
export const dashboardKey = (owner: string, month: string) =>
  [...dashboardOwnerKey(owner), month] as const;
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const envelope = z.object({
  owner_profile_id: z.uuid(),
  month: recurringMonthSchema,
  period: periodSchema.nullable(),
});
const snapshotSchema = envelope.extend({
  period: periodSchema,
  received_income_minor: minor,
  availability: z.unknown(),
  consumption: consumptionSnapshotSchema,
  allocations: z.array(allocationSchema),
  buckets: z.array(bucketSchema),
  upcoming: z
    .array(
      z
        .object({
          template_id: z.uuid(),
          name: z.string().trim().min(1),
          amount_mode: z.enum(['FIXED', 'VARIABLE']),
          default_amount_minor: minor.nullable(),
          currency: z.string(),
          due_date: z.iso.date(),
        })
        .refine(
          (item) =>
            item.amount_mode !== 'FIXED' ||
            (item.default_amount_minor !== null &&
              item.default_amount_minor > 0),
        ),
    )
    .max(5),
});

/** Validate a complete server snapshot, never combine separate query results. */
export function mapDashboard(
  owner: string,
  month: string,
  data: unknown,
  snapshotVersion: 1 | 2 = 2,
) {
  if (snapshotVersion === 2)
    z.object({ snapshot_version: z.literal(2) }).parse(data);
  else if (
    z.object({ snapshot_version: z.unknown().optional() }).parse(data)
      .snapshot_version !== undefined
  )
    throw new Error('Legacy snapshot version mismatch.');
  const header = envelope.parse(data);
  if (header.owner_profile_id !== owner || header.month !== month)
    throw new Error('Dashboard owner/month mismatch.');
  if (!header.period) return { period: null } as const;
  const row = snapshotSchema.parse(data),
    period = row.period;
  if (
    period.profile_id !== owner ||
    period.starts_on !== month ||
    row.consumption.budget_period_id !== period.id ||
    row.consumption.base_currency !== period.base_currency ||
    row.allocations.some((a) => a.budget_period_id !== period.id) ||
    row.buckets.some((b) => b.profile_id !== owner) ||
    new Set(row.buckets.map((b) => b.id)).size !== row.buckets.length
  )
    throw new Error('Dashboard component mismatch.');
  const availability = mapSafeToSpend(
    period,
    row.availability,
    snapshotVersion,
  );
  const consumption = calculateBucketConsumption(
    period.base_currency,
    row.consumption.buckets.map((b) => ({
      budgetBucketId: b.budget_bucket_id,
      spentMinor: b.spent_minor,
    })),
  );
  const allocation = row.allocations.length
    ? calculateProtectedBudgetAllocation(
        createBudgetAllocationPlan(
          period.id,
          period.base_currency,
          row.allocations.map((a) => ({
            budgetBucketId: a.budget_bucket_id,
            percentageBasisPoints: a.percentage_basis_points,
          })),
        ),
        row.received_income_minor,
        row.buckets,
      )
    : null;
  if (
    availability.configured !== (allocation !== null) ||
    availability.components.spent_minor !==
      consumption.totalSpent.amountMinor ||
    availability.components.allocated_savings_minor !==
      (allocation?.protectedSavings.amountMinor ?? 0) ||
    availability.components.spendable_allocated_minor !==
      (allocation?.spendableAllocated.amountMinor ?? 0)
  )
    throw new Error('Dashboard totals disagree.');
  const carry = availability.components.carry;
  if (
    carry.buckets.some(
      (c) =>
        !consumption.buckets.some(
          (b) => b.budgetBucketId === c.budget_bucket_id,
        ),
    )
  )
    throw new Error('Dashboard consumption omits a carried bucket.');
  const usage = consumption.buckets.map((b) => {
    const metadata = row.buckets.find((item) => item.id === b.budgetBucketId);
    if (!metadata || metadata.type !== 'SPENDABLE')
      throw new Error('Dashboard consumption classification mismatch.');
    const allocatedAmount = allocation
      ? (allocation.allocations.find(
          (item) => item.budgetBucketId === b.budgetBucketId,
        )?.allocatedAmount ?? createMoney(0, period.base_currency))
      : null;
    const carriedAmount = createMoney(
      carry.buckets.find((c) => c.budget_bucket_id === b.budgetBucketId)
        ?.amount_minor ?? 0,
      period.base_currency,
    );
    return {
      ...b,
      carriedAmount,
      grossRemainder: allocatedAmount
        ? subtractMoney(addMoney(allocatedAmount, carriedAmount), b.spentAmount)
        : null,
      name: metadata.name,
      systemKey: metadata.system_key,
      allocatedAmount,
    };
  });
  if (
    allocation?.allocations.some(
      (a) =>
        a.bucketType === 'SPENDABLE' &&
        !usage.some((b) => b.budgetBucketId === a.budgetBucketId),
    )
  )
    throw new Error('Dashboard consumption omits an allocated bucket.');
  if (
    row.upcoming.length !==
      Math.min(5, availability.commitments.unresolvedCount) ||
    new Set(row.upcoming.map((item) => item.template_id)).size !==
      row.upcoming.length ||
    row.upcoming.some((item, index) => {
      const previous = row.upcoming[index - 1];
      return (
        item.currency !== period.base_currency ||
        item.due_date < period.starts_on ||
        item.due_date > period.ends_on ||
        (previous &&
          `${previous.due_date}/${previous.template_id}` >
            `${item.due_date}/${item.template_id}`)
      );
    })
  )
    throw new Error('Dashboard obligation preview mismatch.');
  return {
    period,
    availability,
    usage,
    upcoming: row.upcoming,
    receivedIncome: createMoney(
      row.received_income_minor,
      period.base_currency,
    ),
    expectedIncome:
      period.expected_income_minor === null
        ? null
        : createMoney(period.expected_income_minor, period.base_currency),
  };
}
export type Dashboard = ReturnType<typeof mapDashboard>;
export async function readDashboard(
  owner: string,
  month: string,
  signal?: AbortSignal,
) {
  z.uuid().parse(owner);
  recurringMonthSchema.parse(month);
  const query = supabase.rpc('get_personal_dashboard', { p_month: month });
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return mapDashboard(owner, month, data);
}
