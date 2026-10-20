import { supabase } from '../../../infrastructure/supabase/client';
import {
  consumptionErrorMessage,
  consumptionKey,
  consumptionOwnerKey,
  readBucketConsumption,
} from '../consumption-data';
jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: { rpc: jest.fn() },
}));
const period = 'f1030000-0000-4000-8000-000000000001';
const row = {
  budget_bucket_id: 'f1040000-0000-4000-8000-000000000001',
  name: 'Archived food',
  system_key: null,
  spent_minor: 375,
};
const response = {
  budget_period_id: period,
  base_currency: 'USD',
  buckets: [row],
};
const abortSignal = jest.fn();
function reply(data: unknown = response, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  abortSignal.mockReturnValue(result);
  jest
    .mocked(supabase.rpc)
    .mockReturnValue(Object.assign(result, { abortSignal }) as never);
}
beforeEach(() => {
  jest.clearAllMocks();
  reply();
});
test('one complete aggregate reads historical names and exact amounts through a cancellable RPC', async () => {
  const controller = new AbortController();
  const result = await readBucketConsumption(period, 'USD', controller.signal);
  expect(supabase.rpc).toHaveBeenCalledWith('get_bucket_consumption', {
    p_budget_period_id: period,
  });
  expect(abortSignal).toHaveBeenCalledWith(controller.signal);
  expect(result.totalSpent.amountMinor).toBe(375);
  expect(result.buckets[0]).toMatchObject({
    name: 'Archived food',
    spentAmount: { amountMinor: 375, currency: 'USD' },
  });
});
test('owner and period isolate cache keys', () => {
  expect(consumptionKey('a', period)).toEqual([
    ...consumptionOwnerKey('a'),
    period,
  ]);
  expect(consumptionKey('a', period)).not.toEqual(consumptionKey('b', period));
  expect(consumptionKey('a', period)).not.toEqual(consumptionKey('a', 'other'));
});
test.each([
  { ...response, base_currency: 'UYU' },
  { ...response, budget_period_id: 'f1030000-0000-4000-8000-000000000002' },
  { ...response, buckets: [{ ...row, spent_minor: -1 }] },
  {
    ...response,
    buckets: [{ ...row, spent_minor: Number.MAX_SAFE_INTEGER + 1 }],
  },
  { ...response, buckets: [row, row] },
  { ...response, buckets: null },
])(
  'invalid aggregate never becomes a plausible partial total',
  async (data) => {
    reply(data);
    await expect(readBucketConsumption(period, 'USD')).rejects.toThrow();
  },
);
test('invalid period is rejected before any request', async () => {
  await expect(readBucketConsumption('bad', 'USD')).rejects.toThrow();
  expect(supabase.rpc).not.toHaveBeenCalled();
});
test('database errors propagate for meaningful sanitized presentation', async () => {
  const error = { code: '23514', message: 'private SQL detail' };
  reply(null, error);
  await expect(readBucketConsumption(period, 'USD')).rejects.toBe(error);
  expect(consumptionErrorMessage(error)).toMatch(
    /no se mostrará un total incompleto/,
  );
  expect(consumptionErrorMessage({ code: '22003' })).toMatch(/precisión/);
  expect(consumptionErrorMessage({ code: '42501' })).toMatch(/sesión/);
  expect(consumptionErrorMessage(new Error('secret'))).not.toMatch(/secret/);
});
