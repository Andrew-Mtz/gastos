import { formatMoney, decimalText } from '../../budget/budget-setup';
import { createMoney } from '../../../domain/money/money';
import { createContext, useContext, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useAuth, type AuthState } from '../../auth/AuthProvider';
import { HouseholdScreen } from '../HouseholdScreen';
import { HouseholdExpenseHistory } from '../HouseholdExpenseHistory';
import { readHouseholdMemberships } from '../household-data';
import {
  readSharedExpensePage,
  readSharedExpenseHistoryDetail,
  sharedExpenseHistoryKey,
  sharedExpenseHistoryListKey,
  type SharedExpensePage,
} from '../shared-expense-history-data';
import { pendingSharedExpenseKey } from '../shared-expense-entry';
import {
  historyId as id,
  historyExpense as expense,
  historyPage as page,
  historyDetail as detail,
} from './history-fixtures';
jest.mock('../shared-expense-history-data', () => ({
  ...jest.requireActual('../shared-expense-history-data'),
  readSharedExpensePage: jest.fn(),
  readSharedExpenseHistoryDetail: jest.fn(),
}));
jest.mock('../shared-expense-data', () => ({
  ...jest.requireActual('../shared-expense-data'),
  readSharedExpense: jest.fn(),
}));
jest.mock('../household-data', () => ({
  ...jest.requireActual('../household-data'),
  readHouseholdMemberships: jest.fn(),
}));
jest.mock('../HouseholdSharedExpense', () => ({
  HouseholdSharedExpense: () => null,
}));
jest.mock('../HouseholdDefaultSplit', () => ({
  HouseholdDefaultSplit: () => null,
}));
jest.mock('../HouseholdInvitations', () => ({
  HouseholdInvitations: () => null,
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
const profile = {
  id: id(1),
  display_name: 'Ana',
  base_currency: 'UYU',
  timezone: 'UTC',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const members = [
  { id: id(40), profile_id: id(1), display_name: 'Ana', role: 'OWNER' },
  { id: id(41), profile_id: id(2), display_name: 'Beatriz', role: 'MEMBER' },
] as const;
const props = {
  profileId: id(1),
  householdId: id(20),
  householdName: 'Casa',
  members,
};
const Focus = createContext(true);
const originalAppState = AppState.currentState;
let state: AuthState;
let listener: (status: AppStateStatus) => void;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}
async function open(cache = client()) {
  const tree = (focused = true) => (
    <QueryClientProvider client={cache}>
      <Focus.Provider value={focused}>
        <HouseholdScreen />
      </Focus.Provider>
    </QueryClientProvider>
  );
  const view = await render(tree());
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Ver historial de Casa' }),
  );
  return { ...view, tree, cache, user };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  AppState.currentState = 'active';
  state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
  jest.mocked(useAuth).mockImplementation(() => ({
    state,
    warning: null,
    retry: jest.fn(),
    signOut: jest.fn(),
    signIn: jest.fn(),
    signUp: jest.fn(),
    isCurrentUser: (owner) =>
      state.status === 'AUTHENTICATED_READY' && state.userId === owner,
  }));
  jest.mocked(useFocusEffect).mockImplementation(function useFocus(callback) {
    const focused = useContext(Focus);
    useEffect(() => {
      if (focused) return callback();
    }, [focused, callback]);
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, handler) => {
      listener = handler;
      return { remove: jest.fn() };
    });
  jest.mocked(readHouseholdMemberships).mockResolvedValue({
    profile_id: id(1),
    creation_status: 'ACTIVE_MEMBERSHIP',
    households: [
      {
        id: id(20),
        name: 'Casa',
        default_currency: 'UYU',
        members: [...members],
      },
    ],
  });
  jest.mocked(readSharedExpensePage).mockResolvedValue(page());
  jest.mocked(readSharedExpenseHistoryDetail).mockResolvedValue(detail());
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  AppState.currentState = originalAppState;
});
test('history is opt-in per authorized home, shows original money and payer separately from saved responsibility', async () => {
  const { user } = await open();
  expect(await screen.findByText('Gasto 100')).toBeOnTheScreen();
  expect(
    screen.getByText(`2026-10-01 · ${formatMoney(createMoney(101, 'USD'))}`),
  ).toBeOnTheScreen();
  expect(screen.getByText('Pagó: Beatriz')).toBeOnTheScreen();
  expect(screen.getByText('Fin del historial.')).toBeOnTheScreen();
  await user.press(
    screen.getByRole('button', { name: `Ver gasto ${id(100)}` }),
  );
  expect(
    await screen.findByText('Detalle del gasto compartido'),
  ).toBeOnTheScreen();
  expect(readSharedExpenseHistoryDetail).toHaveBeenCalledWith(
    id(1),
    id(20),
    id(100),
    expect.any(AbortSignal),
  );
  expect(
    screen.getByText(
      `Ana: ${decimalText(7000, 2)}% · ${formatMoney(createMoney(71, 'USD'))}`,
    ),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      `Beatriz: ${decimalText(3000, 2)}% · ${formatMoney(createMoney(30, 'USD'))}`,
    ),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      `Miembro histórico (${id(42)}): ${decimalText(0, 2)}% · ${formatMoney(createMoney(0, 'USD'))}`,
    ),
  ).toBeOnTheScreen();
  expect(
    screen.queryByText(/Eliminar|Editar gasto|Revertir/),
  ).not.toBeOnTheScreen();
});
test('empty is distinct from error, retry and loading; raw errors and stale financial rows stay hidden', async () => {
  const delayed = deferred<SharedExpensePage>();
  jest
    .mocked(readSharedExpensePage)
    .mockReturnValueOnce(delayed.promise)
    .mockResolvedValue(page([]));
  const { user } = await open();
  expect(
    screen.getByText('Comprobando historial del hogar…'),
  ).toBeOnTheScreen();
  await act(async () =>
    delayed.reject(new Error('private infrastructure payload')),
  );
  expect(
    await screen.findByText(/No pudimos comprobar el historial/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByText('private infrastructure payload'),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByText('Aún no hay gastos compartidos en este hogar.'),
  ).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(
    await screen.findByText('Aún no hay gastos compartidos en este hogar.'),
  ).toBeOnTheScreen();
});
test('loads tied pages once under rapid taps, and refresh discards all previous pages', async () => {
  const first = page([expense(103), expense(102)], id(102));
  const next = deferred<SharedExpensePage>();
  jest
    .mocked(readSharedExpensePage)
    .mockResolvedValueOnce(first)
    .mockReturnValueOnce(next.promise)
    .mockResolvedValue(page([expense(104)]));
  const { user } = await open();
  await screen.findByText('Gasto 103');
  const more = screen.getByRole('button', { name: 'Cargar más gastos' });
  await fireEvent.press(more);
  await fireEvent.press(more);
  expect(readSharedExpensePage).toHaveBeenCalledTimes(2);
  await screen.findByText('Comprobando más gastos…');
  expect(screen.queryByText('Gasto 103')).not.toBeOnTheScreen();
  await act(async () => next.resolve(page([expense(101)])));
  expect(await screen.findByText('Gasto 101')).toBeOnTheScreen();
  expect(screen.getByText('Gasto 103')).toBeOnTheScreen();
  expect(readSharedExpensePage).toHaveBeenNthCalledWith(
    2,
    id(1),
    id(20),
    id(102),
    expect.any(AbortSignal),
  );
  await user.press(
    screen.getByRole('button', { name: 'Actualizar historial' }),
  );
  expect(await screen.findByText('Gasto 104')).toBeOnTheScreen();
  expect(screen.queryByText('Gasto 103')).not.toBeOnTheScreen();
  expect(screen.queryByText('Gasto 101')).not.toBeOnTheScreen();
  expect(readSharedExpensePage).toHaveBeenLastCalledWith(
    id(1),
    id(20),
    null,
    expect.any(AbortSignal),
  );
});
test('pagination denial hides previous pages and retry starts fresh, not an inferred empty or success', async () => {
  jest
    .mocked(readSharedExpensePage)
    .mockResolvedValueOnce(page([expense()], id(100)))
    .mockRejectedValueOnce({ code: '42501' })
    .mockResolvedValue(page([]));
  const { user } = await open();
  await screen.findByText('Gasto 100');
  await user.press(screen.getByRole('button', { name: 'Cargar más gastos' }));
  expect(
    await screen.findByText(/No pudimos comprobar el historial/),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Gasto 100')).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(
    await screen.findByText('Aún no hay gastos compartidos en este hogar.'),
  ).toBeOnTheScreen();
  expect(readSharedExpensePage).toHaveBeenLastCalledWith(
    id(1),
    id(20),
    null,
    expect.any(AbortSignal),
  );
});
test('detail is never seeded from list and fresh authorization failure hides the receipt', async () => {
  const delayed = deferred<ReturnType<typeof detail>>();
  jest
    .mocked(readSharedExpenseHistoryDetail)
    .mockReturnValueOnce(delayed.promise)
    .mockRejectedValue({ code: '42501' });
  const { user } = await open();
  await screen.findByText('Gasto 100');
  await user.press(
    screen.getByRole('button', { name: `Ver gasto ${id(100)}` }),
  );
  expect(screen.getByText('Comprobando detalle del gasto…')).toBeOnTheScreen();
  expect(screen.queryByText('Gasto 100')).not.toBeOnTheScreen();
  await act(async () => delayed.reject({ code: '42501' }));
  expect(
    await screen.findByText(/No pudimos comprobar este gasto/),
  ).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(readSharedExpenseHistoryDetail).toHaveBeenCalledTimes(2);
  await user.press(screen.getByRole('button', { name: 'Volver al historial' }));
  expect(await screen.findByText('Gasto 100')).toBeOnTheScreen();
});
test.each(['focus', 'background'] as const)(
  '%s hides and aborts history; return requires fresh membership and explicit history read',
  async (kind) => {
    const { user, rerender, tree, cache } = await open();
    await screen.findByText('Gasto 100');
    const signal = jest.mocked(readSharedExpensePage).mock.calls[0][3]!;
    if (kind === 'focus') await rerender(tree(false));
    else await act(() => listener('background'));
    expect(screen.queryByText('Gasto 100')).not.toBeOnTheScreen();
    expect(
      cache.getQueriesData({
        queryKey: sharedExpenseHistoryKey(id(1), id(20)),
      }),
    ).toEqual([]);
    // Settled fetches need no cancellation; pending fetches are covered separately.
    expect(signal).toBeInstanceOf(AbortSignal);
    jest.mocked(readSharedExpensePage).mockResolvedValue(page([]));
    if (kind === 'focus') await rerender(tree(true));
    else await act(() => listener('active'));
    await user.press(
      await screen.findByRole('button', { name: 'Ver historial de Casa' }),
    );
    expect(
      await screen.findByText('Aún no hay gastos compartidos en este hogar.'),
    ).toBeOnTheScreen();
    expect(readSharedExpensePage).toHaveBeenCalledTimes(2);
  },
);
test('unmount aborts an unfinished read; its late response cannot repopulate cache', async () => {
  const delayed = deferred<SharedExpensePage>();
  jest.mocked(readSharedExpensePage).mockReturnValue(delayed.promise);
  const { unmount, cache } = await open();
  const signal = jest.mocked(readSharedExpensePage).mock.calls[0][3]!;
  await unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => delayed.resolve(page()));
  expect(
    cache.getQueriesData({ queryKey: sharedExpenseHistoryKey(id(1), id(20)) }),
  ).toEqual([]);
});
test('old account response stays hidden and cannot restore cache after sign-out/account switch', async () => {
  const delayed = deferred<SharedExpensePage>();
  jest.mocked(readSharedExpensePage).mockReturnValue(delayed.promise);
  const { cache, rerender, tree } = await open();
  state = { status: 'UNAUTHENTICATED' };
  await act(async () => {
    await cache.cancelQueries();
    cache.clear();
  });
  await rerender(tree());
  state = {
    status: 'AUTHENTICATED_READY',
    userId: id(2),
    profile: { ...profile, id: id(2) },
  };
  jest.mocked(readHouseholdMemberships).mockResolvedValue({
    profile_id: id(2),
    creation_status: 'ELIGIBLE',
    households: [],
  });
  await rerender(tree());
  await act(async () => delayed.resolve(page()));
  expect(screen.queryByText('Gasto 100')).not.toBeOnTheScreen();
  expect(
    cache.getQueriesData({ queryKey: sharedExpenseHistoryKey(id(1), id(20)) }),
  ).toEqual([]);
});
test('household switch discards old pages/detail; late response cannot cross scopes', async () => {
  const cache = client();
  const delayed = deferred<SharedExpensePage>();
  jest
    .mocked(readSharedExpensePage)
    .mockReturnValueOnce(delayed.promise)
    .mockResolvedValue(page([]));
  const tree = (householdId: string) => (
    <QueryClientProvider client={cache}>
      <HouseholdExpenseHistory {...props} householdId={householdId} />
    </QueryClientProvider>
  );
  const view = await render(tree(id(20)));
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Ver historial de Casa' }),
  );
  await view.rerender(tree(id(21)));
  await act(async () => delayed.resolve(page()));
  expect(screen.queryByText('Gasto 100')).not.toBeOnTheScreen();
  await user.press(
    screen.getByRole('button', { name: 'Ver historial de Casa' }),
  );
  expect(
    await screen.findByText('Aún no hay gastos compartidos en este hogar.'),
  ).toBeOnTheScreen();
  expect(readSharedExpensePage).toHaveBeenLastCalledWith(
    id(1),
    id(21),
    null,
    expect.any(AbortSignal),
  );
});
test('cached pages never flash on reopening and history cannot clear an uncertain entry request', async () => {
  const cache = client();
  const pending = { request: { id: id(100) }, inFlight: true };
  cache.setQueryData(pendingSharedExpenseKey(id(1), id(20)), pending);
  cache.setQueryData(sharedExpenseHistoryListKey(id(1), id(20)), {
    pages: [page()],
    pageParams: [null],
  });
  const delayed = deferred<SharedExpensePage>();
  jest.mocked(readSharedExpensePage).mockReturnValueOnce(delayed.promise);
  const { user } = await open(cache);
  expect(screen.queryByText('Gasto 100')).not.toBeOnTheScreen();
  await act(async () => delayed.resolve(page()));
  await screen.findByText('Gasto 100');
  expect(cache.getQueryData(pendingSharedExpenseKey(id(1), id(20)))).toEqual(
    pending,
  );
  await user.press(screen.getByRole('button', { name: 'Cerrar historial' }));
  expect(cache.getQueryData(pendingSharedExpenseKey(id(1), id(20)))).toEqual(
    pending,
  );
});
test('invalid cross-page duplicates fail closed rather than rendering a partial history', async () => {
  jest
    .mocked(readSharedExpensePage)
    .mockResolvedValueOnce(page([expense()], id(100)))
    .mockResolvedValue(page([expense()]));
  const { user } = await open();
  await screen.findByText('Gasto 100');
  await user.press(screen.getByRole('button', { name: 'Cargar más gastos' }));
  expect(
    await screen.findByText(/No pudimos comprobar el historial/),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Gasto 100')).not.toBeOnTheScreen();
});
test('verified new receipt invalidation triggers fresh history read without touching write state', async () => {
  const { cache } = await open();
  await screen.findByText('Gasto 100');
  jest
    .mocked(readSharedExpensePage)
    .mockResolvedValue(page([expense(101), expense()]));
  await act(async () => {
    await cache.invalidateQueries({
      queryKey: sharedExpenseHistoryKey(id(1), id(20)),
    });
  });
  await waitFor(() => expect(readSharedExpensePage).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Gasto 101')).toBeOnTheScreen();
});

test('departure while open replaces stale parent names on list refresh and independent detail read', async () => {
  const { user } = await open();
  await screen.findByText('Gasto 100');
  expect(screen.getByText('Pagó: Beatriz')).toBeOnTheScreen();
  const active = [{ id: id(40), display_name: 'Ana actualizada' }];
  jest
    .mocked(readSharedExpenseHistoryDetail)
    .mockResolvedValue(detail(expense(), active));
  await user.press(
    screen.getByRole('button', { name: `Ver gasto ${id(100)}` }),
  );
  expect(
    await screen.findByText(`Pagó: Miembro histórico (${id(41)})`),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Pagó: Beatriz')).not.toBeOnTheScreen();
  expect(
    screen.getByText(
      `Ana actualizada: ${decimalText(7000, 2)}% · ${formatMoney(createMoney(71, 'USD'))}`,
    ),
  ).toBeOnTheScreen();
  jest
    .mocked(readSharedExpensePage)
    .mockResolvedValue({ ...page(), members: active });
  await user.press(screen.getByRole('button', { name: 'Volver al historial' }));
  expect(
    await screen.findByText(`Pagó: Miembro histórico (${id(41)})`),
  ).toBeOnTheScreen();
  expect(screen.queryByText('Pagó: Beatriz')).not.toBeOnTheScreen();
  // The original financial identity and amount remain intact; parent props never label history.
  await user.press(
    screen.getByRole('button', { name: `Ver gasto ${id(100)}` }),
  );
  expect(
    await screen.findByText(
      `Miembro histórico (${id(41)}): ${decimalText(3000, 2)}% · ${formatMoney(createMoney(30, 'USD'))}`,
    ),
  ).toBeOnTheScreen();
});
