import { z } from 'zod';

const categorySchema = z.object({
  id: z.uuid().transform((value) => value.toLowerCase()),
  profileId: z.uuid().transform((value) => value.toLowerCase()),
  name: z
    .string()
    .refine((value) => /\S/.test(value), 'A category needs a name.'),
  budgetBucketId: z
    .uuid()
    .transform((value) => value.toLowerCase())
    .nullable(),
  isSystem: z.boolean(),
  archivedAt: z.iso.datetime({ offset: true }).nullable(),
});

export type Category = Readonly<z.output<typeof categorySchema>>;

// Archived categories retain their identity and bucket mapping for history.
// Selecting active configuration is separate from parsing a historical record.
export function createCategory(value: unknown): Category {
  return Object.freeze(categorySchema.parse(value));
}

export function isCategoryActive(category: Category): boolean {
  return createCategory(category).archivedAt === null;
}
