import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { AppState, Button, Text, View } from 'react-native';
import {
  supabase,
  sessionStorage,
  sessionStorageStatus,
} from '../../../infrastructure/supabase/client';
import { AuthProvider, useAuth } from '../AuthProvider';
import { AuthNavigator } from '../AuthNavigator';
import { SignInScreen, SignUpScreen, ProfileSetupScreen } from '../AuthScreens';
import { readProfile, createProfile, profileKey } from '../auth-data';

jest.mock('../../../infrastructure/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
      signOut: jest.fn(),
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
    },
  },
  authStorageKey: 'gastos-auth',
  sessionStorage: { removeItem: jest.fn() },
  sessionStorageStatus: {
    getError: jest.fn(),
    clear: jest.fn(),
    subscribe: jest.fn(),
  },
}));
jest.mock('../auth-data', () => ({
  ...jest.requireActual('../auth-data'),
  readProfile: jest.fn(),
  createProfile: jest.fn(),
}));
jest.mock('expo-router', () => {
  const { Text, View }: typeof import('react-native') =
    jest.requireActual('react-native');
  function Stack({ children }: { children: React.ReactNode }) {
    return <View>{children}</View>;
  }
  Stack.Protected = function Protected({
    guard,
    children,
  }: {
    guard: boolean;
    children: React.ReactNode;
  }) {
    return guard ? children : null;
  };
  Stack.Screen = function Screen({ name }: { name: string }) {
    return <Text>{`route:${name}`}</Text>;
  };
  return {
    Stack,
    Link: ({ children }: { children: React.ReactNode }) => (
      <Text>{children}</Text>
    ),
  };
});
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const profileA = {
  id: a,
  display_name: 'Ana',
  base_currency: 'UYU',
  timezone: 'UTC',
  created_at: '2026-09-11',
  updated_at: '2026-09-11',
};
const profileB = { ...profileA, id: b, display_name: 'Bruno' };
function session(id: string): Session {
  return {
    access_token: 'synthetic',
    refresh_token: 'synthetic',
    token_type: 'bearer',
    expires_in: 3600,
    user: {
      id,
      aud: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-09-11',
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let emit: Parameters<typeof supabase.auth.onAuthStateChange>[0];
let changeAppState: (state: 'active' | 'background') => void;
const unsubscribe = jest.fn();
const removeListener = jest.fn();
const removeStorageListener = jest.fn();
let queryClient: QueryClient;
beforeEach(() => {
  jest.resetAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  jest
    .mocked(supabase.auth.getSession)
    .mockResolvedValue({ data: { session: null }, error: null });
  jest
    .mocked(supabase.auth.onAuthStateChange)
    .mockImplementation((callback) => {
      emit = callback;
      return { data: { subscription: { id: 'test', callback, unsubscribe } } };
    });
  jest.mocked(supabase.auth.startAutoRefresh).mockResolvedValue(undefined);
  jest.mocked(supabase.auth.stopAutoRefresh).mockResolvedValue(undefined);
  jest.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
  jest.mocked(sessionStorage.removeItem).mockResolvedValue(undefined);
  jest.mocked(sessionStorageStatus.getError).mockReturnValue(null);
  jest
    .mocked(sessionStorageStatus.subscribe)
    .mockReturnValue(removeStorageListener);
  jest.mocked(readProfile).mockResolvedValue(null);
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      changeAppState = listener;
      return { remove: removeListener };
    });
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  queryClient.clear();
});
function Probe({ action }: { action?: () => void }) {
  const auth = useAuth();
  return (
    <View>
      <Text>{auth.state.status}</Text>
      {auth.warning && <Text>{auth.warning}</Text>}
      {'profile' in auth.state && (
        <Text>{auth.state.profile.display_name}</Text>
      )}
      <AuthNavigator />
      <Button
        title="Logout"
        onPress={() => {
          void auth.signOut();
        }}
      />
      <Button title="External event" onPress={action} />
    </View>
  );
}
async function mount(children: React.ReactNode = <Probe />) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>,
  );
}
test('initialization keeps routes hidden; a newer identity wins over stale getSession', async () => {
  const initial =
    deferred<Awaited<ReturnType<typeof supabase.auth.getSession>>>();
  jest.mocked(supabase.auth.getSession).mockReturnValue(initial.promise);
  jest.mocked(readProfile).mockResolvedValue(profileB);
  await mount(
    <Probe
      action={() => {
        emit('SIGNED_IN', session(b));
        initial.resolve({ data: { session: session(a) }, error: null });
      }}
    />,
  );
  expect(screen.getByText('INITIALIZING')).toBeOnTheScreen();
  expect(screen.queryByText('route:(auth)')).not.toBeOnTheScreen();
  expect(readProfile).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button', { name: 'External event' }));
  expect(await screen.findByText('Bruno')).toBeOnTheScreen();
  expect(readProfile).toHaveBeenCalledWith(b, expect.any(AbortSignal));
  expect(readProfile).not.toHaveBeenCalledWith(a, expect.anything());
});
test('missing Profile routes to setup; query errors route to retry and not setup', async () => {
  jest
    .mocked(supabase.auth.getSession)
    .mockResolvedValue({ data: { session: session(a) }, error: null });
  jest
    .mocked(readProfile)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(null);
  await mount();
  expect(
    await screen.findByText('AUTHENTICATED_PROFILE_ERROR'),
  ).toBeOnTheScreen();
  expect(screen.queryByText('route:profile-setup')).not.toBeOnTheScreen();
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('route:profile-setup')).toBeOnTheScreen();
});
test('late User A result cannot populate User B cache or private UI', async () => {
  const late = deferred<typeof profileA>();
  jest
    .mocked(readProfile)
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue(profileB);
  jest
    .mocked(supabase.auth.getSession)
    .mockResolvedValue({ data: { session: session(a) }, error: null });
  await mount(
    <Probe
      action={() => {
        emit('SIGNED_IN', session(b));
        late.resolve(profileA);
      }}
    />,
  );
  await waitFor(() =>
    expect(readProfile).toHaveBeenCalledWith(a, expect.any(AbortSignal)),
  );
  await userEvent.press(screen.getByRole('button', { name: 'External event' }));
  expect(await screen.findByText('Bruno')).toBeOnTheScreen();
  expect(screen.queryByText('Ana')).not.toBeOnTheScreen();
  expect(queryClient.getQueryData(profileKey(a))).toBeUndefined();
});
test('logout locks immediately, clears private cache, and confirms local removal', async () => {
  jest
    .mocked(supabase.auth.getSession)
    .mockResolvedValueOnce({ data: { session: session(a) }, error: null })
    .mockResolvedValue({ data: { session: null }, error: null });
  jest.mocked(readProfile).mockResolvedValue(profileA);
  const logout = deferred<{ error: null }>();
  jest.mocked(supabase.auth.signOut).mockReturnValue(logout.promise);
  await mount(<Probe action={() => logout.resolve({ error: null })} />);
  await screen.findByText('Ana');
  await userEvent.press(screen.getByRole('button', { name: 'Logout' }));
  expect(screen.getByText('SIGNING_OUT')).toBeOnTheScreen();
  expect(screen.queryByText('Ana')).not.toBeOnTheScreen();
  expect(queryClient.getQueryData(profileKey(a))).toBeUndefined();
  await userEvent.press(screen.getByRole('button', { name: 'External event' }));
  expect(await screen.findByText('route:(auth)')).toBeOnTheScreen();
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(sessionStorage.removeItem).toHaveBeenCalledWith('gastos-auth');
  expect(queryClient.getQueryData(profileKey(a))).toBeUndefined();
});
test('logout cleanup failure keeps routes locked until retry succeeds', async () => {
  jest
    .mocked(sessionStorage.removeItem)
    .mockRejectedValueOnce(new Error('locked'));
  await mount();
  await screen.findByText('route:(auth)');
  await userEvent.press(screen.getByRole('button', { name: 'Logout' }));
  expect(
    await screen.findByText(
      'No se pudo confirmar el cierre local. Intenta nuevamente.',
    ),
  ).toBeOnTheScreen();
  expect(screen.queryByText('route:(auth)')).not.toBeOnTheScreen();
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('route:(auth)')).toBeOnTheScreen();
});
test('storage initialization failure is retryable and never shows auth/private routes', async () => {
  jest
    .mocked(supabase.auth.getSession)
    .mockRejectedValueOnce(new Error('locked'));
  await mount();
  expect(await screen.findByText('INITIALIZATION_ERROR')).toBeOnTheScreen();
  expect(screen.queryByText('route:(auth)')).not.toBeOnTheScreen();
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('route:(auth)')).toBeOnTheScreen();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
test('one AppState/auth listener reconciles foreground/background and cleans up on unmount', async () => {
  const mounted = await mount(
    <Probe
      action={() => {
        AppState.currentState = 'background';
        changeAppState('background');
      }}
    />,
  );
  await waitFor(() =>
    expect(supabase.auth.startAutoRefresh).toHaveBeenCalledTimes(1),
  );
  await userEvent.press(screen.getByRole('button', { name: 'External event' }));
  expect(supabase.auth.stopAutoRefresh).toHaveBeenCalled();
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  await mounted.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(removeListener).toHaveBeenCalledTimes(1);
  expect(removeStorageListener).toHaveBeenCalledTimes(1);
});
test('initialization completing after unmount cannot start refresh', async () => {
  const initial =
    deferred<Awaited<ReturnType<typeof supabase.auth.getSession>>>();
  jest.mocked(supabase.auth.getSession).mockReturnValue(initial.promise);
  const mounted = await mount();
  await mounted.unmount();
  initial.resolve({ data: { session: null }, error: null });
  await initial.promise;
  expect(supabase.auth.startAutoRefresh).not.toHaveBeenCalled();
});
test('sign-in form rejects invalid credentials before calling Auth', async () => {
  await mount(<SignInScreen />);
  await userEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
  expect(
    await screen.findByText('Ingresa un correo válido.'),
  ).toBeOnTheScreen();
  expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
});
test('signup without session shows confirmation pending and does not query/create Profile', async () => {
  jest.mocked(supabase.auth.signUp).mockResolvedValue({
    data: { user: session(a).user, session: null },
    error: null,
  });
  await mount(<SignUpScreen />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Correo'), 'ana@example.test');
  await user.type(screen.getByLabelText('Contraseña'), ' password ');
  await user.type(screen.getByLabelText('Confirmar contraseña'), ' password ');
  await user.press(screen.getByRole('button', { name: 'Crear cuenta' }));
  expect(
    await screen.findByText(
      'Revisa tu correo para confirmar la cuenta y luego inicia sesión.',
    ),
  ).toBeOnTheScreen();
  expect(supabase.auth.signUp).toHaveBeenCalledWith({
    email: 'ana@example.test',
    password: ' password ',
  });
  expect(readProfile).not.toHaveBeenCalled();
  expect(createProfile).not.toHaveBeenCalled();
});
test('Profile validation/network error preserves input and allows retry', async () => {
  jest
    .mocked(supabase.auth.getSession)
    .mockResolvedValue({ data: { session: session(a) }, error: null });
  jest
    .mocked(createProfile)
    .mockRejectedValueOnce({ code: '23514' })
    .mockResolvedValueOnce(profileA);
  await mount(<ProfileSetupScreen />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Nombre'), 'Ana');
  await user.type(screen.getByLabelText('Moneda (UYU, USD, EUR...)'), 'UYU');
  await user.clear(screen.getByLabelText('Zona horaria'));
  await user.type(screen.getByLabelText('Zona horaria'), 'UTC');
  await user.press(screen.getByRole('button', { name: 'Guardar perfil' }));
  expect(
    await screen.findByText('Revisa el nombre, la moneda y la zona horaria.'),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('Nombre')).toHaveDisplayValue('Ana');
  await user.press(
    screen.getByRole('button', { name: 'Reintentar guardar perfil' }),
  );
  expect(queryClient.getQueryData(profileKey(a))).toEqual(profileA);
});

test('late Profile creation after identity change cannot refill User A cache', async () => {
  const pending = deferred<typeof profileA>();
  jest
    .mocked(supabase.auth.getSession)
    .mockResolvedValue({ data: { session: session(a) }, error: null });
  jest
    .mocked(readProfile)
    .mockResolvedValueOnce(null)
    .mockResolvedValue(profileB);
  jest.mocked(createProfile).mockReturnValue(pending.promise);
  await mount(
    <>
      <ProfileSetupScreen />
      <Probe
        action={() => {
          emit('SIGNED_IN', session(b));
          pending.resolve(profileA);
        }}
      />
    </>,
  );
  await screen.findByText('route:profile-setup');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Nombre'), 'Ana');
  await user.type(screen.getByLabelText('Moneda (UYU, USD, EUR...)'), 'UYU');
  await user.clear(screen.getByLabelText('Zona horaria'));
  await user.type(screen.getByLabelText('Zona horaria'), 'UTC');
  await user.press(screen.getByRole('button', { name: 'Guardar perfil' }));
  expect(createProfile).toHaveBeenCalledWith(a, {
    display_name: 'Ana',
    base_currency: 'UYU',
    timezone: 'UTC',
  });
  await user.press(screen.getByRole('button', { name: 'External event' }));
  expect(await screen.findByText('Bruno')).toBeOnTheScreen();
  expect(queryClient.getQueryData(profileKey(a))).toBeUndefined();
});

test('failed remote revocation still logs out when local cleanup is confirmed', async () => {
  jest.mocked(supabase.auth.signOut).mockRejectedValue(new Error('network'));
  await mount();
  await screen.findByText('route:(auth)');
  await userEvent.press(screen.getByRole('button', { name: 'Logout' }));
  expect(
    await screen.findByText(
      'La sesión se cerró en este dispositivo, pero no se pudo confirmar la revocación remota.',
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText('route:(auth)')).toBeOnTheScreen();
});

test('sign-in works after logout recovered from an initialization error', async () => {
  jest
    .mocked(supabase.auth.getSession)
    .mockRejectedValueOnce(new Error('storage'));
  jest.mocked(readProfile).mockResolvedValue(profileB);
  await mount(
    <Probe
      action={() => {
        emit('SIGNED_IN', session(b));
      }}
    />,
  );
  await screen.findByText('INITIALIZATION_ERROR');
  await userEvent.press(screen.getByRole('button', { name: 'Logout' }));
  await screen.findByText('route:(auth)');
  await userEvent.press(screen.getByRole('button', { name: 'External event' }));
  expect(await screen.findByText('Bruno')).toBeOnTheScreen();
});

test('foreground resumes refresh without adding an AppState listener', async () => {
  AppState.currentState = 'background';
  await mount(
    <Probe
      action={() => {
        AppState.currentState = 'active';
        changeAppState('active');
      }}
    />,
  );
  await screen.findByText('route:(auth)');
  expect(supabase.auth.startAutoRefresh).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button', { name: 'External event' }));
  expect(supabase.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
});
