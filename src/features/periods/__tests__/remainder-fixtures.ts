import { snapshot } from '../../dashboard/__tests__/fixtures';
import {
  closeContext,
  closedContext,
  closure,
  period,
  profile,
  requestId,
} from './fixtures';
export const destinationId = 'f1250000-0000-4000-8000-000000000002';
export const reversalId = 'f1250000-0000-4000-8000-000000000003';
export function remainderContext() {
  const close = closeContext();
  return {
    close,
    preview_hash: 'c'.repeat(32),
    destination: {
      ...period,
      id: destinationId,
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
      lifecycle_version: 0,
    },
    destination_configured: true,
    destination_buckets: close.summary.buckets.filter(
      (b) => b.type === 'SPENDABLE',
    ),
    dispositions: [],
    reversals: [],
  };
}
export function disposition() {
  return {
    id: requestId,
    owner_profile_id: profile.id,
    source_period_id: period.id,
    closure_id: requestId,
    action: 'CARRY_UNALLOCATED' as const,
    amount_minor: 150,
    currency: 'USD',
    destination_period_id: destinationId,
    destination_bucket_id: null,
    destination_bucket_name: null,
    savings_transaction_id: null,
    request_payload: {
      period_id: period.id,
      version: 0,
      preview_hash: 'c'.repeat(32),
      action: 'CARRY_UNALLOCATED' as const,
      amount_minor: 150,
      destination_period_id: destinationId,
      destination_bucket_id: null,
    },
    created_at: '2026-12-01T01:00:00Z',
  };
}
export function disposedContext() {
  const base = closedContext(),
    saved = closure();
  saved.summary.availability.savings.carry.outgoing_minor = 150;
  return {
    ...base,
    closure: saved,
    summary: saved.summary,
    history: {
      ...base.history,
      closures: [saved],
      dispositions: [disposition()],
    },
  };
}
export function reversalContext() {
  const destination = snapshot(),
    p = remainderContext().destination;
  const data = { ...destination, month: p.starts_on, period: p };
  data.received_income_minor = 0;
  data.allocations.forEach((a) => {
    a.budget_period_id = p.id;
  });
  data.consumption.budget_period_id = p.id;
  data.consumption.buckets.forEach((b) => {
    b.spent_minor = 0;
  });
  data.availability.savings = {
    ...data.availability.savings,
    budget_period_id: p.id,
    opening_protected_minor: 750,
    allocated_savings_minor: 0,
    contributions_minor: 0,
    withdrawals_minor: 0,
    spendable_allocated_minor: 0,
    spent_minor: 0,
    carry: {
      incoming_minor: 150,
      outgoing_minor: 0,
      unallocated_minor: 150,
      buckets: [],
    },
  };
  data.availability.commitments = {
    ...data.availability.commitments,
    budget_period_id: p.id,
    month: p.starts_on,
    buckets: [],
  };
  data.upcoming = [];
  return {
    disposition: disposition(),
    source: disposedContext(),
    destination: data,
    can_reverse: true,
    preview_hash: 'd'.repeat(32),
  };
}
export function reversalResult() {
  return {
    reversal: {
      id: reversalId,
      owner_profile_id: profile.id,
      disposition_id: requestId,
      reopening_id: reversalId,
      request_payload: {
        disposition_id: requestId,
        source_version: 1,
        destination_version: 0,
        preview_hash: 'd'.repeat(32),
      },
      reversed_at: '2026-12-01T02:00:00Z',
    },
    reopening: {
      id: reversalId,
      owner_profile_id: profile.id,
      budget_period_id: period.id,
      closure_id: requestId,
      expected_lifecycle_version: 1,
      lifecycle_version: 2,
      closed_state_hash: 'b'.repeat(32),
      previous_closed_at: '2026-11-01T01:00:00Z',
      reopened_at: '2026-12-01T02:00:00Z',
    },
  };
}
