import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { BucketConsumption } from '../BucketConsumption';
import {
  consumptionKey,
  consumptionOwnerKey,
  readBucketConsumption,
} from '../consumption-data';
import { createMoney } from '../../../domain/money/money';
jest.mock('../consumption-data', () => ({
  ...jest.requireActual('../consumption-data'),
  readBucketConsumption: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
const owner = 'f0050000-0000-4000-8000-000000000001';
const period = 'f1030000-0000-4000-8000-000000000001';
function result(amount = 375) {
  return {
    totalSpent: createMoney(amount, 'USD'),
    buckets: [
      {
        budgetBucketId: 'f1040000-0000-4000-8000-000000000001',
        name: 'Historical needs',
        systemKey: 'NEEDS' as const,
        spentAmount: createMoney(amount, 'USD'),
      },
    ],
  };
}
let focus: (() => void | (() => void)) | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readBucketConsumption).mockResolvedValue(result());
  jest.mocked(useFocusEffect).mockImplementation((callback) => {
    focus = callback;
  });
});
async function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const tree = (
    profileId = owner,
    periodId = period,
    refreshingPlan = false,
  ) => (
    <QueryClientProvider client={client}>
      <BucketConsumption
        profileId={profileId}
        periodId={periodId}
        currency="USD"
        refreshingPlan={refreshingPlan}
      />
    </QueryClientProvider>
  );
  return { ...(await render(tree())), client, tree };
}
test('shows actual spent per bucket and total without claiming remaining or safe-to-spend', async () => {
  await show();
  expect(await screen.findByText(/Total gastado:/)).toHaveTextContent(/3,75/);
  expect(screen.getByText(/Necesidades: gastado/)).toHaveTextContent(/3,75/);
  expect(screen.getByText(/No es un saldo restante/)).toBeOnTheScreen();
});
test('empty successful period is explicit zero', async () => {
  jest
    .mocked(readBucketConsumption)
    .mockResolvedValue({ totalSpent: createMoney(0, 'USD'), buckets: [] });
  await show();
  expect(await screen.findByText(/Total gastado:/)).toHaveTextContent(/0,00/);
  expect(screen.getByText(/Aún no hay fondos/)).toBeOnTheScreen();
});
test('loading is never zero and unmount cancels the read', async () => {
  jest
    .mocked(readBucketConsumption)
    .mockImplementation(() => new Promise(() => {}));
  const view = await show();
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByText(/Total gastado:/)).not.toBeOnTheScreen();
  const signal = jest.mocked(readBucketConsumption).mock.calls[0][2]!;
  await view.unmount();
  expect(signal.aborted).toBe(true);
});
test('legacy-invalid error is explicit, hides totals and supports retry', async () => {
  jest
    .mocked(readBucketConsumption)
    .mockRejectedValueOnce({ code: '23514', message: 'private SQL detail' });
  await show();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /total incompleto/,
  );
  expect(screen.queryByText(/Total gastado:/)).not.toBeOnTheScreen();
  expect(screen.queryByText(/private SQL/)).not.toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Reintentar consumo' }));
  expect(await screen.findByText(/Total gastado:/)).toHaveTextContent(/3,75/);
});
test('expense invalidation and refocus recompute consumption including external deletion', async () => {
  const { client } = await show();
  await screen.findByText(/Total gastado:/);
  jest.mocked(readBucketConsumption).mockResolvedValue(result(500));
  await act(async () => {
    await client.invalidateQueries({ queryKey: consumptionOwnerKey(owner) });
  });
  await waitFor(() =>
    expect(screen.getByText(/Total gastado:/)).toHaveTextContent(/5,00/),
  );
  jest.mocked(readBucketConsumption).mockResolvedValue(result(0));
  await act(async () => {
    focus?.();
  });
  await waitFor(() =>
    expect(screen.getByText(/Total gastado:/)).toHaveTextContent(/0,00/),
  );
});
test('pending/error refresh hides stale figures instead of displaying a misleading total', async () => {
  const { client } = await show();
  await screen.findByText(/Total gastado:/);
  let reject!: (error: unknown) => void;
  jest.mocked(readBucketConsumption).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    void client.invalidateQueries({ queryKey: consumptionOwnerKey(owner) });
  });
  expect(await screen.findByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByText(/Total gastado:/)).not.toBeOnTheScreen();
  await act(async () => reject(new Error('private')));
  await screen.findByRole('alert');
  expect(screen.queryByText(/Total gastado:/)).not.toBeOnTheScreen();
});
test('changed owner/period and delayed plan refresh never reuse old figures', async () => {
  const { client, tree, rerender } = await show();
  await screen.findByText(/Total gastado:/);
  await rerender(tree(owner, period, true));
  expect(screen.queryByText(/Total gastado:/)).not.toBeOnTheScreen();
  jest
    .mocked(readBucketConsumption)
    .mockImplementation(() => new Promise(() => {}));
  const other = 'f1030000-0000-4000-8000-000000000002';
  await rerender(tree('different-owner', other));
  expect(screen.queryByText(/Total gastado:/)).not.toBeOnTheScreen();
  expect(
    client.getQueryData(consumptionKey('different-owner', other)),
  ).toBeUndefined();
});
