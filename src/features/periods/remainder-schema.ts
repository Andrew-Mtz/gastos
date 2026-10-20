import { z } from 'zod';
const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{32}$/);
export const dispositionActionSchema = z.enum([
  'SAVINGS',
  'CARRY_BUCKET',
  'CARRY_UNALLOCATED',
]);
export const dispositionSchema = z
  .object({
    id: z.uuid(),
    owner_profile_id: z.uuid(),
    source_period_id: z.uuid(),
    closure_id: z.uuid(),
    action: dispositionActionSchema,
    amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
    destination_period_id: z.uuid().nullable(),
    destination_bucket_id: z.uuid().nullable(),
    destination_bucket_name: z.string().min(1).nullable(),
    savings_transaction_id: z.uuid().nullable(),
    request_payload: z.object({
      period_id: z.uuid(),
      version,
      preview_hash: hash,
      action: dispositionActionSchema,
      amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      destination_period_id: z.uuid().nullable(),
      destination_bucket_id: z.uuid().nullable(),
    }),
    created_at: z.iso.datetime({ offset: true }),
  })
  .superRefine((d, ctx) => {
    const p = d.request_payload;
    if (
      p.period_id !== d.source_period_id ||
      p.action !== d.action ||
      p.amount_minor !== d.amount_minor ||
      p.destination_period_id !== d.destination_period_id ||
      p.destination_bucket_id !== d.destination_bucket_id ||
      d.closure_id !== d.id ||
      (d.action === 'SAVINGS'
        ? d.destination_period_id !== null ||
          d.destination_bucket_id !== null ||
          d.destination_bucket_name !== null ||
          d.savings_transaction_id !== d.id
        : d.destination_period_id === null ||
          d.destination_period_id === d.source_period_id ||
          d.savings_transaction_id !== null ||
          (d.action === 'CARRY_BUCKET'
            ? d.destination_bucket_id === null ||
              d.destination_bucket_name === null
            : d.destination_bucket_id !== null ||
              d.destination_bucket_name !== null))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Disposition evidence mismatch.',
      });
  });
export const reversalSchema = z
  .object({
    id: z.uuid(),
    owner_profile_id: z.uuid(),
    disposition_id: z.uuid(),
    reopening_id: z.uuid(),
    request_payload: z.object({
      disposition_id: z.uuid(),
      source_version: version,
      destination_version: version,
      preview_hash: hash,
    }),
    reversed_at: z.iso.datetime({ offset: true }),
  })
  .refine(
    (r) =>
      r.id === r.reopening_id &&
      r.disposition_id === r.request_payload.disposition_id,
    'Reversal evidence mismatch.',
  );
