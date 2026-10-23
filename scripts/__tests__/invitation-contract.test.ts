import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { mapDashboard } from '../../src/features/dashboard/dashboard-data';
import { mapInvitationContext } from '../../src/features/household/invitation-data';
import { mapHouseholdSnapshot } from '../../src/features/household/household-data';
jest.mock('../../src/infrastructure/supabase/client', () => ({ supabase: {} }));
const fixturePath = process.env.FIN203_SYNTHETIC_SNAPSHOTS;
if (!fixturePath)
  throw new Error('Real synthetic HTTP snapshots are required.');
const samples = z
  .array(
    z.object({
      kind: z.enum([
        'get_my_household_invitations',
        'get_my_household_memberships',
        'get_personal_dashboard',
      ]),
      data: z.unknown(),
      expected_owner: z.uuid().optional(),
    }),
  )
  .nonempty()
  .parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
test('real HTTP invitation responses satisfy strict production DTO and lifecycle parser', () => {
  const parsed = samples
    .filter((sample) => sample.kind === 'get_my_household_invitations')
    .map((sample) =>
      mapInvitationContext(
        z.object({ profile_id: z.uuid() }).parse(sample.data).profile_id,
        sample.data,
      ),
    );
  expect(parsed.length).toBeGreaterThanOrEqual(7);
  expect(
    parsed.some((row) =>
      row.incoming.some((invite) => invite.status === 'PENDING'),
    ),
  ).toBe(true);
  expect(
    parsed.some((row) =>
      row.incoming.some((invite) => invite.status === 'ACCEPTED'),
    ),
  ).toBe(true);
  expect(
    parsed.some((row) =>
      row.incoming.some((invite) => invite.status === 'REVOKED'),
    ),
  ).toBe(true);
  expect(
    parsed.some((row) =>
      row.outgoing.some((invite) => invite.status === 'ACCEPTED'),
    ),
  ).toBe(true);
});
test('membership production parser observes one before join and two separately scoped after join', () => {
  const parsed = samples
    .filter((sample) => sample.kind === 'get_my_household_memberships')
    .map((sample) =>
      mapHouseholdSnapshot(
        z.object({ profile_id: z.uuid() }).parse(sample.data).profile_id,
        sample.data,
      ),
    );
  expect(parsed.map((row) => row.households.length)).toEqual([1, 2, 0]);
});

test('after joining, production dashboard parser accepts only its authenticated owner and no foreign financial result', () => {
  const personal = samples.filter(
    (sample) => sample.kind === 'get_personal_dashboard',
  );
  expect(personal).toHaveLength(3);
  const owners = personal.map((sample) =>
    z.uuid().parse(sample.expected_owner),
  );
  expect(new Set(owners).size).toBe(3);
  const values = personal.map((sample, index) => {
    const result = mapDashboard(owners[index], '2025-01-01', sample.data);
    for (const otherOwner of owners.filter(
      (owner) => owner !== owners[index],
    )) {
      expect(() =>
        mapDashboard(otherOwner, '2025-01-01', sample.data),
      ).toThrow();
    }
    return result.period ? result.receivedIncome.amountMinor : null;
  });
  expect(values).toEqual([12345, 67890, null]);
});
