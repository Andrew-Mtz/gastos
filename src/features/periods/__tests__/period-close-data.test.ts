import { supabase } from '../../../infrastructure/supabase/client';
import {
  buildCloseRequest,
  buildReopenRequest,
  reopenPeriod,
  reopenErrorMessage,
  closePeriod,
  closeErrorMessage,
  isRejectedClose,
  mapPeriodClose,
  readPeriodClose,
} from '../period-close-data';
import {
  closeContext,
  closedContext,
  closure,
  reopening,
  period,
  profile,
  requestId,
} from './fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
const mapped = () =>
  mapPeriodClose(profile.id, period.starts_on, closeContext());
beforeEach(() => jest.clearAllMocks());
test('eligible preview preserves exact received, monthly and cumulative facts', () => {
  const data = mapped();
  expect(data.period?.status).toBe('OPEN');
  if (!data.period || !('summary' in data)) throw Error();
  expect(data.can_close).toBe(true);
  expect(data.summary?.availability.savings.protectedSavings.amountMinor).toBe(
    750,
  );
  expect(data.summary?.availability.components.allocated_savings_minor).toBe(
    200,
  );
  expect(buildCloseRequest(requestId, data)).toEqual({
    id: requestId,
    owner: profile.id,
    periodId: period.id,
    month: period.starts_on,
    version: 0,
    hash: 'a'.repeat(32),
  });
});
test('unknown, prior, zero estimated and fixed pending obligations never close', () => {
  for (const type of ['unknown', 'prior', 'zero', 'fixed']) {
    const data = closeContext();
    data.can_close = false;
    if (type === 'prior')
      data.summary.availability.commitments.prior_unresolved_count = 1;
    else {
      data.summary.availability.commitments.buckets = [
        {
          budget_bucket_id: data.summary.buckets[0].id,
          name: 'Needs',
          confirmed_minor: type === 'fixed' ? 100 : 0,
          estimated_minor: 0,
          confirmed_count: type === 'fixed' ? 1 : 0,
          estimated_count: type === 'zero' ? 1 : 0,
          unknown_count: type === 'unknown' ? 1 : 0,
        },
      ];
      data.summary.upcoming = [
        {
          template_id: requestId,
          name: 'Pending',
          amount_mode: type === 'fixed' ? 'FIXED' : 'VARIABLE',
          default_amount_minor:
            type === 'fixed' ? 100 : type === 'zero' ? 0 : null,
          currency: 'USD',
          due_date: period.starts_on,
        },
      ];
    }
    const result = mapPeriodClose(profile.id, period.starts_on, data);
    expect(() => buildCloseRequest(requestId, result)).toThrow();
    data.can_close = true;
    expect(() => mapPeriodClose(profile.id, period.starts_on, data)).toThrow();
  }
});
test('server financial month, not device clock, controls eligibility', () => {
  const data = closeContext();
  data.financial_month = period.starts_on;
  data.can_close = false;
  expect(() =>
    buildCloseRequest(
      requestId,
      mapPeriodClose(profile.id, period.starts_on, data),
    ),
  ).toThrow();
  data.can_close = true;
  expect(() => mapPeriodClose(profile.id, period.starts_on, data)).toThrow();
});
test('closed evidence preserves immutable old snapshot and disallows new close request', () => {
  const result = mapPeriodClose(profile.id, period.starts_on, closedContext());
  expect(() => buildCloseRequest(requestId, result)).toThrow();
  expect(result.period?.status).toBe('CLOSED');
});
test.each(['owner', 'month', 'period', 'version', 'hash', 'summary', 'status'])(
  'rejects inconsistent %s evidence',
  (field) => {
    const data = closedContext();
    if (field === 'owner') data.closure.owner_profile_id = requestId;
    if (field === 'month') data.month = '2026-09-01';
    if (field === 'period') data.closure.budget_period_id = requestId;
    if (field === 'version') data.closure.lifecycle_version = 2;
    if (field === 'hash') data.snapshot_hash = 'b'.repeat(32);
    if (field === 'summary')
      data.summary = { ...data.summary, received_income_minor: 999 };
    if (field === 'status') data.period.status = 'OPEN';
    expect(() => mapPeriodClose(profile.id, period.starts_on, data)).toThrow();
  },
);
test('legacy closed evidence is absent rather than invented from current recomputation', () => {
  const data = {
    ...closedContext(),
    closure: null,
    summary: null,
    snapshot_hash: null,
  };
  expect(
    mapPeriodClose(profile.id, period.starts_on, data).period?.status,
  ).toBe('CLOSED');
  expect(() =>
    mapPeriodClose(profile.id, period.starts_on, {
      ...data,
      summary: closeContext().summary,
    }),
  ).toThrow();
});
test('missing period is explicit and cannot close', () => {
  const result = mapPeriodClose(profile.id, period.starts_on, {
    ...closeContext(),
    period: null,
  });
  expect(result.period).toBeNull();
  expect(() => buildCloseRequest(requestId, result)).toThrow();
});
test('cancellable read validates owner and canonical month', async () => {
  const controller = new AbortController();
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: closeContext(), error: null });
  jest.mocked(supabase.rpc).mockReturnValue({ abortSignal } as never);
  await readPeriodClose(profile.id, period.starts_on, controller.signal);
  expect(abortSignal).toHaveBeenCalledWith(controller.signal);
  expect(supabase.rpc).toHaveBeenCalledWith(
    'get_personal_period_close_context',
    { p_month: period.starts_on },
  );
});
test('confirmed close passes stable UUID/version/fingerprint and exact replay returns only recorded evidence', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: closure(), error: null } as never);
  const request = buildCloseRequest(requestId, mapped());
  expect(await closePeriod(request)).toEqual(closure());
  await closePeriod(request);
  expect(supabase.rpc).toHaveBeenLastCalledWith(
    'close_personal_budget_period',
    {
      p_id: requestId,
      p_budget_period_id: period.id,
      p_expected_lifecycle_version: 0,
      p_snapshot_hash: 'a'.repeat(32),
      p_confirmed: true,
    },
  );
});
test.each([
  'id',
  'owner_profile_id',
  'budget_period_id',
  'snapshot_hash',
  'lifecycle_version',
])('rejects mismatched close response %s', async (field) => {
  const row = {
    ...closure(),
    [field]:
      field === 'snapshot_hash'
        ? 'b'.repeat(32)
        : field === 'lifecycle_version'
          ? 2
          : period.id,
  };
  if (field === 'budget_period_id') row.budget_period_id = requestId;
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: row, error: null } as never);
  await expect(
    closePeriod(buildCloseRequest(requestId, mapped())),
  ).rejects.toThrow();
});
test('rejected/stale versus uncertain failures have distinct recovery', () => {
  expect(isRejectedClose({ code: '40001' })).toBe(true);
  expect(isRejectedClose(new Error('Network'))).toBe(false);
  expect(closeErrorMessage({ code: '40001' })).toContain('vuelve a revisar');
  expect(closeErrorMessage({ code: '23514' })).toContain('no cambies fechas');
});

test('reopen only builds a request from a current CLOSED state, including legacy', () => {
  const data = mapPeriodClose(profile.id, period.starts_on, closedContext());
  expect(buildReopenRequest(requestId, data)).toEqual({
    id: requestId,
    owner: profile.id,
    periodId: period.id,
    month: period.starts_on,
    version: 1,
    hash: 'b'.repeat(32),
  });
  expect(() => buildReopenRequest(requestId, mapped())).toThrow();
  const legacy = mapPeriodClose(profile.id, period.starts_on, {
    ...closedContext(),
    closure: null,
    summary: null,
    snapshot_hash: null,
    history: { closures: [], reopenings: [] },
  });
  expect(buildReopenRequest(requestId, legacy).version).toBe(1);
});
test('reopen sends exact confirmed UUID version fingerprint and validates replay evidence', async () => {
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: reopening(), error: null } as never);
  const request = buildReopenRequest(
    requestId,
    mapPeriodClose(profile.id, period.starts_on, closedContext()),
  );
  expect(await reopenPeriod(request)).toEqual(reopening());
  expect(supabase.rpc).toHaveBeenCalledWith('reopen_personal_budget_period', {
    p_id: requestId,
    p_budget_period_id: period.id,
    p_expected_lifecycle_version: 1,
    p_closed_state_hash: 'b'.repeat(32),
    p_confirmed: true,
  });
  await reopenPeriod(request);
  expect(supabase.rpc).toHaveBeenCalledTimes(2);
});
test.each([
  'id',
  'owner_profile_id',
  'budget_period_id',
  'expected_lifecycle_version',
  'lifecycle_version',
  'closed_state_hash',
])('reopen rejects mismatched result %s as uncertain', async (field) => {
  const row = {
    ...reopening(),
    [field]: field.endsWith('version')
      ? 4
      : field === 'closed_state_hash'
        ? 'c'.repeat(32)
        : period.id,
  };
  if (field === 'budget_period_id') row.budget_period_id = requestId;
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: row, error: null } as never);
  await expect(
    reopenPeriod(
      buildReopenRequest(
        requestId,
        mapPeriodClose(profile.id, period.starts_on, closedContext()),
      ),
    ),
  ).rejects.toThrow();
});
test('history rejects foreign owner, duplicate lifecycle and inconsistent original snapshots', () => {
  for (const change of ['owner', 'duplicate', 'summary', 'link']) {
    const data = closeContext();
    data.period.lifecycle_version = 2;
    data.summary.period.lifecycle_version = 2;
    data.history = { closures: [closure()], reopenings: [reopening()] };
    if (change === 'owner')
      data.history.reopenings[0].owner_profile_id = requestId;
    if (change === 'duplicate')
      data.history.reopenings[0].lifecycle_version = 1;
    if (change === 'summary')
      data.history.closures[0].summary = {
        ...closeContext().summary,
        period: { ...period, status: 'CLOSED' },
      };
    if (change === 'link') data.history.reopenings[0].closure_id = period.id;
    expect(() => mapPeriodClose(profile.id, period.starts_on, data)).toThrow();
  }
});
test('reopen rejection and uncertain messages distinguish fresh review from same-request recovery', () => {
  expect(reopenErrorMessage({ code: '40001' })).toContain('vuelve a revisar');
  expect(reopenErrorMessage(new Error('Offline'))).toContain('misma solicitud');
});
