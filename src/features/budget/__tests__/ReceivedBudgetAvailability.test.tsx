import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { ReceivedBudgetAvailability } from '../ReceivedBudgetAvailability';
import { createBudgetAllocationPlan } from '../../../domain/budget/budget-allocation';
import {
  incomeOwnerKey,
  readReceivedIncome,
  receivedIncomeKey,
} from '../../income/income-data';
import { buckets } from './fixtures';
jest.mock('../../income/income-data', () => ({
  ...jest.requireActual('../../income/income-data'),
  readReceivedIncome: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
const profileId = buckets[0].profile_id;
const periodId = 'f1100000-0000-4000-8000-000000000001';
const plan = createBudgetAllocationPlan(
  periodId,
  'USD',
  buckets.map((bucket, index) => ({
    budgetBucketId: bucket.id,
    percentageBasisPoints: [5000, 3000, 2000][index],
  })),
);
let focus: (() => void | (() => void)) | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readReceivedIncome).mockResolvedValue(143000);
  jest.mocked(useFocusEffect).mockImplementation((callback) => {
    focus = callback;
  });
});
async function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const tree = (owner = profileId, input = plan) => (
    <QueryClientProvider client={client}>
      <ReceivedBudgetAvailability
        profileId={owner}
        plan={input}
        buckets={buckets}
      />
    </QueryClientProvider>
  );
  const view = await render(tree());
  return { ...view, client, tree };
}
test('shows actual distribution and identifies savings as not ordinary spendable money', async () => {
  await show();
  await screen.findByText(/Total recibido:/);
  expect(screen.getByText(/Total recibido:/)).toHaveTextContent(/1.430,00/);
  expect(screen.getByText(/Necesidades:/)).toHaveTextContent(/715,00/);
  expect(screen.getByText(/Ocio:/)).toHaveTextContent(/429,00/);
  expect(screen.getByText(/Ahorro:/)).toHaveTextContent(
    /286,00.*no a gasto libre/,
  );
  expect(screen.getByText(/Ahorro protegido asignado:/)).toHaveTextContent(
    /286,00/,
  );
  expect(screen.getByText(/Asignado a gasto ordinario:/)).toHaveTextContent(
    /1.144,00/,
  );
  expect(screen.getByText(/no al ahorro acumulado/)).toBeOnTheScreen();
  expect(screen.getByText(/No son un saldo restante/)).toBeOnTheScreen();
});
test('zero received renders zero allocations', async () => {
  jest.mocked(readReceivedIncome).mockResolvedValue(0);
  await show();
  await screen.findByText(/Total recibido:/);
  expect(screen.getByText(/Necesidades:/)).toHaveTextContent(/0,00/);
  expect(screen.getByText(/Ahorro:/)).toHaveTextContent(/0,00/);
  expect(screen.getByText(/Ahorro protegido asignado:/)).toHaveTextContent(
    /0,00/,
  );
  expect(screen.getByText(/Asignado a gasto ordinario:/)).toHaveTextContent(
    /0,00/,
  );
});
test('loading never substitutes zero or a planned amount', async () => {
  jest
    .mocked(readReceivedIncome)
    .mockImplementation(() => new Promise(() => {}));
  const view = await show();
  expect(screen.getByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByText(/Total recibido:/)).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Ahorro protegido asignado:/),
  ).not.toBeOnTheScreen();
  const signal = jest.mocked(readReceivedIncome).mock.calls[0][1]!;
  await view.unmount();
  expect(signal.aborted).toBe(true);
});
test('query failure hides actual figures and allows a sanitized retry', async () => {
  jest
    .mocked(readReceivedIncome)
    .mockRejectedValueOnce(new Error('private SQL detail'));
  await show();
  await screen.findByRole('alert');
  expect(screen.queryByText(/Total recibido:/)).not.toBeOnTheScreen();
  expect(screen.queryByText(/private SQL detail/)).not.toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Reintentar disponibilidad' }));
  expect(await screen.findByText(/Total recibido:/)).toHaveTextContent(
    /1.430,00/,
  );
});
test('owner income invalidation immediately recomputes allocations from the new total', async () => {
  const { client } = await show();
  await screen.findByText(/Total recibido:/);
  jest.mocked(readReceivedIncome).mockResolvedValue(200000);
  await act(async () => {
    await client.invalidateQueries({ queryKey: incomeOwnerKey(profileId) });
  });
  await waitFor(() =>
    expect(screen.getByText(/Necesidades:/)).toHaveTextContent(/1.000,00/),
  );
  expect(screen.getByText(/Ahorro:/)).toHaveTextContent(/400,00/);
  expect(screen.getByText(/Ahorro protegido asignado:/)).toHaveTextContent(
    /400,00/,
  );
  expect(screen.getByText(/Asignado a gasto ordinario:/)).toHaveTextContent(
    /1.600,00/,
  );
});
test('refocusing refreshes the received total, including external deletions', async () => {
  await show();
  await screen.findByText(/Total recibido:/);
  jest.mocked(readReceivedIncome).mockResolvedValue(0);
  await act(async () => {
    focus?.();
  });
  await waitFor(() =>
    expect(screen.getByText(/Total recibido:/)).toHaveTextContent(/0,00/),
  );
});
test('a new owner/period never receives cached figures from the previous identity', async () => {
  const { client, tree, rerender } = await show();
  await screen.findByText(/Total recibido:/);
  const otherOwner = 'f1100000-0000-4000-8000-000000000002';
  const otherPlan = createBudgetAllocationPlan(
    'f1100000-0000-4000-8000-000000000003',
    'USD',
    plan.allocations,
  );
  jest
    .mocked(readReceivedIncome)
    .mockImplementation(() => new Promise(() => {}));
  await rerender(tree(otherOwner, otherPlan));
  expect(screen.queryByText(/Total recibido:/)).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Ahorro protegido asignado:/),
  ).not.toBeOnTheScreen();
  expect(
    client.getQueryData(
      receivedIncomeKey(otherOwner, otherPlan.budgetPeriodId),
    ),
  ).toBeUndefined();
  expect(jest.mocked(readReceivedIncome).mock.calls.at(-1)?.[0]).toBe(
    otherPlan.budgetPeriodId,
  );
});

test('failed refresh hides cached protected and spendable allocations rather than showing stale savings', async () => {
  const { client } = await show();
  await screen.findByText(/Ahorro protegido asignado:/);
  jest
    .mocked(readReceivedIncome)
    .mockRejectedValue(new Error('private detail'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: incomeOwnerKey(profileId) });
  });
  await screen.findByRole('alert');
  expect(
    screen.queryByText(/Ahorro protegido asignado:/),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Asignado a gasto ordinario:/),
  ).not.toBeOnTheScreen();
});

test('missing allocation classification fails closed without exposing a misleading spendable figure', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <ReceivedBudgetAvailability
        profileId={profileId}
        plan={plan}
        buckets={buckets.slice(0, 2)}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /No se pudo verificar la protección del ahorro/,
  );
  expect(screen.queryByText(/Total recibido:/)).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Asignado a gasto ordinario:/),
  ).not.toBeOnTheScreen();
});

test('archived custom savings remains protected regardless of its label', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <ReceivedBudgetAvailability
        profileId={profileId}
        plan={plan}
        buckets={buckets.map((bucket) => ({
          ...bucket,
          name: 'Reserva histórica',
          is_system: false,
          system_key: null,
          archived_at: '2026-10-01T00:00:00Z',
        }))}
      />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText(/Ahorro protegido asignado:/),
  ).toHaveTextContent(/286,00/);
  expect(screen.getByText(/Asignado a gasto ordinario:/)).toHaveTextContent(
    /1.144,00/,
  );
  expect(
    screen.getByText(/Reserva histórica:.*286,00.*no a gasto libre/),
  ).toBeOnTheScreen();
});
