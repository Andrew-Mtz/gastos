import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from 'react';
import { Text } from 'react-native';
import { act, screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router } from 'expo-router';
import AppLayout from '../../../../app/(app)/_layout';
import Home from '../../../../app/(app)/index';
import Transactions from '../../../../app/(app)/transactions';
import Budget from '../../../../app/(app)/budget';
import Household from '../../../../app/(app)/household';
import Settings from '../../../../app/(app)/settings';
import { AuthNavigator } from '../../auth/AuthNavigator';
import { useAuth } from '../../auth/AuthProvider';

jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const StateContext = createContext<
  'AUTHENTICATED_READY' | 'UNAUTHENTICATED' | 'AUTHENTICATED_PROFILE_MISSING'
>('AUTHENTICATED_READY');
const signOut = jest.fn<Promise<void>, []>();
let changeStatus: (
  status:
    'AUTHENTICATED_READY' | 'UNAUTHENTICATED' | 'AUTHENTICATED_PROFILE_MISSING',
) => void;
const routes = {
  _layout: AuthNavigator,
  '(app)/_layout': AppLayout,
  '(app)/index': Home,
  '(app)/transactions': Transactions,
  '(app)/budget': Budget,
  '(app)/household': Household,
  '(app)/settings': Settings,
  '(auth)/index': () => <Text>Auth destination</Text>,
  'profile-setup': () => <Text>Profile Setup destination</Text>,
};
const labels = ['Inicio', 'Transacciones', 'Presupuesto', 'Hogar', 'Ajustes'];

async function openShell(
  status:
    | 'AUTHENTICATED_READY'
    | 'UNAUTHENTICATED'
    | 'AUTHENTICATED_PROFILE_MISSING' = 'AUTHENTICATED_READY',
  initialUrl = '/',
) {
  function AuthFixture({ children }: PropsWithChildren) {
    const [current, setCurrent] = useState(status);
    changeStatus = setCurrent;
    return (
      <StateContext.Provider value={current}>{children}</StateContext.Provider>
    );
  }
  jest.mocked(useAuth).mockImplementation(function useFixtureAuth() {
    const current = useContext(StateContext);
    return {
      state:
        current === 'AUTHENTICATED_READY'
          ? {
              status: current,
              userId: 'user-a',
              profile: {
                id: 'user-a',
                display_name: 'User A',
                base_currency: 'UYU',
                timezone: 'UTC',
                created_at: '2026-09-12T00:00:00Z',
                updated_at: '2026-09-12T00:00:00Z',
              },
            }
          : current === 'AUTHENTICATED_PROFILE_MISSING'
            ? { status: current, userId: 'user-a' }
            : { status: current },
      warning: null,
      signIn: jest.fn(),
      signUp: jest.fn(),
      isCurrentUser: jest.fn(),
      signOut,
      retry: jest.fn(),
    };
  });
  return await renderRouter(routes, { initialUrl, wrapper: AuthFixture });
}

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
});
afterEach(() => {
  jest.useRealTimers();
});

test('ready opens Inicio and all five tabs navigate with coherent selection', async () => {
  await openShell();
  const user = userEvent.setup();
  expect(screen.getByRole('heading', { name: 'Gastos' })).toBeVisible();
  for (const label of labels)
    expect(screen.getByRole('button', { name: label })).toBeOnTheScreen();
  for (const label of [...labels.slice(1), 'Inicio', 'Hogar', 'Inicio']) {
    await user.press(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('button', { name: label })).toBeSelected();
    expect(
      screen.getByRole('heading', {
        name: label === 'Inicio' ? 'Gastos' : label,
      }),
    ).toBeVisible();
  }
  expect(
    screen.queryByRole('button', { name: 'Cerrar sesión' }),
  ).not.toBeVisible();
});

test('Settings invokes existing sign-out and logout removes private back history', async () => {
  await openShell();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Transacciones' }));
  await user.press(screen.getByRole('button', { name: 'Ajustes' }));
  signOut.mockImplementation(async () => {
    changeStatus('UNAUTHENTICATED');
  });
  await user.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Auth destination')).toBeVisible();
  expect(router.canGoBack()).toBe(false);
  await act(async () => {
    if (router.canGoBack()) router.back();
  });
  expect(
    screen.queryByRole('button', { name: 'Inicio' }),
  ).not.toBeOnTheScreen();

  expect(screen.getByText('Auth destination')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Cerrar sesión' }),
  ).not.toBeOnTheScreen();
});

test.each([
  ['UNAUTHENTICATED', 'Auth destination'],
  ['AUTHENTICATED_PROFILE_MISSING', 'Profile Setup destination'],
] as const)('%s cannot enter a private tab', async (status, destination) => {
  await openShell(status, '/settings');
  expect(await screen.findByText(destination)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Inicio' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Cerrar sesión' }),
  ).not.toBeOnTheScreen();
});
