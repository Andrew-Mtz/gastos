import type { LifecycleHistory } from '../period-close-data';
import { snapshot, profile, period } from '../../dashboard/__tests__/fixtures';
export { profile, period };
export const requestId = 'f1230000-0000-4000-8000-000000000050';
export function closeContext() {
  const summary = snapshot();
  summary.availability.commitments.buckets = [];
  summary.upcoming = [];
  const p = { ...summary.period, lifecycle_version: 0 };
  return {
    shared_responsibilities: summary.shared_responsibilities,
    owner_profile_id: profile.id,
    month: period.starts_on,
    period: p,
    financial_month: '2026-11-01',
    financial_timezone: 'UTC',
    summary: { ...summary, period: p },
    closure: null,
    snapshot_hash: 'a'.repeat(32),
    can_close: true,
    reopen_hash: null as string | null,
    history: {
      closures: [] as LifecycleHistory['closures'],
      reopenings: [] as LifecycleHistory['reopenings'],
      dispositions: [] as LifecycleHistory['dispositions'],
      reversals: [] as LifecycleHistory['reversals'],
    },
  };
}
export function closure() {
  const row = closeContext();
  return {
    id: requestId,
    owner_profile_id: profile.id,
    budget_period_id: period.id,
    expected_lifecycle_version: 0,
    lifecycle_version: 1,
    snapshot_hash: row.snapshot_hash,
    snapshot_version: 2 as const,
    summary: row.summary,
    financial_timezone: 'UTC',
    closed_at: '2026-11-01T01:00:00Z',
  };
}
export function closedContext() {
  const row = closeContext(),
    saved = closure();
  return {
    ...row,
    period: { ...row.period, status: 'CLOSED', lifecycle_version: 1 },
    shared_responsibilities: {
      ...row.shared_responsibilities,
      period: {
        ...row.shared_responsibilities.period,
        status: 'CLOSED' as const,
      },
    },
    closure: saved,
    can_close: false,
    reopen_hash: 'b'.repeat(32),
    history: {
      closures: [saved],
      reopenings: [] as LifecycleHistory['reopenings'],
      dispositions: [] as LifecycleHistory['dispositions'],
      reversals: [] as LifecycleHistory['reversals'],
    },
  };
}

export function reopening() {
  return {
    id: requestId,
    owner_profile_id: profile.id,
    budget_period_id: period.id,
    closure_id: requestId,
    expected_lifecycle_version: 1,
    lifecycle_version: 2,
    closed_state_hash: 'b'.repeat(32),
    previous_closed_at: '2026-11-01T01:00:00Z',
    reopened_at: '2026-11-02T01:00:00Z',
  };
}
