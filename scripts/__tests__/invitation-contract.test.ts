import { readFileSync } from 'node:fs';
import {
  mapSharedExpense,
  mapSharedExpenseReceipt,
  sharedExpenseRequestSchema,
} from '../../src/features/household/shared-expense-data';
import { z } from 'zod';
import {
  mapSplitReceipt,
  mapSplitSnapshot,
  splitRequestSchema,
} from '../../src/features/household/split-data';
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
        'get_household_default_split',
        'save_household_default_split',
        'create_shared_expense',
        'get_shared_expense',
      ]),
      data: z.unknown(),
      expected_owner: z.uuid().optional(),
      expected_household: z.uuid().optional(),
      expected_expense: z.uuid().optional(),
      expected_request: z.unknown().optional(),
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

test('real HTTP split snapshots pass strict production parsers through unconfigured, ready and join-stale states', () => {
  const splitSamples = samples.filter(
    (sample) => sample.kind === 'get_household_default_split',
  );
  const parsed = splitSamples.map((sample) =>
    mapSplitSnapshot(
      z.uuid().parse(sample.expected_owner),
      z.uuid().parse(sample.expected_household),
      sample.data,
    ),
  );
  expect(parsed.map((row) => row.status)).toEqual([
    'UNCONFIGURED',
    'READY',
    'STALE',
    'READY',
  ]);
  expect(parsed.map((row) => row.version)).toEqual([0, 1, 1, 2]);
  expect(parsed[2].template).toBeNull();
  const receipts = samples
    .filter((sample) => sample.kind === 'save_household_default_split')
    .map((sample) =>
      mapSplitReceipt(
        splitRequestSchema.parse(sample.expected_request),
        sample.data,
      ),
    );
  expect(receipts.map((row) => row.version)).toEqual([1, 2, 2, 1]);
  expect(receipts[0]).toEqual(receipts[3]);
});

test('real HTTP shared persistence receipts and authorized point reads pass production financial and scope validation', () => {
  const receipts = samples
    .filter((sample) => sample.kind === 'create_shared_expense')
    .map((sample) =>
      mapSharedExpenseReceipt(
        z.uuid().parse(sample.expected_owner),
        sharedExpenseRequestSchema.parse(sample.expected_request),
        sample.data,
      ),
    );
  expect(receipts).toHaveLength(2);
  expect(receipts[1]).toEqual(receipts[0]);
  expect(receipts[0].template_version).toBe(2);
  expect(receipts[0].splits.map((row) => row.basis_points).sort()).toEqual([
    3000, 7000,
  ]);
  const reads = samples
    .filter((sample) => sample.kind === 'get_shared_expense')
    .map((sample) =>
      mapSharedExpense(
        z.uuid().parse(sample.expected_owner),
        z.uuid().parse(sample.expected_household),
        z.uuid().parse(sample.expected_expense),
        sample.data,
      ),
    );
  expect(reads).toHaveLength(2);
  expect(new Set(reads.map((row) => row.profile_id)).size).toBe(2);
  for (const read of reads) {
    expect(read.splits).toEqual(receipts[0].splits);
    expect(read.expense_id).toBe(receipts[0].expense_id);
  }
});
