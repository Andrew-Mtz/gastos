import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { calculateCommittedMoney } from '../../../domain/recurring/committed-money';
import { CommittedMoney } from '../CommittedMoney';
import { readCommittedMoney } from '../commitment-data';
import { recurringOwnerKey } from '../recurring-data';
import { period, profile } from './fixtures';
jest.mock('../commitment-data', () => ({
  ...jest.requireActual('../commitment-data'),
  readCommittedMoney: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
const result = {
  ...calculateCommittedMoney({
    currency: 'USD',
    priorUnresolvedCount: 3,
    buckets: [
      {
        budgetBucketId: 'f1040000-0000-4000-8000-000000000001',
        confirmedMinor: 0,
        estimatedMinor: 0,
        confirmedCount: 0,
        estimatedCount: 1,
        unknownCount: 2,
      },
    ],
  }),
  buckets: [],
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(readCommittedMoney).mockResolvedValue(result);
});
afterEach(() => jest.useRealTimers());
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <CommittedMoney period={period} />
    </QueryClientProvider>,
  );
  await screen.findByText(/Confirmado pendiente/);
  return { client, ...view };
}
test('zero monthly known amounts retain unknown and older warnings without false precision', async () => {
  await open();
  expect(
    screen.getByText(/Estimado pendiente: aproximadamente/),
  ).toBeOnTheScreen();
  expect(
    screen.getByText('Importe desconocido: 2 obligaciones'),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Hay 3 obligaciones pendientes/)).toBeOnTheScreen();
  expect(screen.getByText(/no cambies su fecha real/)).toBeOnTheScreen();
  expect(
    screen.getByText(
      /No es gasto realizado, saldo bancario ni dinero disponible/,
    ),
  ).toBeOnTheScreen();
});
test('stale figures disappear while refreshing and errors are not zero', async () => {
  const { client } = await open();
  let fail!: (e: Error) => void;
  jest.mocked(readCommittedMoney).mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await act(async () => {
    void client.invalidateQueries({ queryKey: recurringOwnerKey(profile.id) });
  });
  expect(
    await screen.findByText('Actualizando compromisos…'),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/Confirmado pendiente/)).not.toBeOnTheScreen();
  await act(async () => {
    fail(new Error('offline'));
  });
  await screen.findByText(/No se considerarán cero/);
  expect(screen.queryByText(/Confirmado pendiente/)).not.toBeOnTheScreen();
  jest.mocked(readCommittedMoney).mockResolvedValue(result);
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText(/Confirmado pendiente/);
});
test('owner/period change never renders prior owner cached totals', async () => {
  const { client, rerender } = await open();
  jest
    .mocked(readCommittedMoney)
    .mockImplementation(() => new Promise(() => {}));
  const other = {
    ...period,
    profile_id: 'f0050000-0000-4000-8000-000000000002',
    id: 'f1030000-0000-4000-8000-000000000002',
    starts_on: '2026-11-01',
    ends_on: '2026-11-30',
  };
  await rerender(
    <QueryClientProvider client={client}>
      <CommittedMoney period={other} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText(/Confirmado pendiente/)).not.toBeOnTheScreen();
  await waitFor(() =>
    expect(readCommittedMoney).toHaveBeenCalledWith(
      other,
      expect.any(AbortSignal),
    ),
  );
});
