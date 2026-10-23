import { createContext, useContext, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useAuth, type AuthState } from '../../auth/AuthProvider';
import { HouseholdScreen } from '../HouseholdScreen';
import { readHouseholdMemberships } from '../household-data';
import {
  pendingSplitKey,
  readDefaultSplit,
  saveDefaultSplit,
  splitKey,
  type SplitSnapshot,
} from '../split-data';
import { splitId as id, splitSnapshot } from './split-fixtures';
jest.mock('../HouseholdInvitations', () => ({
  HouseholdInvitations: () => null,
}));
jest.mock('../household-data', () => ({
  ...jest.requireActual('../household-data'),
  readHouseholdMemberships: jest.fn(),
}));
jest.mock('../split-data', () => ({
  ...jest.requireActual('../split-data'),
  readDefaultSplit: jest.fn(),
  saveDefaultSplit: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const profile = {
  id: id(1),
  display_name: 'Ana',
  base_currency: 'USD',
  timezone: 'UTC',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const Focus = createContext(true);
const initialAppState = AppState.currentState;
let state: AuthState;
let listener: (state: AppStateStatus) => void;
let server: SplitSnapshot;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
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
  return { ...view, tree, client: cache };
}
async function review(a = '70', b = '30') {
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Editar reparto' }),
  );
  await user.type(screen.getByLabelText('Porcentaje de Ana'), a);
  await user.type(screen.getByLabelText('Porcentaje de Beatriz'), b);
  await user.press(screen.getByRole('button', { name: 'Revisar reparto' }));
  return user;
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  AppState.currentState = 'active';
  server = splitSnapshot();
  state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
  jest.mocked(useAuth).mockImplementation(() => ({
    state,
    warning: null,
    retry: jest.fn(),
    signOut: jest.fn(async () => {}),
    signIn: jest.fn(async () => {}),
    signUp: jest.fn(async () => false),
    isCurrentUser: (owner) =>
      state.status === 'AUTHENTICATED_READY' && state.userId === owner,
  }));
  jest.mocked(useFocusEffect).mockImplementation(function useFocus(callback) {
    const focused = useContext(Focus);
    useEffect(() => {
      if (focused) return callback();
    }, [callback, focused]);
  });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, handler) => {
      listener = handler;
      return { remove: jest.fn() };
    });
  jest.mocked(randomUUID).mockReturnValue(id(50));
  jest.mocked(readHouseholdMemberships).mockImplementation(async () => ({
    profile_id: server.profile_id,
    creation_status: 'ACTIVE_MEMBERSHIP',
    households: [
      {
        id: server.household_id,
        name: 'Casa',
        default_currency: 'USD',
        members: server.roster,
      },
    ],
  }));
  jest.mocked(readDefaultSplit).mockImplementation(async () => server);
  jest.mocked(saveDefaultSplit).mockImplementation(async (request) => ({
    request_id: request.id,
    household_id: request.householdId,
    version: request.expectedVersion + 1,
  }));
});
afterEach(() => {
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('unconfigured is not an implicit persisted default; explicit values and confirmation required', async () => {
  await open();
  await screen.findByText(/Aún no hay un reparto configurado/);
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Editar reparto' }));
  expect(screen.getByLabelText('Porcentaje de Ana')).toHaveDisplayValue('');
  await user.press(screen.getByRole('button', { name: 'Revisar reparto' }));
  expect(screen.getAllByText(/Ingresa de 0 a 100/)).toHaveLength(2);
  expect(saveDefaultSplit).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Porcentaje de Ana'), '70');
  await user.type(screen.getByLabelText('Porcentaje de Beatriz'), '30');
  await user.press(screen.getByRole('button', { name: 'Revisar reparto' }));
  expect(screen.getByText('Ana: 70.00%')).toBeOnTheScreen();
  expect(saveDefaultSplit).not.toHaveBeenCalled();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y guardar reparto' }),
  );
  expect(saveDefaultSplit).toHaveBeenCalledTimes(1);
  expect(saveDefaultSplit).toHaveBeenCalledWith({
    id: id(50),
    householdId: id(20),
    expectedVersion: 0,
    roster: [id(40), id(41)],
    shares: [
      { member_id: id(40), basis_points: 7000 },
      { member_id: id(41), basis_points: 3000 },
    ],
  });
  await screen.findByText(/Guardado confirmado/);
});
test('member can see configured percentages but never owner editor', async () => {
  server = splitSnapshot('READY', 'MEMBER');
  await open();
  await screen.findByText('Ana: 70.00%');
  expect(screen.getByText(/Solo consulta/)).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Editar reparto' }),
  ).not.toBeOnTheScreen();
});
test('stale roster does not display old shares, prefill or auto-redistribute', async () => {
  server = splitSnapshot('STALE');
  await open();
  await screen.findByText(/Cambió la composición/);
  expect(screen.queryByText('Ana: 70.00%')).not.toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Editar reparto' }));
  expect(screen.getByLabelText('Porcentaje de Ana')).toHaveDisplayValue('');
  expect(saveDefaultSplit).not.toHaveBeenCalled();
});
test('cancel/return never save; total must be exactly 100 and explicit 0 is accepted', async () => {
  await open();
  const user = await review('100', '0');
  await user.press(
    screen.getByRole('button', { name: 'Volver a porcentajes' }),
  );
  expect(screen.getByLabelText('Porcentaje de Beatriz')).toHaveDisplayValue(
    '0',
  );
  await user.clear(screen.getByLabelText('Porcentaje de Ana'));
  await user.type(screen.getByLabelText('Porcentaje de Ana'), '99.99');
  await user.press(screen.getByRole('button', { name: 'Revisar reparto' }));
  expect(
    screen.getByText('Los porcentajes deben sumar 100%.'),
  ).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Cancelar reparto' }));
  expect(saveDefaultSplit).not.toHaveBeenCalled();
});
test('pending prevents double submission and survives remount with exact original request', async () => {
  const promise = deferred<{
    request_id: string;
    household_id: string;
    version: number;
  }>();
  jest.mocked(saveDefaultSplit).mockReturnValueOnce(promise.promise);
  const view = await open();
  const user = await review();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y guardar reparto' }),
  );
  expect(
    screen.getByRole('button', { name: 'Comprobar reparto pendiente' }),
  ).toBeDisabled();
  await view.unmount();
  await open(view.client);
  await screen.findByRole('button', { name: 'Editar reparto' });
  expect(screen.getByRole('button', { name: 'Editar reparto' })).toBeDisabled();
  await act(async () => promise.reject(new Error('response lost')));
  await screen.findByText(/Hay un guardado sin confirmar/);
  await user.press(
    screen.getByRole('button', { name: 'Comprobar reparto pendiente' }),
  );
  expect(saveDefaultSplit).toHaveBeenCalledTimes(2);
  expect(jest.mocked(saveDefaultSplit).mock.calls[1][0]).toEqual(
    jest.mocked(saveDefaultSplit).mock.calls[0][0],
  );
  expect(jest.mocked(saveDefaultSplit).mock.calls[1][0]).not.toHaveProperty(
    'inFlight',
  );
  await screen.findByText(/Guardado confirmado/);
});
test('lost response is not reconciled from matching percentages or a newer version; exact receipt must confirm', async () => {
  jest
    .mocked(saveDefaultSplit)
    .mockRejectedValueOnce(new Error('response lost'));
  const view = await open();
  const user = await review();
  server = splitSnapshot('READY');
  server = {
    ...server,
    version: 2,
    template: { ...server.template!, id: id(51), version: 2 },
  };
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y guardar reparto' }),
  );
  await screen.findByText('Versión 2');
  expect(
    view.client.getQueryData(pendingSplitKey(id(1), id(20))),
  ).not.toBeNull();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar reparto pendiente' }),
  );
  await screen.findByText(/Guardado confirmado \(versión 1\)/);
  expect(screen.getByText('Versión 2')).toBeOnTheScreen();
  expect(saveDefaultSplit).toHaveBeenCalledTimes(2);
});
test('version/roster conflict clears rejected request and requires new review', async () => {
  jest
    .mocked(saveDefaultSplit)
    .mockRejectedValueOnce({ code: '40001', message: 'raw private error' });
  const view = await open();
  const user = await review();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y guardar reparto' }),
  );
  await screen.findByText(/Cambió el reparto o la lista/);
  expect(view.client.getQueryData(pendingSplitKey(id(1), id(20)))).toBeNull();
  expect(screen.queryByText('raw private error')).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Confirmar y guardar reparto' }),
  ).not.toBeOnTheScreen();
});
test.each(['blur', 'background'] as const)(
  '%s dismisses unsent confirmation and revalidates before displaying shared data',
  async (mode) => {
    const view = await open();
    await review();
    const pending = deferred<SplitSnapshot>();
    jest.mocked(readDefaultSplit).mockReturnValueOnce(pending.promise);
    if (mode === 'blur') await view.rerender(view.tree(false));
    else await act(async () => listener('background'));
    expect(screen.queryByText('Confirmar reparto')).not.toBeOnTheScreen();
    if (mode === 'blur') await view.rerender(view.tree());
    else await act(async () => listener('active'));
    await screen.findByText('Comprobando reparto…');
    expect(
      screen.queryByRole('button', { name: 'Confirmar y guardar reparto' }),
    ).not.toBeOnTheScreen();
    await act(async () => pending.resolve(splitSnapshot('READY', 'MEMBER')));
    await screen.findByText('Ana: 70.00%');
    expect(
      screen.queryByRole('button', { name: 'Editar reparto' }),
    ).not.toBeOnTheScreen();
    expect(saveDefaultSplit).not.toHaveBeenCalled();
  },
);
test('read failure hides cached percentages and refresh discards unsent draft', async () => {
  server = splitSnapshot('READY');
  await open();
  await screen.findByText('Ana: 70.00%');
  jest.mocked(readDefaultSplit).mockRejectedValueOnce(new Error('offline'));
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Actualizar reparto' }));
  await screen.findByText(/No pudimos comprobar el reparto/);
  expect(screen.queryByText('Ana: 70.00%')).not.toBeOnTheScreen();
});
test('logout/account change cannot restore pending or loaded data when old request completes', async () => {
  const promise = deferred<{
    request_id: string;
    household_id: string;
    version: number;
  }>();
  jest.mocked(saveDefaultSplit).mockReturnValueOnce(promise.promise);
  const view = await open();
  const user = await review();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y guardar reparto' }),
  );
  await act(async () => {
    state = { status: 'UNAUTHENTICATED' };
    view.client.clear();
  });
  await view.rerender(view.tree());
  await act(async () =>
    promise.resolve({ request_id: id(50), household_id: id(20), version: 1 }),
  );
  expect(
    view.client.getQueryData(pendingSplitKey(id(1), id(20))),
  ).toBeUndefined();
  expect(view.client.getQueryData(splitKey(id(1), id(20)))).toBeUndefined();
  expect(screen.queryByText(/Guardado confirmado/)).not.toBeOnTheScreen();
});
test('late read after account switch cannot expose the old roster', async () => {
  const pending = deferred<SplitSnapshot>();
  jest.mocked(readDefaultSplit).mockReturnValueOnce(pending.promise);
  const view = await open();
  await screen.findByText('Comprobando reparto…');
  await act(async () => {
    state = { status: 'UNAUTHENTICATED' };
    view.client.clear();
  });
  await view.rerender(view.tree());
  await act(async () => pending.resolve(splitSnapshot('READY')));
  expect(screen.queryByText('Ana: 70.00%')).not.toBeOnTheScreen();
  await waitFor(() =>
    expect(view.client.getQueryData(splitKey(id(1), id(20)))).toBeUndefined(),
  );
});

test('switching to another ready account isolates its roster and ignores prior save completion', async () => {
  const pending = deferred<{
    request_id: string;
    household_id: string;
    version: number;
  }>();
  jest.mocked(saveDefaultSplit).mockReturnValueOnce(pending.promise);
  const view = await open();
  const user = await review();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y guardar reparto' }),
  );
  const otherProfile = { ...profile, id: id(3), display_name: 'Carla' };
  server = {
    profile_id: id(3),
    household_id: id(21),
    version: 0,
    status: 'UNCONFIGURED',
    template: null,
    roster: [
      { id: id(43), profile_id: id(3), display_name: 'Carla', role: 'OWNER' },
    ],
  };
  await act(async () => {
    state = {
      status: 'AUTHENTICATED_READY',
      userId: id(3),
      profile: otherProfile,
    };
    view.client.clear();
  });
  await view.rerender(view.tree());
  await screen.findByRole('button', { name: 'Editar reparto' });
  await act(async () =>
    pending.resolve({ request_id: id(50), household_id: id(20), version: 1 }),
  );
  expect(screen.queryByText(/Guardado confirmado/)).not.toBeOnTheScreen();
  expect(screen.queryByText(/Ana:/)).not.toBeOnTheScreen();
  expect(
    view.client.getQueryData(pendingSplitKey(id(1), id(20))),
  ).toBeUndefined();
  expect(view.client.getQueryData(splitKey(id(1), id(20)))).toBeUndefined();
  expect(view.client.getQueryData(splitKey(id(3), id(21)))).toEqual(server);
});

test('same-account re-login cannot resurrect an old pending save after cache identity is cleared', async () => {
  const pending = deferred<{
    request_id: string;
    household_id: string;
    version: number;
  }>();
  jest.mocked(saveDefaultSplit).mockReturnValueOnce(pending.promise);
  const view = await open();
  const user = await review();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y guardar reparto' }),
  );
  await act(async () => {
    state = { status: 'UNAUTHENTICATED' };
    view.client.clear();
  });
  await view.rerender(view.tree());
  state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
  await view.rerender(view.tree());
  await screen.findByRole('button', { name: 'Editar reparto' });
  await act(async () => pending.reject(new Error('late transport failure')));
  expect(view.client.getQueryData(pendingSplitKey(id(1), id(20)))).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Comprobar reparto pendiente' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/No se pudo confirmar el guardado/),
  ).not.toBeOnTheScreen();
});
