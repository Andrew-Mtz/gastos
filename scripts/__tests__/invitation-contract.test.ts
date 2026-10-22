import { readFileSync } from 'node:fs';
import { z } from 'zod';
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
      ]),
      data: z.unknown(),
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
  expect(parsed.map((row) => row.households.length)).toEqual([1, 2]);
});
