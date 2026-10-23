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
import type { Profile } from '../../auth/auth-data';
import { readInvitations } from '../invitation-data';
import { HouseholdScreen } from '../HouseholdScreen';
import {
  createFirstHousehold,
  householdKey,
  mapHouseholdSnapshot,
  pendingHouseholdKey,
  readHouseholdMemberships,
  type HouseholdSnapshot,
} from '../household-data';

jest.mock('../HouseholdDefaultSplit', () => ({
  HouseholdDefaultSplit: () => null,
}));
jest.mock('../invitation-data', () => ({
  ...jest.requireActual('../invitation-data'),
  readInvitations: jest.fn(),
}));
jest.mock('../household-data', () => ({
  ...jest.requireActual('../household-data'),
  readHouseholdMemberships: jest.fn(),
  createFirstHousehold: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

const id = (value: number) =>
  `f2020000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const requestId = id(50);
const profile: Profile = {
  id: id(1),
  display_name: 'Ana',
  base_currency: 'UYU',
  timezone: 'America/Montevideo',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
};
const otherProfile = { ...profile, id: id(2), display_name: 'Beatriz' };
const Focus = createContext(true);
const initialAppState = AppState.currentState;
let state: AuthState;
let appStateListener: (state: AppStateStatus) => void;

function eligible(owner = profile.id) {
  return mapHouseholdSnapshot(owner, {
    profile_id: owner,
    creation_status: 'ELIGIBLE',
    households: [],
  });
}
function previousMembership() {
  return mapHouseholdSnapshot(profile.id, {
    profile_id: profile.id,
    creation_status: 'PREVIOUS_MEMBERSHIP',
    households: [],
  });
}
function activeHouseholds({
  owner = profile,
  householdId = id(20),
  name = 'Casa compartida',
  currency = 'UYU',
} = {}) {
  return mapHouseholdSnapshot(owner.id, {
    profile_id: owner.id,
    creation_status: 'ACTIVE_MEMBERSHIP',
    households: [
      {
        id: householdId,
        name,
        default_currency: currency,
        members: [
          {
            id: id(30),
            profile_id: owner.id,
            display_name: owner.display_name,
            role: 'OWNER',
          },
        ],
      },
    ],
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}
async function open(client = createClient()) {
  const tree = (focused = true) => (
    <QueryClientProvider client={client}>
      <Focus.Provider value={focused}>
        <HouseholdScreen />
      </Focus.Provider>
    </QueryClientProvider>
  );
  const view = await render(tree());
  return { client, tree, ...view };
}
async function edit(name = 'Casa nueva') {
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: 'Crear hogar' }));
  await user.type(screen.getByLabelText('Nombre del hogar'), name);
}
async function confirm(name = 'Casa nueva') {
  await edit(name);
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar creación' }));
}
function expectNoSharedIdentity() {
  expect(screen.queryByText('Casa compartida')).not.toBeOnTheScreen();
  expect(screen.queryByText('Ana (Tú): Propietario')).not.toBeOnTheScreen();
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(readInvitations).mockImplementation(async (profileId) => ({
    profile_id: profileId,
    recipient_code: id(99),
    incoming: [],
    outgoing: [],
  }));
  jest.useFakeTimers();
  AppState.currentState = 'active';
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
    .mockImplementation((_event, callback) => {
      appStateListener = callback;
      return { remove: jest.fn() };
    });
  jest.mocked(randomUUID).mockReturnValue(requestId);
  jest.mocked(readHouseholdMemberships).mockResolvedValue(eligible());
  jest
    .mocked(createFirstHousehold)
    .mockResolvedValue({ household_id: requestId });
});
afterEach(() => {
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test.each<AuthState>([
  { status: 'INITIALIZING' },
  { status: 'UNAUTHENTICATED' },
  { status: 'SIGNING_OUT' },
  { status: 'AUTHENTICATED_PROFILE_LOADING', userId: profile.id },
  { status: 'AUTHENTICATED_PROFILE_MISSING', userId: profile.id },
  { status: 'AUTHENTICATED_PROFILE_ERROR', userId: profile.id },
])(
  'does not read, show cached identities, or offer creation when auth is $status',
  async (authState) => {
    state = authState;
    const client = createClient();
    client.setQueryData(householdKey(profile.id), activeHouseholds());
    await open(client);
    expect(readHouseholdMemberships).not.toHaveBeenCalled();
    expect(createFirstHousehold).not.toHaveBeenCalled();
    expectNoSharedIdentity();
    expect(
      screen.queryByRole('button', { name: 'Crear hogar' }),
    ).not.toBeOnTheScreen();
  },
);

test('waits for a fresh access read before showing any cached household identity', async () => {
  const read = deferred<HouseholdSnapshot>();
  jest.mocked(readHouseholdMemberships).mockReturnValueOnce(read.promise);
  const client = createClient();
  client.setQueryData(householdKey(profile.id), activeHouseholds());
  await open(client);
  expect(screen.getByRole('progressbar')).toHaveTextContent(
    /Comprobando acceso al hogar/,
  );
  expectNoSharedIdentity();
  expect(readHouseholdMemberships).toHaveBeenCalledWith(
    profile.id,
    expect.any(AbortSignal),
  );
  await act(async () => read.resolve(activeHouseholds()));
  expect(await screen.findByText('Casa compartida')).toBeOnTheScreen();
  expect(screen.getByText('Ana (Tú): Propietario')).toBeOnTheScreen();
});

test('requires explicit name, currency, and privacy-aware confirmation before creating', async () => {
  const { client } = await open();
  expect(await screen.findByText('Aún no tienes un hogar.')).toBeOnTheScreen();
  expect(
    screen.getByText(
      /Tus ingresos, gastos, presupuesto y ahorro personales siguen privados/,
    ),
  ).toBeOnTheScreen();
  await edit('  Casa nueva  ');
  expect(createFirstHousehold).not.toHaveBeenCalled();
  expect(
    screen.getByText(
      /No se compartirán tus finanzas personales ni se invitará a nadie/,
    ),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('combobox', { name: 'Moneda' }),
  ).toHaveAccessibilityValue({ text: 'Peso uruguayo (UYU)' });
  const user = userEvent.setup();
  await user.press(screen.getByRole('combobox', { name: 'Moneda' }));
  await user.press(
    screen.getByRole('radio', { name: 'Dólar estadounidense (USD)' }),
  );
  expect(createFirstHousehold).not.toHaveBeenCalled();
  jest.mocked(readHouseholdMemberships).mockResolvedValue(
    activeHouseholds({
      householdId: requestId,
      name: 'Casa nueva',
      currency: 'USD',
    }),
  );
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await user.press(screen.getByRole('button', { name: 'Confirmar creación' }));
  expect(createFirstHousehold).toHaveBeenCalledTimes(1);
  expect(createFirstHousehold).toHaveBeenCalledWith({
    id: requestId,
    form: { name: 'Casa nueva', currency: 'USD' },
  });
  expect(await screen.findByText('Casa nueva')).toBeOnTheScreen();
  expect(screen.getByText('Moneda del hogar: USD')).toBeOnTheScreen();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Hogar creado. Tus finanzas personales siguen siendo privadas.',
  );
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: householdKey(profile.id),
  });
  expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Crear hogar' }),
  ).not.toBeOnTheScreen();
});

test('validates blank and overlong names locally without sending a write', async () => {
  await open();
  const user = userEvent.setup();
  await user.press(await screen.findByRole('button', { name: 'Crear hogar' }));
  await user.press(screen.getByRole('button', { name: 'Confirmar creación' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Ingresa un nombre para el hogar.',
  );
  await user.type(screen.getByLabelText('Nombre del hogar'), 'A'.repeat(101));
  await user.press(screen.getByRole('button', { name: 'Confirmar creación' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Usa hasta 100 caracteres.',
  );
  expect(createFirstHousehold).not.toHaveBeenCalled();
});

test('requires a supported explicit currency choice when the saved personal currency is not offered', async () => {
  state = {
    status: 'AUTHENTICATED_READY',
    userId: profile.id,
    profile: { ...profile, base_currency: 'GBP' },
  };
  await open();
  await edit();
  expect(
    screen.getByRole('combobox', { name: 'Moneda' }),
  ).toHaveAccessibilityValue({ text: 'Selecciona una moneda' });
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar creación' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Selecciona una moneda para el hogar.',
  );
  expect(createFirstHousehold).not.toHaveBeenCalled();
});

test('renders all authorized households and more than two members without assuming one owner', async () => {
  const data = activeHouseholds();
  data.households[0].members.push(
    { id: id(31), profile_id: id(2), display_name: 'Beatriz', role: 'OWNER' },
    { id: id(32), profile_id: id(3), display_name: 'Camilo', role: 'MEMBER' },
  );
  data.households.push({
    id: id(21),
    name: 'Casa de verano',
    default_currency: 'EUR',
    members: [
      {
        id: id(33),
        profile_id: profile.id,
        display_name: 'Ana',
        role: 'MEMBER',
      },
    ],
  });
  jest
    .mocked(readHouseholdMemberships)
    .mockResolvedValue(mapHouseholdSnapshot(profile.id, data));
  await open();
  expect(await screen.findByText('Casa compartida')).toBeOnTheScreen();
  expect(screen.getByText('Casa de verano')).toBeOnTheScreen();
  expect(screen.getByText('Moneda del hogar: EUR')).toBeOnTheScreen();
  for (const name of [
    'Ana (Tú): Propietario',
    'Beatriz: Propietario',
    'Camilo: Miembro',
    'Ana (Tú): Miembro',
  ]) {
    expect(screen.getByText(name)).toBeOnTheScreen();
  }
  expect(
    screen.queryByRole('button', { name: 'Crear hogar' }),
  ).not.toBeOnTheScreen();
  expect(
    await screen.findByText(
      /Salir, quitar miembros, cambiar roles y transferir la propiedad aún no están disponibles/,
    ),
  ).toBeOnTheScreen();
});

test('prior inactive membership explains the unsupported flow without revealing historical household data', async () => {
  const client = createClient();
  client.setQueryData(householdKey(profile.id), activeHouseholds());
  jest.mocked(readHouseholdMemberships).mockResolvedValue(previousMembership());
  await open(client);
  expect(await screen.findByRole('status')).toHaveTextContent(
    /Tienes una membresía anterior, pero ninguna activa\./,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    /todavía no permite volver al mismo hogar ni crear otro/,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    /Tus finanzas personales siguen disponibles/,
  );
  expectNoSharedIdentity();
  expect(
    screen.queryByRole('button', {
      name: /Crear hogar|Eliminar|Volver a un hogar/,
    }),
  ).not.toBeOnTheScreen();
  expect(createFirstHousehold).not.toHaveBeenCalled();
});

test('canceling an unsent form discards it without creating or retaining a request', async () => {
  const { client } = await open();
  await edit('Borrador privado');
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(
    await screen.findByRole('button', { name: 'Crear hogar' }),
  ).toBeOnTheScreen();
  expect(createFirstHousehold).not.toHaveBeenCalled();
  expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Crear hogar' }));
  expect(screen.getByLabelText('Nombre del hogar')).toHaveDisplayValue('');
});

test.each(['blur', 'background'] as const)(
  '%s dismisses an unsent editor and requires a new access read',
  async (event) => {
    const { client, tree, rerender } = await open();
    await edit('Borrador privado');
    const read = deferred<HouseholdSnapshot>();
    jest.mocked(readHouseholdMemberships).mockReturnValueOnce(read.promise);
    if (event === 'blur') await rerender(tree(false));
    else await act(async () => appStateListener('background'));
    expect(screen.queryByLabelText('Nombre del hogar')).not.toBeOnTheScreen();
    expect(
      screen.queryByDisplayValue('Borrador privado'),
    ).not.toBeOnTheScreen();
    if (event === 'blur') await rerender(tree());
    else await act(async () => appStateListener('active'));
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Crear hogar' }),
    ).not.toBeOnTheScreen();
    await act(async () => read.resolve(eligible()));
    await userEvent
      .setup()
      .press(await screen.findByRole('button', { name: 'Crear hogar' }));
    expect(screen.getByLabelText('Nombre del hogar')).toHaveDisplayValue('');
    expect(createFirstHousehold).not.toHaveBeenCalled();
    expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull();
  },
);

test.each(['blur', 'background', 'refresh'] as const)(
  '%s hides cached names while access is revalidated and raw errors never leak',
  async (event) => {
    jest.mocked(readHouseholdMemberships).mockResolvedValue(activeHouseholds());
    const { tree, rerender } = await open();
    await screen.findByText('Casa compartida');
    const read = deferred<HouseholdSnapshot>();
    jest.mocked(readHouseholdMemberships).mockReturnValueOnce(read.promise);
    if (event === 'blur') {
      await rerender(tree(false));
      expectNoSharedIdentity();
      await rerender(tree());
    } else if (event === 'background') {
      await act(async () => appStateListener('background'));
      expectNoSharedIdentity();
      await act(async () => appStateListener('active'));
    } else {
      await userEvent
        .setup()
        .press(screen.getByRole('button', { name: 'Actualizar hogar' }));
    }
    expect(screen.getByRole('progressbar')).toBeOnTheScreen();
    expectNoSharedIdentity();
    await act(async () =>
      read.reject(
        new Error(
          'secret@example.test income=99000 Casa compartida SQL detail',
        ),
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No se muestran datos guardados sin confirmar el acceso\./,
    );
    expectNoSharedIdentity();
    expect(
      screen.queryByText(/secret@example|income=99000|SQL detail/),
    ).not.toBeOnTheScreen();
    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Casa compartida')).toBeOnTheScreen();
  },
);

test('refresh after membership revocation removes the old household and every shared member name', async () => {
  jest
    .mocked(readHouseholdMemberships)
    .mockResolvedValueOnce(activeHouseholds())
    .mockResolvedValue(previousMembership());
  await open();
  await screen.findByText('Casa compartida');
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Actualizar hogar' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/ninguna activa/);
  expectNoSharedIdentity();
  expect(
    screen.queryByRole('button', { name: 'Crear hogar' }),
  ).not.toBeOnTheScreen();
});

test('an in-flight create cannot be sent again, including after a real screen remount', async () => {
  const create = deferred<{ household_id: string }>();
  jest.mocked(createFirstHousehold).mockReturnValueOnce(create.promise);
  const { tree, unmount } = await open();
  await edit();
  const button = screen.getByRole('button', { name: 'Confirmar creación' });
  const user = userEvent.setup();
  await user.press(button);
  await user.press(button);
  expect(createFirstHousehold).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByText(/Cerrar esta pantalla no cancela la solicitud/),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Comprobar creación pendiente' }),
  ).toBeDisabled();
  await unmount();
  await render(tree());
  const retry = await screen.findByRole('button', {
    name: 'Comprobar creación pendiente',
  });
  expect(retry).toBeDisabled();
  await userEvent.setup().press(retry);
  expect(createFirstHousehold).toHaveBeenCalledTimes(1);
  await act(async () => create.resolve({ household_id: requestId }));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Comprobar creación pendiente' }),
    ).not.toBeOnTheScreen(),
  );
});

test('uncertain create survives a real remount and retries the exact UUID and normalized payload', async () => {
  jest
    .mocked(createFirstHousehold)
    .mockRejectedValueOnce(new Error('Lost response secret@example.test'));
  const { client, tree, unmount } = await open();
  await confirm('  Casa nueva  ');
  expect(
    await screen.findByText(/Hay una creación sin confirmar/),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/secret@example/)).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Crear hogar' })).toBeDisabled();
  const request = jest.mocked(createFirstHousehold).mock.calls[0][0];
  expect(request).toEqual({
    id: requestId,
    form: { name: 'Casa nueva', currency: 'UYU' },
  });
  await unmount();
  await render(tree());
  await screen.findByText('Aún no tienes un hogar.');
  const retry = screen.getByRole('button', {
    name: 'Comprobar creación pendiente',
  });
  expect(retry).toBeEnabled();
  await userEvent.setup().press(retry);
  expect(createFirstHousehold).toHaveBeenCalledTimes(2);
  const retryRequest = jest.mocked(createFirstHousehold).mock.calls[1][0];
  expect(retryRequest.id).toBe(request.id);
  expect(retryRequest.form).toStrictEqual(request.form);
  expect(randomUUID).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull(),
  );
});

test('an authorized read resolves a lost create response without a second write', async () => {
  const { client } = await open();
  await edit();
  jest
    .mocked(createFirstHousehold)
    .mockRejectedValueOnce(new Error('Response lost'));
  jest
    .mocked(readHouseholdMemberships)
    .mockResolvedValue(
      activeHouseholds({ householdId: requestId, name: 'Casa nueva' }),
    );
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar creación' }));
  expect(await screen.findByText('Casa nueva')).toBeOnTheScreen();
  expect(
    screen.queryByText(/No se pudo confirmar la operación/),
  ).not.toBeOnTheScreen();
  expect(createFirstHousehold).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Comprobar creación pendiente' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Crear hogar' }),
  ).not.toBeOnTheScreen();
});

test.each(['different account', 'same-account relogin'] as const)(
  'auth cache clearing ignores a late create success after %s',
  async (transition) => {
    const create = deferred<{ household_id: string }>();
    jest.mocked(createFirstHousehold).mockReturnValueOnce(create.promise);
    const { client, tree, rerender } = await open();
    await confirm();
    expect(client.getQueryData(pendingHouseholdKey(profile.id))).toEqual({
      id: requestId,
      form: { name: 'Casa nueva', currency: 'UYU' },
      inFlight: true,
    });
    state = { status: 'UNAUTHENTICATED' };
    await rerender(tree());
    await act(async () => {
      await client.cancelQueries();
      client.clear();
    });
    const nextProfile =
      transition === 'different account' ? otherProfile : profile;
    state = {
      status: 'AUTHENTICATED_READY',
      userId: nextProfile.id,
      profile: nextProfile,
    };
    jest
      .mocked(readHouseholdMemberships)
      .mockResolvedValue(eligible(nextProfile.id));
    await rerender(tree());
    await screen.findByRole('button', { name: 'Crear hogar' });
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const readCount = jest.mocked(readHouseholdMemberships).mock.calls.length;
    await act(async () => create.resolve({ household_id: requestId }));
    expect(invalidate).not.toHaveBeenCalled();
    expect(readHouseholdMemberships).toHaveBeenCalledTimes(readCount);
    expect(
      screen.queryByText(/Hogar creado|Casa nueva|Creación en curso/),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Comprobar creación pendiente' }),
    ).not.toBeOnTheScreen();
    expect(client.getQueryData(pendingHouseholdKey(nextProfile.id))).toBeNull();
    if (transition === 'different account') {
      expect(
        client.getQueryData(pendingHouseholdKey(profile.id)),
      ).toBeUndefined();
      expect(client.getQueryData(householdKey(profile.id))).toBeUndefined();
    }
  },
);

test('a late failed create cannot recreate cleared pending data after same-account relogin', async () => {
  const create = deferred<{ household_id: string }>();
  jest.mocked(createFirstHousehold).mockReturnValueOnce(create.promise);
  const { client, tree, rerender } = await open();
  await confirm();
  state = { status: 'UNAUTHENTICATED' };
  await rerender(tree());
  await act(async () => {
    await client.cancelQueries();
    client.clear();
  });
  state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
  await rerender(tree());
  await screen.findByRole('button', { name: 'Crear hogar' });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(async () => create.reject(new Error('Late response')));
  expect(invalidate).not.toHaveBeenCalled();
  expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull();
  expect(
    screen.queryByText(
      /Hay una creación sin confirmar|No se pudo confirmar la operación/,
    ),
  ).not.toBeOnTheScreen();
});

test('revoked exact replay clears pending intent and displays no cached household or raw rejection', async () => {
  jest
    .mocked(createFirstHousehold)
    .mockRejectedValueOnce(new Error('Response lost'));
  const { client } = await open();
  await confirm();
  await screen.findByText(/Hay una creación sin confirmar/);
  await screen.findByText('Aún no tienes un hogar.');
  jest.mocked(createFirstHousehold).mockRejectedValueOnce({
    code: '42501',
    message: 'revoked Casa compartida secret@example.test',
  });
  jest.mocked(readHouseholdMemberships).mockResolvedValue(previousMembership());
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Comprobar creación pendiente' }),
    );
  expect(
    await screen.findByText(/Tienes una membresía anterior/),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      'No pudimos confirmar tu acceso al hogar. Actualiza o vuelve a iniciar sesión.',
    ),
  ).toBeOnTheScreen();
  expectNoSharedIdentity();
  expect(screen.queryByText(/secret@example|revoked/)).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Comprobar creación pendiente' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Crear hogar' }),
  ).not.toBeOnTheScreen();
  expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull();
  expect(createFirstHousehold).toHaveBeenCalledTimes(2);
});

test('refreshes the current mounted screen after an earlier instance creates successfully', async () => {
  const create = deferred<{ household_id: string }>();
  jest.mocked(createFirstHousehold).mockReturnValueOnce(create.promise);
  const { client, tree, unmount } = await open();
  await confirm();
  await unmount();
  await render(tree());
  await screen.findByText('Aún no tienes un hogar.');
  const readsBeforeCompletion = jest.mocked(readHouseholdMemberships).mock.calls
    .length;
  jest
    .mocked(readHouseholdMemberships)
    .mockResolvedValue(
      activeHouseholds({ householdId: requestId, name: 'Casa nueva' }),
    );
  await act(async () => create.resolve({ household_id: requestId }));
  await waitFor(() =>
    expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull(),
  );
  expect(await screen.findByText('Casa nueva')).toBeOnTheScreen();
  expect(readHouseholdMemberships).toHaveBeenCalledTimes(
    readsBeforeCompletion + 1,
  );
  expect(
    screen.queryByRole('button', { name: 'Crear hogar' }),
  ).not.toBeOnTheScreen();
});

test('reconciles a late lost-response create when the current mounted screen reads its household', async () => {
  const create = deferred<{ household_id: string }>();
  jest.mocked(createFirstHousehold).mockReturnValueOnce(create.promise);
  const { client, tree, unmount } = await open();
  await confirm();
  await unmount();
  await render(tree());
  await screen.findByText('Aún no tienes un hogar.');
  jest
    .mocked(readHouseholdMemberships)
    .mockResolvedValue(
      activeHouseholds({ householdId: requestId, name: 'Casa nueva' }),
    );
  await act(async () => create.reject(new Error('Response lost after commit')));
  expect(await screen.findByText('Casa nueva')).toBeOnTheScreen();
  expect(createFirstHousehold).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(client.getQueryData(pendingHouseholdKey(profile.id))).toBeNull(),
  );
  expect(
    screen.queryByText(/Hay una creación sin confirmar/),
  ).not.toBeOnTheScreen();
});
