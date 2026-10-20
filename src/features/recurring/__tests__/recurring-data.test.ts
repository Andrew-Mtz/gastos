import { supabase } from '../../../infrastructure/supabase/client';
import { readBudget } from '../../budget/budget-data';
import {
  createTemplate,
  stopTemplate,
  resolveRecurring,
  readRecurringMonth,
  recurringOwnerKey,
  recurringKey,
} from '../recurring-data';
import { templateFormSchema } from '../recurring-form';
import {
  period,
  profile,
  template,
  templateRow,
  createRequest,
  resolveRequest,
  actualRow,
  snapshot,
} from './fixtures';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock('../../budget/budget-data', () => ({ readBudget: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(readBudget)
    .mockResolvedValue({ period, buckets: [], allocations: [] });
});
function response(data: unknown) {
  jest.mocked(supabase.rpc).mockResolvedValue({ data, error: null } as never);
}
test('unknown estimate omitted, stable creation identity, no financial write', async () => {
  response(templateRow);
  expect(await createTemplate(profile.id, createRequest)).toEqual(template);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith(
    'create_personal_recurring_expense',
    {
      p_template_id: template.id,
      p_name: 'Electricidad',
      p_category_id: template.categoryId,
      p_amount_mode: 'VARIABLE',
      p_currency: 'USD',
      p_due_day: 31,
      p_active_from: period.starts_on,
    },
  );
});
test('zero estimate is explicit, not unknown', async () => {
  response({ ...templateRow, default_amount_minor: 0 });
  await createTemplate(profile.id, {
    ...createRequest,
    form: { ...createRequest.form, amount: '0' },
  });
  expect(supabase.rpc).toHaveBeenCalledWith(
    'create_personal_recurring_expense',
    expect.objectContaining({ p_default_amount_minor: 0 }),
  );
});
test.each([
  { id: period.id },
  { owner_profile_id: period.id },
  { name: 'Changed' },
  { currency: 'EUR' },
  { due_day: 1 },
  { category_id: period.id },
  { default_amount_minor: 0 },
  { active_from: '2026-11-01' },
])('rejects template response mismatch %s', async (patch) => {
  response({ ...templateRow, ...patch });
  await expect(createTemplate(profile.id, createRequest)).rejects.toThrow();
});
test.each([
  { amountMode: 'FIXED', amount: '' },
  { amountMode: 'FIXED', amount: '0' },
  { amount: '-1' },
  { amount: '90071992547409.92' },
  { dueDay: '32' },
  { activeFrom: '2026-10-02' },
  { activeUntil: '2026-09-01' },
])('rejects invalid template input %s', (patch) => {
  expect(
    templateFormSchema.safeParse({ ...createRequest.form, ...patch }).success,
  ).toBe(false);
});
test('stop uses exact canonical month and never resolves anything', async () => {
  response({ ...templateRow, stopped_from: '2026-11-01' });
  await stopTemplate(profile.id, template, '2026-11-01');
  expect(supabase.rpc).toHaveBeenCalledWith('stop_personal_recurring_expense', {
    p_template_id: template.id,
    p_stopped_from: '2026-11-01',
  });
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});
test('resolve uses known positive amount and immutable template classification', async () => {
  response(actualRow);
  expect(
    await resolveRecurring(period, template, resolveRequest),
  ).toMatchObject({
    amountMinor: 2840,
    recurringTemplateId: template.id,
    recurringMonth: period.starts_on,
  });
  expect(supabase.rpc).toHaveBeenCalledWith(
    'resolve_personal_recurring_expense',
    {
      p_transaction_id: resolveRequest.id,
      p_template_id: template.id,
      p_budget_period_id: period.id,
      p_month: period.starts_on,
      p_amount_minor: 2840,
      p_currency: 'USD',
      p_transaction_date: '2026-10-20',
      p_description: 'Actual',
    },
  );
});
test.each([
  { id: period.id },
  { owner_profile_id: period.id },
  { budget_period_id: profile.id },
  { recurring_template_id: period.id },
  { recurring_month: '2026-11-01' },
  { amount_minor: 1 },
  { currency: 'EUR' },
  { category_id: period.id },
  { transaction_date: '2026-10-21' },
  { description: 'Changed' },
  { deleted_at: '2026-10-20T00:00:00Z' },
])('rejects actual response mismatch %s', async (patch) => {
  response({ ...actualRow, ...patch });
  await expect(
    resolveRecurring(period, template, resolveRequest),
  ).rejects.toThrow();
});
test.each([
  { amount: '0' },
  { amount: '-1' },
  { amount: '' },
  { date: '2026-11-01' },
])('invalid actual request never writes %s', async (patch) => {
  await expect(
    resolveRecurring(period, template, {
      ...resolveRequest,
      form: { ...resolveRequest.form, ...patch },
    }),
  ).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('pending snapshot validates owner/month and consumes cancellation signal', async () => {
  const query = Object.assign(
    Promise.resolve({ data: snapshot, error: null }),
    { abortSignal: jest.fn().mockReturnThis() },
  );
  jest.mocked(supabase.rpc).mockReturnValue(query as never);
  const signal = new AbortController().signal;
  expect(
    (await readRecurringMonth(profile.id, period.starts_on, signal)).items[0],
  ).toMatchObject({ status: 'PENDING', dueDate: '2026-10-31', actual: null });
  expect(query.abortSignal).toHaveBeenCalledWith(signal);
  expect(readBudget).toHaveBeenCalledWith(profile.id, period.starts_on, signal);
  expect(recurringKey(profile.id, period.starts_on).slice(0, 2)).toEqual(
    recurringOwnerKey(profile.id),
  );
  expect(recurringKey(profile.id, period.starts_on)).not.toEqual(
    recurringKey(period.id, period.starts_on),
  );
});
test.each([null, '2026-10-20T00:00:00Z'])(
  'stopped linked history stays resolved or cancelled, never pending (%s)',
  async (deleted_at) => {
    response({
      ...snapshot,
      items: [
        {
          template: { ...templateRow, stopped_from: period.starts_on },
          transaction: { ...actualRow, deleted_at },
        },
      ],
    });
    expect(
      (await readRecurringMonth(profile.id, period.starts_on)).items[0],
    ).toMatchObject({
      status: deleted_at ? 'CANCELLED' : 'RESOLVED',
      dueDate: null,
    });
  },
);
test.each([
  { owner_profile_id: period.id },
  { month: '2026-11-01' },
  {
    items: [
      {
        template: { ...templateRow, owner_profile_id: period.id },
        transaction: null,
      },
    ],
  },
  { items: [...snapshot.items, ...snapshot.items] },
  {
    items: [
      {
        template: templateRow,
        transaction: { ...actualRow, recurring_month: '2026-11-01' },
      },
    ],
  },
])('rejects snapshot mismatch %s', async (patch) => {
  response({ ...snapshot, ...patch });
  await expect(
    readRecurringMonth(profile.id, period.starts_on),
  ).rejects.toThrow();
});

test('fixed confirmation uses the identical resolver with exact amount, never an automatic expense', async () => {
  response({ ...actualRow, amount_minor: 100 });
  const fixed = {
    ...template,
    amountMode: 'FIXED' as const,
    defaultAmountMinor: 100,
  };
  await resolveRecurring(period, fixed, {
    ...resolveRequest,
    form: { ...resolveRequest.form, amount: '1.00' },
  });
  expect(supabase.rpc).toHaveBeenCalledWith(
    'resolve_personal_recurring_expense',
    expect.objectContaining({ p_amount_minor: 100 }),
  );
});
test('fixed changed amount is rejected before the write', async () => {
  const fixed = {
    ...template,
    amountMode: 'FIXED' as const,
    defaultAmountMinor: 100,
  };
  await expect(resolveRecurring(period, fixed, resolveRequest)).rejects.toThrow(
    'original amount',
  );
  expect(supabase.rpc).not.toHaveBeenCalled();
});
