import { bucketKeys, type BudgetBucket } from '../budget-setup';
export const buckets: BudgetBucket[] = bucketKeys.map((key, index) => ({
  id: `b1060000-0000-4000-8000-00000000000${index + 1}`,
  profile_id: 'f0050000-0000-4000-8000-000000000001',
  name: key,
  type: key === 'SAVINGS' ? 'SAVINGS' : 'SPENDABLE',
  is_system: true,
  system_key: key,
  archived_at: null,
}));
