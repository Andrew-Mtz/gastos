import { createCategory, isCategoryActive } from '../category';

const input = {
  id: 'f1070000-0000-4000-8000-000000000001',
  profileId: 'f0050000-0000-4000-8000-000000000001',
  name: 'Groceries',
  budgetBucketId: 'f1040000-0000-4000-8000-000000000001',
  isSystem: false,
  archivedAt: null,
};

test('personal category preserves explicit bucket identity without financial amounts', () => {
  const category = createCategory(input);
  expect(category).toEqual(input);
  expect(Object.isFrozen(category)).toBe(true);
  expect(isCategoryActive(category)).toBe(true);
});
test('unmapped categories are explicit, not assigned an implicit bucket', () => {
  expect(
    createCategory({ ...input, budgetBucketId: null }).budgetBucketId,
  ).toBeNull();
});
test('archive preserves historical category identity and mapping', () => {
  const category = createCategory({
    ...input,
    archivedAt: '2026-10-20T00:00:00Z',
  });
  expect(category.id).toBe(input.id);
  expect(category.budgetBucketId).toBe(input.budgetBucketId);
  expect(isCategoryActive(category)).toBe(false);
});
test.each(['', ' ', '\t\n'])('rejects blank name %j', (name) => {
  expect(() => createCategory({ ...input, name })).toThrow();
});
test.each(['id', 'profileId', 'budgetBucketId'])(
  'rejects malformed %s',
  (key) => {
    expect(() => createCategory({ ...input, [key]: 'not-an-id' })).toThrow();
  },
);
test.each([
  { isSystem: 'false' },
  { archivedAt: 'yesterday' },
  { profileId: null },
])('rejects malformed external values %j', (change) => {
  expect(() => createCategory({ ...input, ...change })).toThrow();
});
