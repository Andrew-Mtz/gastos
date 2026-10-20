import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { mapDashboard } from '../../src/features/dashboard/dashboard-data';
import { mapSafeToSpend } from '../../src/features/budget/safe-to-spend-data';
import { mapPeriodClose } from '../../src/features/periods/period-close-data';
import {
  mapRemainder,
  mapReversal,
} from '../../src/features/periods/remainder-data';

// Only the unused global network client is replaced. These real application
// parsers/domain calculations consume JSON captured from this CI run's HTTP API.
// This suite is explicitly invoked by test:finance-api, not skipped by a flag.
jest.mock('../../src/infrastructure/supabase/client', () => ({ supabase: {} }));
const fixturePath = process.env.FIN126_SYNTHETIC_SNAPSHOTS;
if (!fixturePath)
  throw new Error('Live synthetic HTTP snapshots are required.');
const samples = z
  .array(
    z.object({
      kind: z.enum([
        'get_personal_dashboard',
        'get_personal_period_close_context',
        'get_personal_remainder_context',
        'get_personal_carry_reversal_context',
      ]),
      data: z.unknown(),
    }),
  )
  .nonempty()
  .parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
const identity = z.object({ owner_profile_id: z.uuid(), month: z.iso.date() });

test('real HTTP dashboard snapshots pass the current app parsers and exact financial formulas', () => {
  const records = samples
    .filter((s) => s.kind === 'get_personal_dashboard')
    .map((s) => {
      const header = identity.parse(s.data);
      const mapped = mapDashboard(
        header.owner_profile_id,
        header.month,
        s.data,
      );
      if (!mapped.period) return null;
      const availability = mapSafeToSpend(
        mapped.period,
        z.object({ availability: z.unknown() }).parse(s.data).availability,
      );
      expect(availability).toEqual(mapped.availability);
      return {
        ordinary:
          availability.savings.ordinaryRemainderBeforeCommitments.amountMinor,
        protected: availability.savings.protectedSavings.amountMinor,
        confirmed: availability.commitments.confirmed.amountMinor,
        estimated: availability.commitments.estimated.amountMinor,
        unknown: availability.commitments.unknownCount,
        prior: availability.commitments.priorUnresolvedCount,
        margin: availability.confirmedMargin?.amountMinor ?? null,
        estimatedMargin: availability.estimatedMargin?.amountMinor ?? null,
        incoming: availability.components.carry.incoming_minor,
        outgoing: availability.components.carry.outgoing_minor,
      };
    })
    .filter((r) => r !== null);
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        ordinary: 20000,
        protected: 20000,
        margin: 20000,
      }),
      expect.objectContaining({
        ordinary: 16000,
        protected: 24000,
        unknown: 1,
        margin: null,
      }),
      expect.objectContaining({
        ordinary: 12000,
        protected: 24000,
        unknown: 0,
        margin: 12000,
      }),
      expect.objectContaining({
        ordinary: 6500,
        confirmed: 600,
        estimated: 300,
        margin: 5900,
        estimatedMargin: 5600,
      }),
      expect.objectContaining({
        ordinary: 12000,
        outgoing: 5000,
        margin: 12000,
      }),
      expect.objectContaining({
        ordinary: 11500,
        incoming: 5000,
        margin: 11500,
      }),
      expect.objectContaining({
        ordinary: 16000,
        protected: 25000,
        margin: 16000,
      }),
    ]),
  );
  const unknown = records.filter((r) => r.unknown > 0 || r.prior > 0);
  expect(unknown.length).toBeGreaterThan(0);
  expect(
    unknown.every((r) => r.margin === null && r.estimatedMargin === null),
  ).toBe(true);
});

test('real HTTP lifecycle, disposition and reversal contexts pass app v2/history validation', () => {
  let closes = 0,
    remainders = 0,
    reversals = 0;
  for (const sample of samples) {
    if (sample.kind === 'get_personal_period_close_context') {
      const header = identity.parse(sample.data);
      mapPeriodClose(header.owner_profile_id, header.month, sample.data);
      closes++;
    } else if (sample.kind === 'get_personal_remainder_context') {
      const header = z.object({ close: identity }).parse(sample.data).close;
      mapRemainder(header.owner_profile_id, header.month, sample.data);
      remainders++;
    } else if (sample.kind === 'get_personal_carry_reversal_context') {
      const disposition = z
        .object({
          disposition: z.object({ id: z.uuid(), owner_profile_id: z.uuid() }),
        })
        .parse(sample.data).disposition;
      mapReversal(disposition.owner_profile_id, disposition.id, sample.data);
      reversals++;
    }
  }
  expect(closes).toBeGreaterThan(5);
  expect(remainders).toBeGreaterThanOrEqual(2);
  expect(reversals).toBeGreaterThanOrEqual(2);
});
