import { supabase } from '../../../infrastructure/supabase/client';
import { mapDashboard } from '../../dashboard/dashboard-data';
import { parseSavingsSummary } from '../../savings/savings-data';
import { mapPeriodClose } from '../period-close-data';
import {
  buildDisposeRequest,
  buildReverseRequest,
  disposeRemainder,
  mapRemainder,
  mapReversal,
  readRemainder,
  readReversal,
  reverseCarry,
} from '../remainder-data';
import { profile, period, requestId, closedContext } from './fixtures';
import {
  remainderContext,
  disposedContext,
  disposition,
  reversalContext,
  reversalResult,
  reversalId,
} from './remainder-fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
const context = () =>
  mapRemainder(profile.id, period.starts_on, remainderContext());
beforeEach(() => jest.clearAllMocks());
test('global net cap includes contributions and withdrawals, not positive bucket residuals or protected savings', () => {
  const row = context();
  expect(row.cap?.amountMinor).toBe(600);
  expect(row.close.summary?.usage[0].grossRemainder?.amountMinor).toBe(650);
  expect(
    row.close.summary?.availability.savings.protectedSavings.amountMinor,
  ).toBe(750);
  expect(() =>
    buildDisposeRequest(requestId, row, 'SAVINGS', '6.01', null),
  ).toThrow();
  expect(buildDisposeRequest(requestId, row, 'SAVINGS', '6', null).amount).toBe(
    600,
  );
});
test.each(['0', '-1', '1.001', 'NaN', '9007199254740992'])(
  'rejects invalid amount %s',
  (value) => {
    expect(() =>
      buildDisposeRequest(requestId, context(), 'SAVINGS', value, null),
    ).toThrow();
  },
);
test('requires explicit spendable bucket only for bucket carry and configured next same-currency open month', () => {
  const row = context();
  expect(() =>
    buildDisposeRequest(requestId, row, 'CARRY_BUCKET', '1.50', null),
  ).toThrow();
  expect(() =>
    buildDisposeRequest(
      requestId,
      row,
      'CARRY_UNALLOCATED',
      '1.50',
      row.destination_buckets[0].id,
    ),
  ).toThrow();
  expect(
    buildDisposeRequest(
      requestId,
      row,
      'CARRY_BUCKET',
      '1.50',
      row.destination_buckets[0].id,
    ).destinationBucketId,
  ).toBe(row.destination_buckets[0].id);
  for (const destination of [
    null,
    { ...row.destination!, status: 'CLOSED' as const },
    { ...row.destination!, base_currency: 'UYU' },
  ])
    expect(() =>
      buildDisposeRequest(
        requestId,
        { ...row, destination },
        'CARRY_UNALLOCATED',
        '1.50',
        null,
      ),
    ).toThrow();
  expect(() =>
    buildDisposeRequest(
      requestId,
      { ...row, destination_configured: false },
      'CARRY_UNALLOCATED',
      '1',
      null,
    ),
  ).toThrow();
});
test('history mismatches and owner/month substitutions fail closed', () => {
  const raw = remainderContext();
  expect(() => mapRemainder(period.id, period.starts_on, raw)).toThrow();
  expect(() =>
    mapRemainder(profile.id, period.starts_on, {
      ...raw,
      destination: { ...raw.destination, starts_on: '2026-12-01' },
    }),
  ).toThrow();
  expect(() =>
    mapRemainder(profile.id, period.starts_on, {
      ...raw,
      dispositions: [disposition()],
    }),
  ).toThrow();
  expect(() =>
    mapRemainder(profile.id, period.starts_on, {
      ...raw,
      destination_buckets: [
        raw.destination_buckets[0],
        raw.destination_buckets[0],
      ],
    }),
  ).toThrow();
});
test('reads one cancellable scalar envelope and sends exact explicitly confirmed disposition', async () => {
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: remainderContext(), error: null });
  jest.mocked(supabase.rpc).mockReturnValue({ abortSignal } as never);
  const signal = new AbortController().signal;
  const row = await readRemainder(profile.id, period.starts_on, signal);
  expect(abortSignal).toHaveBeenCalledWith(signal);
  const request = buildDisposeRequest(
    requestId,
    row,
    'CARRY_UNALLOCATED',
    '1.50',
    null,
  );
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: { disposition: disposition(), closure: disposedContext().closure },
    error: null,
  } as never);
  await disposeRemainder(request);
  expect(supabase.rpc).toHaveBeenLastCalledWith(
    'close_and_dispose_personal_remainder',
    {
      p_id: requestId,
      p_budget_period_id: period.id,
      p_expected_lifecycle_version: 0,
      p_preview_hash: 'c'.repeat(32),
      p_action: 'CARRY_UNALLOCATED',
      p_amount_minor: 150,
      p_destination_period_id: request.destinationPeriodId,
      p_destination_bucket_id: undefined,
      p_confirmed: true,
    },
  );
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: {
      disposition: { ...disposition(), amount_minor: 151 },
      closure: disposedContext().closure,
    },
    error: null,
  } as never);
  await expect(disposeRemainder(request)).rejects.toThrow();
});
test('reversal uses live destination capacity, never immutable source summary as spendable authority', async () => {
  const row = mapReversal(profile.id, requestId, reversalContext());
  expect(
    row.destination.availability.savings.ordinaryRemainderBeforeCommitments
      .amountMinor,
  ).toBe(150);
  expect(
    row.source.summary?.availability.savings.ordinaryRemainderBeforeCommitments
      .amountMinor,
  ).toBe(450);
  const request = buildReverseRequest(reversalId, row);
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: reversalResult(), error: null } as never);
  await reverseCarry(request);
  expect(supabase.rpc).toHaveBeenCalledWith(
    'reverse_carry_and_reopen_personal_period',
    {
      p_id: reversalId,
      p_disposition_id: requestId,
      p_expected_source_version: 1,
      p_expected_destination_version: 0,
      p_preview_hash: 'd'.repeat(32),
      p_confirmed: true,
    },
  );
  const bad = reversalResult();
  bad.reopening.budget_period_id = profile.id;
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: bad, error: null } as never);
  await expect(reverseCarry(request)).rejects.toThrow();
});
test('reversal refuses insufficient funds, closed destination, and zero estimated obligations', () => {
  for (const reason of ['funds', 'closed', 'obligation']) {
    const row = reversalContext();
    if (reason === 'funds') {
      row.destination.consumption.buckets[0].spent_minor = 1;
      row.destination.availability.savings.spent_minor = 1;
    } else if (reason === 'closed') row.destination.period.status = 'CLOSED';
    else {
      row.destination.availability.commitments.prior_unresolved_count = 1;
    }
    expect(() => mapReversal(profile.id, requestId, row)).toThrow();
    row.can_reverse = false;
    expect(() =>
      buildReverseRequest(reversalId, mapReversal(profile.id, requestId, row)),
    ).toThrow();
  }
});
test('reversal read propagates cancellation and errors without fallback to historical balances', async () => {
  const abortSignal = jest
    .fn()
    .mockResolvedValue({ data: reversalContext(), error: null });
  jest.mocked(supabase.rpc).mockReturnValue({ abortSignal } as never);
  const signal = new AbortController().signal;
  await readReversal(profile.id, requestId, signal);
  expect(abortSignal).toHaveBeenCalledWith(signal);
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: null, error: { code: '23514' } } as never);
  await expect(readReversal(profile.id, requestId)).rejects.toEqual({
    code: '23514',
  });
});
test('only explicit immutable v1 evidence may omit carry; current missing or malformed carry fails closed', () => {
  const raw = closedContext();
  const { snapshot_version: ignoredVersion, ...oldSummary } = raw.summary;
  const {
    snapshot_version: ignoredSavingsVersion,
    carry: ignoredCarry,
    ...oldSavings
  } = oldSummary.availability.savings;
  const legacy = {
    ...oldSummary,
    availability: { ...oldSummary.availability, savings: oldSavings },
  };
  expect(ignoredVersion + ignoredSavingsVersion).toBe(4);
  expect(ignoredCarry.incoming_minor).toBe(0);
  const saved = { ...raw.closure, snapshot_version: 1, summary: legacy };
  const result = mapPeriodClose(profile.id, period.starts_on, {
    ...raw,
    summary: legacy,
    closure: saved,
    history: { ...raw.history, closures: [saved] },
  });
  expect(result.period?.status).toBe('CLOSED');
  expect(() => mapDashboard(profile.id, period.starts_on, legacy)).toThrow();
  expect(() => parseSavingsSummary(oldSavings)).toThrow();
  expect(() =>
    parseSavingsSummary({
      ...raw.summary.availability.savings,
      carry: {
        incoming_minor: 1,
        outgoing_minor: 0,
        unallocated_minor: 0,
        buckets: [],
      },
    }),
  ).toThrow();
  expect(() =>
    parseSavingsSummary({ ...oldSavings, carry: ignoredCarry }, 1),
  ).toThrow();
});
