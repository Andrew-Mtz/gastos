import { calculateCommittedMoney } from '../committed-money';
const bucket = {
  budgetBucketId: 'f1040000-0000-4000-8000-000000000001',
  confirmedMinor: 100,
  estimatedMinor: 250,
  confirmedCount: 1,
  estimatedCount: 2,
  unknownCount: 1,
};
const input = { currency: 'USD', priorUnresolvedCount: 3, buckets: [bucket] };
test('confirmed, estimated, unknown and older warnings never collapse into exact availability', () => {
  const result = calculateCommittedMoney(input);
  expect(result).toMatchObject({
    confirmed: { amountMinor: 100, currency: 'USD' },
    estimated: { amountMinor: 250, currency: 'USD' },
    unknownCount: 1,
    unresolvedCount: 4,
    priorUnresolvedCount: 3,
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.buckets)).toBe(true);
  expect(Object.isFrozen(result.buckets[0])).toBe(true);
});
test('known zero remains estimated and unknown remains distinct at zero known amounts', () => {
  const result = calculateCommittedMoney({
    ...input,
    buckets: [
      { ...bucket, confirmedMinor: 0, confirmedCount: 0, estimatedMinor: 0 },
    ],
  });
  expect(result.estimated.amountMinor).toBe(0);
  expect(result.estimatedCount).toBe(2);
  expect(result.unknownCount).toBe(1);
  expect(result.priorUnresolvedCount).toBe(3);
});
test('empty month still reports older unresolved obligations', () => {
  expect(calculateCommittedMoney({ ...input, buckets: [] })).toMatchObject({
    unresolvedCount: 0,
    priorUnresolvedCount: 3,
    confirmed: { amountMinor: 0 },
    estimated: { amountMinor: 0 },
  });
});
test('multiple buckets aggregate exactly without changing input', () => {
  const other = {
    ...bucket,
    budgetBucketId: 'f1040000-0000-4000-8000-000000000002',
  };
  const value = { ...input, buckets: [other, bucket] };
  const before = JSON.stringify(value);
  const result = calculateCommittedMoney(value);
  expect(result.confirmed.amountMinor).toBe(200);
  expect(result.estimated.amountMinor).toBe(500);
  expect(result.unresolvedCount).toBe(8);
  expect(result.buckets[0].budgetBucketId).toBe(bucket.budgetBucketId);
  expect(JSON.stringify(value)).toBe(before);
});
test.each([
  'confirmedMinor',
  'estimatedMinor',
  'confirmedCount',
  'estimatedCount',
  'unknownCount',
] as const)('%s rejects invalid numbers', (field) => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      calculateCommittedMoney({
        ...input,
        buckets: [{ ...bucket, [field]: value }],
      }),
    ).toThrow();
  }
});
test.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])(
  'older count %s rejected',
  (value) => {
    expect(() =>
      calculateCommittedMoney({ ...input, priorUnresolvedCount: value }),
    ).toThrow();
  },
);
test.each([
  { confirmedCount: 0 },
  { confirmedMinor: 0 },
  { confirmedCount: 101 },
  { estimatedCount: 0 },
  { budgetBucketId: 'bad' },
])('inconsistent bucket %s rejected', (patch) => {
  expect(() =>
    calculateCommittedMoney({ ...input, buckets: [{ ...bucket, ...patch }] }),
  ).toThrow();
});
test('duplicate case-normalized UUIDs rejected', () => {
  expect(() =>
    calculateCommittedMoney({
      ...input,
      buckets: [
        bucket,
        { ...bucket, budgetBucketId: bucket.budgetBucketId.toUpperCase() },
      ],
    }),
  ).toThrow();
});
test('combined known exposure overflow rejected even with individually safe components', () => {
  expect(() =>
    calculateCommittedMoney({
      ...input,
      buckets: [{ ...bucket, confirmedMinor: Number.MAX_SAFE_INTEGER }],
    }),
  ).toThrow();
});
test('count overflow across buckets rejected', () => {
  const zero = {
    ...bucket,
    confirmedMinor: 0,
    confirmedCount: 0,
    estimatedMinor: 0,
    estimatedCount: 0,
    unknownCount: Number.MAX_SAFE_INTEGER,
  };
  expect(() =>
    calculateCommittedMoney({
      ...input,
      buckets: [
        zero,
        { ...bucket, budgetBucketId: 'f1040000-0000-4000-8000-000000000002' },
      ],
    }),
  ).toThrow();
});
test('exact money safe boundary accepted with no other known amount', () => {
  expect(
    calculateCommittedMoney({
      ...input,
      buckets: [
        {
          ...bucket,
          confirmedMinor: Number.MAX_SAFE_INTEGER,
          estimatedMinor: 0,
        },
      ],
    }).confirmed.amountMinor,
  ).toBe(Number.MAX_SAFE_INTEGER);
});
