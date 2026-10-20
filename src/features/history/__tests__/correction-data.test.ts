import { target, context } from './correction-fixtures';
import { supabase } from '../../../infrastructure/supabase/client';
import { readBudget } from '../../budget/budget-data';
import {
  amountInput,
  buildCorrectionRequest,
  correctTransaction,
  correctionErrorMessage,
  isRejectedCorrection,
  parseCorrectionTarget,
  readCorrectionContext,
  readRevisionPage,
} from '../correction-data';
import {
  category,
  bucket,
  period,
  profile,
} from '../../expense/__tests__/fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
jest.mock('../../budget/budget-data', () => ({ readBudget: jest.fn() }));
const requestId = 'f1220000-0000-4000-8000-000000000100';
const form = {
  amount: '200.01',
  date: '2026-10-21',
  categoryId: category.id,
  description: ' Correct ',
};
function query(data: unknown) {
  return Object.assign(
    Promise.resolve({ data, error: null }),
    Object.fromEntries(
      ['select', 'eq', 'order', 'limit', 'lt', 'abortSignal', 'single'].map(
        (name) => [name, jest.fn().mockReturnThis()],
      ),
    ),
  );
}
beforeEach(() => jest.clearAllMocks());
test('explicit bounded request uses exact minor units and retains immutable identity', () => {
  expect(buildCorrectionRequest(requestId, context, 'EDIT', form)).toEqual({
    id: requestId,
    target,
    action: 'EDIT',
    changes: {
      amount_minor: 20001,
      transaction_date: form.date,
      category_id: category.id,
      description: 'Correct',
    },
  });
  expect(amountInput(target)).toBe('123.45');
  expect(
    amountInput({ ...target, amount_minor: Number.MAX_SAFE_INTEGER }),
  ).toBe('90071992547409.91');
  expect(amountInput({ ...target, currency: 'JPY', amount_minor: 23 })).toBe(
    '23',
  );
});
test.each(['0', '-1', '1.001', '1e3', '90071992547409.92'])(
  'reject invalid correction amount %s',
  (amount) => {
    expect(() =>
      buildCorrectionRequest(requestId, context, 'EDIT', { ...form, amount }),
    ).toThrow();
  },
);
test.each(['2026-09-30', '2026-11-01', '2026-02-30', '0000-01-01'])(
  'reject invalid/out-of-month correction date %s',
  (date) => {
    expect(() =>
      buildCorrectionRequest(requestId, context, 'EDIT', { ...form, date }),
    ).toThrow();
  },
);
test('reject closed, deleted edit, active restore and excessively long descriptions', () => {
  expect(() =>
    buildCorrectionRequest(
      requestId,
      { ...context, period: { ...period, status: 'CLOSED' } },
      'DELETE',
    ),
  ).toThrow();
  expect(() =>
    buildCorrectionRequest(
      requestId,
      { ...context, target: { ...target, deleted_at: '2026-10-20T10:00:00Z' } },
      'EDIT',
      form,
    ),
  ).toThrow();
  expect(() => buildCorrectionRequest(requestId, context, 'RESTORE')).toThrow();
  expect(() =>
    buildCorrectionRequest(requestId, context, 'EDIT', {
      ...form,
      description: 'a'.repeat(501),
    }),
  ).toThrow();
});
test('legacy wrong-currency record may be deleted, not converted by edit', () => {
  const legacy = { ...context, target: { ...target, currency: 'EUR' } };
  expect(
    buildCorrectionRequest(requestId, legacy, 'DELETE').changes,
  ).toBeNull();
  expect(() =>
    buildCorrectionRequest(requestId, legacy, 'EDIT', form),
  ).toThrow();
});
test('only non-recurring expense may change to an eligible category', () => {
  const alternative = {
    ...category,
    id: 'f1070000-0000-4000-8000-000000000099',
    name: 'Other',
  };
  const next = { ...context, categories: [category, alternative] };
  expect(
    buildCorrectionRequest(requestId, next, 'EDIT', {
      ...form,
      categoryId: alternative.id,
    }).changes?.category_id,
  ).toBe(alternative.id);
  expect(() =>
    buildCorrectionRequest(requestId, context, 'EDIT', {
      ...form,
      categoryId: alternative.id,
    }),
  ).toThrow();
  expect(() =>
    buildCorrectionRequest(
      requestId,
      { ...next, target: { ...target, type: 'INCOME' } },
      'EDIT',
      { ...form, categoryId: alternative.id },
    ),
  ).toThrow();
  const recurring = {
    ...next,
    target: {
      ...target,
      recurring_template_id: requestId,
      recurring_month: period.starts_on,
    },
  };
  expect(() =>
    buildCorrectionRequest(requestId, recurring, 'EDIT', {
      ...form,
      categoryId: alternative.id,
    }),
  ).toThrow();
  expect(
    buildCorrectionRequest(requestId, recurring, 'EDIT', form).changes
      ?.amount_minor,
  ).toBe(20001);
});
test('correction request sends bounded action plus current revision and verifies exact response', async () => {
  const request = buildCorrectionRequest(requestId, context, 'EDIT', form);
  const result = { ...target, ...request.changes, revision: 4 };
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: result, error: null } as never);
  expect(await correctTransaction(request)).toEqual(result);
  expect(supabase.rpc).toHaveBeenCalledWith('correct_personal_transaction', {
    p_request_id: requestId,
    p_transaction_id: target.id,
    p_expected_revision: 3,
    p_action: 'EDIT',
    p_changes: request.changes,
    p_confirmed: true,
  });
});
test.each([
  { owner_profile_id: 'f0050000-0000-4000-8000-000000000002' },
  { revision: 5 },
  { currency: 'EUR' },
  { amount_minor: 1 },
  { transaction_date: '2026-10-22' },
  { savings_goal_id: requestId },
  { description: 'other' },
  { deleted_at: '2026-10-20T00:00:00Z' },
])('mismatched response fails closed %j', async (override) => {
  const request = buildCorrectionRequest(requestId, context, 'EDIT', form);
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: { ...target, ...request.changes, revision: 4, ...override },
    error: null,
  } as never);
  await expect(correctTransaction(request)).rejects.toThrow();
});
test('delete and restore preserve amount, date and identity', async () => {
  const deleted = {
    ...target,
    revision: 4,
    deleted_at: '2026-10-20T00:00:00Z',
  };
  jest
    .mocked(supabase.rpc)
    .mockResolvedValue({ data: deleted, error: null } as never);
  expect(
    await correctTransaction(
      buildCorrectionRequest(requestId, context, 'DELETE'),
    ),
  ).toEqual(deleted);
  jest.mocked(supabase.rpc).mockResolvedValue({
    data: { ...deleted, revision: 5, deleted_at: null },
    error: null,
  } as never);
  expect(
    (
      await correctTransaction(
        buildCorrectionRequest(
          requestId,
          { ...context, target: deleted },
          'RESTORE',
        ),
      )
    ).revision,
  ).toBe(5);
});
test('server conflict is propagated as a known rejection, not unknown success', async () => {
  const error = { code: '40001', message: 'private detail' };
  jest.mocked(supabase.rpc).mockResolvedValue({ data: null, error } as never);
  await expect(
    correctTransaction(buildCorrectionRequest(requestId, context, 'DELETE')),
  ).rejects.toEqual(error);
  expect(isRejectedCorrection(error)).toBe(true);
  expect(correctionErrorMessage(error)).toMatch(/movimiento cambió/);
  expect(correctionErrorMessage(error)).not.toContain('private detail');
  expect(isRejectedCorrection(new Error('network'))).toBe(false);
});
test('detail is owner-bound and cancellable; private mismatches are rejected', async () => {
  const tx = query(target),
    categories = query([category]);
  jest
    .mocked(supabase.from)
    .mockReturnValueOnce(tx as never)
    .mockReturnValueOnce(categories as never);
  jest
    .mocked(readBudget)
    .mockResolvedValue({ period, buckets: [bucket], allocations: [] });
  const signal = new AbortController().signal;
  expect(await readCorrectionContext(profile.id, target.id, signal)).toEqual(
    context,
  );
  expect(tx.eq).toHaveBeenCalledWith('owner_profile_id', profile.id);
  expect(tx.abortSignal).toHaveBeenCalledWith(signal);
  expect(categories.abortSignal).toHaveBeenCalledWith(signal);
  jest
    .mocked(supabase.from)
    .mockReturnValue(
      query({ ...target, owner_profile_id: requestId }) as never,
    );
  await expect(readCorrectionContext(profile.id, target.id)).rejects.toThrow();
});
test('audit pagination hides lookahead, uses revision keyset and verifies owner/snapshot chain', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    transaction_id: target.id,
    owner_profile_id: profile.id,
    revision: 30 - i,
    action: 'EDIT',
    recorded_at: '2026-10-20T00:00:00Z',
    before_state: { ...target, revision: 29 - i },
    after_state: { ...target, revision: 30 - i },
  }));
  const q = query(rows);
  jest.mocked(supabase.from).mockReturnValue(q as never);
  const signal = new AbortController().signal;
  const page = await readRevisionPage(profile.id, target.id, 31, signal);
  expect(page.items).toHaveLength(20);
  expect(page.nextCursor).toBe(11);
  expect(q.lt).toHaveBeenCalledWith('revision', 31);
  expect(q.limit).toHaveBeenCalledWith(21);
  expect(q.abortSignal).toHaveBeenCalledWith(signal);
  jest
    .mocked(supabase.from)
    .mockReturnValue(
      query([
        { ...rows[0], before_state: { ...target, revision: 2 } },
      ]) as never,
    );
  await expect(readRevisionPage(profile.id, target.id, null)).rejects.toThrow();
});
test.each([
  { revision: -1 },
  { amount_minor: 1.1 },
  { recurring_template_id: requestId },
  { recurring_template_id: requestId, recurring_month: '2026-09-01' },
  { savings_goal_id: requestId },
])('reject malformed target %j', (override) =>
  expect(() => parseCorrectionTarget({ ...target, ...override })).toThrow(),
);
