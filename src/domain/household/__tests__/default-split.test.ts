import { createHouseholdSplit, sameHouseholdRoster } from '../default-split';
test('explicit zero and 10000 basis points are valid, frozen and identity-sorted', () => {
  const result = createHouseholdSplit(
    ['b', 'a'],
    [
      { memberId: 'b', basisPoints: 0 },
      { memberId: 'a', basisPoints: 10000 },
    ],
  );
  expect(result).toEqual([
    { memberId: 'a', basisPoints: 10000 },
    { memberId: 'b', basisPoints: 0 },
  ]);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result[0])).toBe(true);
});
test.each([
  [[], []],
  [['a'], []],
  [
    ['a', 'a'],
    [
      { memberId: 'a', basisPoints: 5000 },
      { memberId: 'a', basisPoints: 5000 },
    ],
  ],
  [
    ['a', 'b'],
    [
      { memberId: 'a', basisPoints: 5000 },
      { memberId: 'c', basisPoints: 5000 },
    ],
  ],
  [
    ['a', 'b'],
    [
      { memberId: 'a', basisPoints: 5000 },
      { memberId: 'a', basisPoints: 5000 },
    ],
  ],
  [['a'], [{ memberId: 'a', basisPoints: 9999 }]],
  [['a'], [{ memberId: 'a', basisPoints: 10001 }]],
  [['a'], [{ memberId: 'a', basisPoints: NaN }]],
  [
    ['a', 'b'],
    [
      { memberId: 'a', basisPoints: 5000.5 },
      { memberId: 'b', basisPoints: 4999.5 },
    ],
  ],
  [
    ['a', 'b'],
    [
      { memberId: 'a', basisPoints: -1 },
      { memberId: 'b', basisPoints: 10001 },
    ],
  ],
] as const)(
  'rejects invalid roster/shares %# without normalizing',
  (roster, shares) => {
    expect(() => createHouseholdSplit(roster, shares)).toThrow();
  },
);
test('three or more members use exact integers, no couple assumption', () => {
  expect(
    createHouseholdSplit(
      ['a', 'b', 'c'],
      [
        { memberId: 'a', basisPoints: 3333 },
        { memberId: 'b', basisPoints: 3333 },
        { memberId: 'c', basisPoints: 3334 },
      ],
    ),
  ).toHaveLength(3);
});
test('roster comparison ignores ordering, not additions, removals or duplicates', () => {
  expect(sameHouseholdRoster(['a', 'b'], ['b', 'a'])).toBe(true);
  expect(sameHouseholdRoster(['a'], ['a', 'b'])).toBe(false);
  expect(sameHouseholdRoster(['a', 'a'], ['a', 'b'])).toBe(false);
});
test('rejects sparse arrays rather than omitting an explicit share', () => {
  const roster = ['a', 'b', 'c'];
  delete roster[1];
  const shares = [
    { memberId: 'a', basisPoints: 7000 },
    { memberId: 'b', basisPoints: 0 },
    { memberId: 'c', basisPoints: 3000 },
  ];
  delete shares[1];
  expect(() => createHouseholdSplit(roster, shares)).toThrow();
});
