import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { HistoryScreen } from '../HistoryScreen';
import { readHistory } from '../history-data';
import { useAuth } from '../../auth/AuthProvider';
import { currentMonth } from '../../budget/budget-setup';
import { profile, period } from '../../expense/__tests__/fixtures';
import { createTransaction } from '../../../domain/transaction/transaction';
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../history-data', () => ({
  ...jest.requireActual('../history-data'),
  readHistory: jest.fn(),
}));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../budget/budget-setup', () => ({
  ...jest.requireActual('../../budget/budget-setup'),
  currentMonth: jest.fn(),
}));
const tx = createTransaction({
  id: 'f1120000-0000-4000-8000-000000000001',
  ownerProfileId: profile.id,
  budgetPeriodId: period.id,
  scope: 'PERSONAL',
  type: 'EXPENSE',
  amountMinor: 12345,
  currency: 'USD',
  transactionDate: '2026-10-20',
  categoryId: 'f1070000-0000-4000-8000-000000000001',
  description: 'Lunch',
  deletedAt: null,
});
const page = {
  items: [{ transaction: tx, categoryName: 'Food' }],
  nextCursor: null,
};
function auth(id = profile.id) {
  jest.mocked(useAuth).mockReturnValue({
    state: {
      status: 'AUTHENTICATED_READY',
      userId: id,
      profile: { ...profile, id },
    },
    isCurrentUser: jest.fn(),
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    retry: jest.fn(),
    warning: null,
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  auth();
  jest.mocked(currentMonth).mockReturnValue('2026-10-01');
  jest.mocked(readHistory).mockResolvedValue(page);
});
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const element = (
    <QueryClientProvider client={client}>
      <HistoryScreen />
    </QueryClientProvider>
  );
  const view = await render(element);
  return { ...view, element, client };
}
test('history displays type, original amount, date, personal scope and category', async () => {
  await open();
  expect(await screen.findByText(/Gasto · USD/)).toHaveTextContent(/123,45/);
  expect(screen.getByText('2026-10-20 · Personal')).toBeOnTheScreen();
  expect(screen.getByText('Categoría: Food')).toBeOnTheScreen();
  expect(screen.getByText('Lunch')).toBeOnTheScreen();
});
test('month filtering clears prior results and renders explicit empty state', async () => {
  await open();
  await screen.findByText('Lunch');
  jest.mocked(readHistory).mockResolvedValue({ items: [], nextCursor: null });
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Mes anterior' }));
  expect(
    await screen.findByText('No hay movimientos en este mes.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Lunch')).not.toBeOnTheScreen();
  expect(readHistory).toHaveBeenLastCalledWith(
    profile.id,
    '2026-09-01',
    null,
    expect.any(AbortSignal),
  );
});
test('pagination loads next cursor without duplicate lookahead row', async () => {
  const cursor = { date: tx.transactionDate, id: tx.id };
  jest
    .mocked(readHistory)
    .mockResolvedValueOnce({ ...page, nextCursor: cursor })
    .mockResolvedValue({
      items: [
        {
          transaction: {
            ...tx,
            id: 'f1120000-0000-4000-8000-000000000002',
            type: 'INCOME',
            description: 'Salary',
            categoryId: null,
          },
          categoryName: null,
        },
      ],
      nextCursor: null,
    });
  await open();
  await screen.findByText('Lunch');
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Cargar más movimientos' }));
  expect(await screen.findByText('Salary')).toBeOnTheScreen();
  expect(screen.getAllByText('Lunch')).toHaveLength(1);
  expect(readHistory).toHaveBeenLastCalledWith(
    profile.id,
    '2026-10-01',
    cursor,
    expect.any(AbortSignal),
  );
  expect(
    screen.queryByRole('button', { name: 'Cargar más movimientos' }),
  ).not.toBeOnTheScreen();
});
test('new authenticated owner cannot see cached personal history', async () => {
  const view = await open();
  await screen.findByText('Lunch');
  auth('f0050000-0000-4000-8000-000000000002');
  jest.mocked(readHistory).mockResolvedValue({ items: [], nextCursor: null });
  await view.rerender(
    <QueryClientProvider client={view.client}>
      <HistoryScreen />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText('No hay movimientos en este mes.'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Lunch')).not.toBeOnTheScreen();
});
test('unmount cancels a pending read and errors expose no provider details', async () => {
  jest.mocked(readHistory).mockImplementation(() => new Promise(() => {}));
  const view = await open();
  await waitFor(() => expect(readHistory).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(readHistory).mock.calls[0][3]!;
  await view.unmount();
  expect(signal.aborted).toBe(true);
  jest
    .mocked(readHistory)
    .mockRejectedValue(new Error('private database detail'));
  await open();
  expect(
    await screen.findByText(/No se pudo cargar el historial/),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/private database detail/)).not.toBeOnTheScreen();
});

test('refocus invalidates the selected owner and month', async () => {
  await open();
  await screen.findByText('Lunch');
  jest.mocked(readHistory).mockResolvedValue({ items: [], nextCursor: null });
  await act(async () => {
    jest.mocked(useFocusEffect).mock.calls.at(-1)?.[0]();
  });
  expect(
    await screen.findByText('No hay movimientos en este mes.'),
  ).toBeOnTheScreen();
  expect(readHistory).toHaveBeenLastCalledWith(
    profile.id,
    '2026-10-01',
    null,
    expect.any(AbortSignal),
  );
});
test('failed next page can retry retained history then resume pagination', async () => {
  const cursor = { date: tx.transactionDate, id: tx.id };
  jest
    .mocked(readHistory)
    .mockResolvedValueOnce({ ...page, nextCursor: cursor })
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ ...page, nextCursor: cursor })
    .mockResolvedValue({ items: [], nextCursor: null });
  await open();
  await screen.findByText('Lunch');
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Cargar más movimientos' }),
  );
  expect(
    await screen.findByText(/No se pudo cargar el historial/),
  ).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Lunch')).toBeOnTheScreen();
  await user.press(
    screen.getByRole('button', { name: 'Cargar más movimientos' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Cargar más movimientos' }),
    ).not.toBeOnTheScreen(),
  );
  expect(screen.getAllByText('Lunch')).toHaveLength(1);
});

test('dashboard month parameter resets retained history on re-entry and allows manual browsing', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ month: period.starts_on });
  await open();
  await screen.findByText('Lunch');
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Mes anterior' }));
  await waitFor(() =>
    expect(readHistory).toHaveBeenLastCalledWith(
      profile.id,
      '2026-09-01',
      null,
      expect.any(AbortSignal),
    ),
  );
  await act(async () => {
    jest.mocked(useFocusEffect).mock.calls.at(-1)?.[0]();
  });
  await waitFor(() =>
    expect(readHistory).toHaveBeenLastCalledWith(
      profile.id,
      '2026-10-01',
      null,
      expect.any(AbortSignal),
    ),
  );
});
test.each(['2026-13-01', '2026-09-02', ['2026-09-01', '2026-10-01']])(
  'invalid history month param %s falls back to current month',
  async (month) => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ month });
    await open();
    await screen.findByText('Lunch');
    expect(readHistory).toHaveBeenLastCalledWith(
      profile.id,
      period.starts_on,
      null,
      expect.any(AbortSignal),
    );
  },
);
