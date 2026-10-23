import { mapSplitSnapshot, type SplitSnapshot } from '../split-data';
export const splitId = (n: number) =>
  `f2050000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function splitSnapshot(
  status: SplitSnapshot['status'] = 'UNCONFIGURED',
  role = 'OWNER',
): SplitSnapshot {
  return mapSplitSnapshot(splitId(1), splitId(20), {
    profile_id: splitId(1),
    household_id: splitId(20),
    version: status === 'UNCONFIGURED' ? 0 : 1,
    status,
    roster: [
      { id: splitId(40), profile_id: splitId(1), display_name: 'Ana', role },
      {
        id: splitId(41),
        profile_id: splitId(2),
        display_name: 'Beatriz',
        role: 'MEMBER',
      },
    ],
    template:
      status === 'READY'
        ? {
            id: splitId(50),
            version: 1,
            roster: [splitId(40), splitId(41)],
            shares: [
              { member_id: splitId(40), basis_points: 7000 },
              { member_id: splitId(41), basis_points: 3000 },
            ],
          }
        : null,
  });
}
