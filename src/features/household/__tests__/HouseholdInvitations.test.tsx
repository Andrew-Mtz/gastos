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
import { HouseholdScreen } from '../HouseholdScreen';
import {
  mapHouseholdSnapshot,
  readHouseholdMemberships,
} from '../household-data';
import {
  readInvitations,
  submitInvitation,
  invitationsKey,
  pendingInvitationKey,
  type InvitationContext,
} from '../invitation-data';
jest.mock('../household-data', () => ({
  ...jest.requireActual('../household-data'),
  readHouseholdMemberships: jest.fn(),
}));
jest.mock('../invitation-data', () => ({
  ...jest.requireActual('../invitation-data'),
  readInvitations: jest.fn(),
  submitInvitation: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const id = (n: number) =>
  `f2030000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile: Profile = {
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
let appStateListener: (state: AppStateStatus) => void;
let server: InvitationContext;
function memberships(role = 'OWNER') {
  return mapHouseholdSnapshot(profile.id, {
    profile_id: profile.id,
    creation_status: 'ACTIVE_MEMBERSHIP',
    households: [
      {
        id: id(20),
        name: 'Casa propia',
        default_currency: 'USD',
        members: [
          { id: id(40), profile_id: profile.id, display_name: 'Ana', role },
        ],
      },
    ],
  });
}
function context(): InvitationContext {
  return {
    profile_id: profile.id,
    recipient_code: id(10),
    incoming: [
      {
        id: id(30),
        household_id: id(21),
        household_name: 'Casa invitada',
        status: 'PENDING',
        expires_at: '2026-10-28T02:00:00Z',
      },
    ],
    outgoing: [
      {
        id: id(31),
        household_id: id(20),
        household_name: 'Casa propia',
        status: 'PENDING',
        expires_at: '2026-10-28T02:00:00Z',
        recipient_code: id(11),
      },
    ],
  };
}
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
  return { ...view, tree, client: cache };
}
async function editor() {
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Invitar a Casa propia' }),
  );
  return user;
}
async function send(code = id(12)) {
  const user = await editor();
  await user.type(screen.getByLabelText('Código de la persona invitada'), code);
  await user.press(screen.getByRole('button', { name: 'Enviar invitación' }));
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  AppState.currentState = 'active';
  state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
  server = context();
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
    .mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    });
  jest.mocked(randomUUID).mockReturnValue(id(50));
  jest.mocked(readHouseholdMemberships).mockResolvedValue(memberships());
  jest.mocked(readInvitations).mockImplementation(async () => server);
  jest
    .mocked(submitInvitation)
    .mockImplementation(async (request) =>
      request.action === 'ACCEPT'
        ? { invitation_id: request.id, household_id: id(21) }
        : { invitation_id: request.id },
    );
});
afterEach(() => {
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test('shows only own selectable code and minimal invitation facts, with explicit non-bearer explanation', async () => {
  await open();
  expect(await screen.findByText(id(10))).toHaveProp('selectable', true);
  expect(screen.getByText(/Solo identifica tu cuenta/)).toBeOnTheScreen();
  expect(screen.getByText('Casa invitada: Pendiente')).toBeOnTheScreen();
  expect(screen.getByText(`Código destinatario: ${id(11)}`)).toBeOnTheScreen();
  expect(submitInvitation).not.toHaveBeenCalled();
});
test('MEMBER receives inbox and own code but cannot open owner invitation editor', async () => {
  jest
    .mocked(readHouseholdMemberships)
    .mockResolvedValue(memberships('MEMBER'));
  server.outgoing = [];
  await open();
  await screen.findByText(id(10));
  expect(
    screen.queryByRole('button', { name: 'Invitar a Casa propia' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Aceptar Casa invitada' }),
  ).toBeOnTheScreen();
});
test('create requires a copied valid code and sends stable UUID once', async () => {
  await open();
  const user = await editor();
  await user.type(
    screen.getByLabelText('Código de la persona invitada'),
    'user@example.com',
  );
  await user.press(screen.getByRole('button', { name: 'Enviar invitación' }));
  expect(submitInvitation).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText('Código de la persona invitada'));
  await user.type(
    screen.getByLabelText('Código de la persona invitada'),
    ` ${id(12).toUpperCase()} `,
  );
  const pending = deferred<{ invitation_id: string }>();
  jest.mocked(submitInvitation).mockReturnValue(pending.promise);
  await user.press(screen.getByRole('button', { name: 'Enviar invitación' }));
  expect(submitInvitation).toHaveBeenCalledWith({
    action: 'CREATE',
    id: id(50),
    householdId: id(20),
    recipientCode: id(12),
  });
  expect(
    screen.getByRole('button', { name: 'Comprobar invitación pendiente' }),
  ).toBeDisabled();
  await act(async () => pending.resolve({ invitation_id: id(50) }));
});
test('closing unsent editor or acceptance confirmation performs no mutation', async () => {
  await open();
  const user = await editor();
  await user.press(
    screen.getByRole('button', { name: 'Cerrar invitación sin enviar' }),
  );
  await user.press(
    screen.getByRole('button', { name: 'Aceptar Casa invitada' }),
  );
  await user.press(screen.getByRole('button', { name: 'Volver sin cambios' }));
  expect(submitInvitation).not.toHaveBeenCalled();
});
test('acceptance requires deliberate privacy-aware confirmation and refreshes memberships', async () => {
  await open();
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Aceptar Casa invitada' }),
  );
  expect(
    screen.getByText(/Al unirte compartirás tu nombre visible y rol/),
  ).toBeOnTheScreen();
  expect(submitInvitation).not.toHaveBeenCalled();
  const reads = jest.mocked(readHouseholdMemberships).mock.calls.length;
  await user.press(
    screen.getByRole('button', { name: 'Confirmar ingreso al hogar' }),
  );
  expect(submitInvitation).toHaveBeenCalledWith({
    action: 'ACCEPT',
    id: id(30),
  });
  await waitFor(() =>
    expect(
      jest.mocked(readHouseholdMemberships).mock.calls.length,
    ).toBeGreaterThan(reads),
  );
});
test('cancellation requires confirmation and never removes an accepted member', async () => {
  await open();
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', {
      name: `Cancelar invitación ${id(31).slice(-8)}`,
    }),
  );
  expect(screen.getByText(/no elimina miembros/)).toBeOnTheScreen();
  expect(submitInvitation).not.toHaveBeenCalled();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar cancelación de invitación' }),
  );
  expect(submitInvitation).toHaveBeenCalledWith({
    action: 'REVOKE',
    id: id(31),
  });
});
test('lost response retains exact request across remount and retry strips inFlight metadata', async () => {
  jest.mocked(submitInvitation).mockRejectedValueOnce(new Error('offline'));
  const view = await open();
  await send();
  await screen.findByText(/Hay una solicitud sin confirmar/);
  await view.unmount();
  await open(view.client);
  await screen.findByText(id(10));
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', {
      name: 'Comprobar invitación pendiente',
    }),
  );
  expect(jest.mocked(submitInvitation).mock.calls[1][0]).toEqual(
    jest.mocked(submitInvitation).mock.calls[0][0],
  );
  expect(jest.mocked(submitInvitation).mock.calls[1][0]).not.toHaveProperty(
    'inFlight',
  );
  await waitFor(() =>
    expect(
      view.client.getQueryData(pendingInvitationKey(profile.id)),
    ).toBeNull(),
  );
});
test('read recovery reconciles a lost create without resending', async () => {
  jest.mocked(submitInvitation).mockImplementationOnce(async (request) => {
    server = {
      ...server,
      outgoing: [
        ...server.outgoing,
        { ...server.outgoing[0], id: request.id, recipient_code: id(12) },
      ],
    };
    throw new Error('lost committed response');
  });
  const view = await open();
  await send();
  await waitFor(() =>
    expect(
      view.client.getQueryData(pendingInvitationKey(profile.id)),
    ).toBeNull(),
  );
  expect(submitInvitation).toHaveBeenCalledTimes(1);
});
test('definite rejection clears pending identity and never displays raw infrastructure text', async () => {
  jest
    .mocked(submitInvitation)
    .mockRejectedValue({ code: '22023', message: 'secret recipient lookup' });
  const view = await open();
  await send();
  await waitFor(() =>
    expect(
      view.client.getQueryData(pendingInvitationKey(profile.id)),
    ).toBeNull(),
  );
  expect(screen.queryByText(/secret recipient lookup/)).not.toBeOnTheScreen();
});
test.each(['blur', 'background'] as const)(
  '%s hides codes, inbox and unsent editor until fresh read',
  async (mode) => {
    const view = await open();
    const user = await editor();
    await user.type(
      screen.getByLabelText('Código de la persona invitada'),
      id(12),
    );
    if (mode === 'blur') await view.rerender(view.tree(false));
    else await act(async () => appStateListener('background'));
    expect(screen.queryByText(id(10))).not.toBeOnTheScreen();
    expect(
      screen.queryByText('Casa invitada: Pendiente'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Código de la persona invitada'),
    ).not.toBeOnTheScreen();
    const waiting = deferred<InvitationContext>();
    jest.mocked(readInvitations).mockReturnValue(waiting.promise);
    if (mode === 'blur') await view.rerender(view.tree(true));
    else await act(async () => appStateListener('active'));
    await screen.findByText('Comprobando invitaciones…');
    expect(screen.queryByText(id(10))).not.toBeOnTheScreen();
    await act(async () => waiting.resolve(server));
    expect(await screen.findByText(id(10))).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Código de la persona invitada'),
    ).not.toBeOnTheScreen();
    expect(submitInvitation).not.toHaveBeenCalled();
  },
);
test('failed refresh hides all previously cached invitation metadata', async () => {
  await open();
  await screen.findByText(id(10));
  jest.mocked(readInvitations).mockRejectedValue(new Error('raw private'));
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Actualizar invitaciones' }));
  await screen.findByText(/No pudimos comprobar las invitaciones/);
  expect(screen.queryByText(id(10))).not.toBeOnTheScreen();
  expect(screen.queryByText('Casa invitada: Pendiente')).not.toBeOnTheScreen();
  expect(screen.queryByText(/raw private/)).not.toBeOnTheScreen();
});
test.each([false, true])(
  'late mutation cannot recreate cleared cache after logout or same-account login: %s',
  async (sameAccount) => {
    const pending = deferred<{ invitation_id: string }>();
    jest.mocked(submitInvitation).mockReturnValueOnce(pending.promise);
    const view = await open();
    await send();
    state = { status: 'UNAUTHENTICATED' };
    view.client.clear();
    await view.rerender(view.tree());
    if (sameAccount) {
      state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
      await view.rerender(view.tree());
      await screen.findByText(id(10));
    }
    await act(async () => pending.resolve({ invitation_id: id(50) }));
    expect(view.client.getQueryData(pendingInvitationKey(profile.id))).toBe(
      sameAccount ? null : undefined,
    );
    if (!sameAccount)
      expect(
        view.client.getQueryData(invitationsKey(profile.id)),
      ).toBeUndefined();
  },
);

test.each(['ELIGIBLE', 'PREVIOUS_MEMBERSHIP'] as const)(
  'joining another household is independent of first-creation eligibility: %s',
  async (creation_status) => {
    jest.mocked(readHouseholdMemberships).mockResolvedValue(
      mapHouseholdSnapshot(profile.id, {
        profile_id: profile.id,
        creation_status,
        households: [],
      }),
    );
    server.outgoing = [];
    await open();
    expect(
      await screen.findByRole('button', { name: 'Aceptar Casa invitada' }),
    ).toBeEnabled();
    if (creation_status === 'PREVIOUS_MEMBERSHIP') {
      expect(
        screen.queryByRole('button', { name: 'Crear hogar' }),
      ).not.toBeOnTheScreen();
    }
  },
);

test.each(['ACCEPTED', 'REVOKED', 'EXPIRED', 'UNAVAILABLE'] as const)(
  'terminal or unavailable inbox %s offers no acceptance action',
  async (status) => {
    server.incoming[0].status = status;
    await open();
    await screen.findByText(id(10));
    expect(
      screen.queryByRole('button', { name: 'Aceptar Casa invitada' }),
    ).not.toBeOnTheScreen();
  },
);

test('lost acceptance response reconciles the recorded result across membership invalidation', async () => {
  jest.mocked(submitInvitation).mockImplementationOnce(async () => {
    server = {
      ...server,
      incoming: [{ ...server.incoming[0], status: 'ACCEPTED' }],
    };
    throw new Error('response lost after commit');
  });
  const view = await open();
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Aceptar Casa invitada' }),
  );
  await user.press(
    screen.getByRole('button', { name: 'Confirmar ingreso al hogar' }),
  );
  await waitFor(() =>
    expect(
      view.client.getQueryData(pendingInvitationKey(profile.id)),
    ).toBeNull(),
  );
  expect(await screen.findByText('Casa invitada: Aceptada')).toBeOnTheScreen();
  expect(submitInvitation).toHaveBeenCalledTimes(1);
});

test('late mutation from A cannot affect the newly signed-in B invitation cache', async () => {
  const pending = deferred<{ invitation_id: string }>();
  jest.mocked(submitInvitation).mockReturnValueOnce(pending.promise);
  const view = await open();
  await send();
  state = { status: 'UNAUTHENTICATED' };
  view.client.clear();
  await view.rerender(view.tree());
  const otherProfile = { ...profile, id: id(2), display_name: 'Beatriz' };
  state = {
    status: 'AUTHENTICATED_READY',
    userId: otherProfile.id,
    profile: otherProfile,
  };
  jest.mocked(readHouseholdMemberships).mockResolvedValue(
    mapHouseholdSnapshot(otherProfile.id, {
      profile_id: otherProfile.id,
      creation_status: 'ELIGIBLE',
      households: [],
    }),
  );
  server = {
    profile_id: otherProfile.id,
    recipient_code: id(15),
    incoming: [],
    outgoing: [],
  };
  await view.rerender(view.tree());
  await screen.findByText(id(15));
  await act(async () => pending.resolve({ invitation_id: id(50) }));
  expect(
    view.client.getQueryData(pendingInvitationKey(profile.id)),
  ).toBeUndefined();
  expect(view.client.getQueryData(invitationsKey(profile.id))).toBeUndefined();
  expect(screen.queryByText(id(10))).not.toBeOnTheScreen();
  expect(screen.queryByText('Casa invitada: Pendiente')).not.toBeOnTheScreen();
  expect(screen.getByText(id(15))).toBeOnTheScreen();
});

test.each(['success', 'error'] as const)(
  'late CREATE %s cannot clear or overwrite a newer REVOKE for the same invitation',
  async (outcome) => {
    const creation = deferred<{ invitation_id: string }>();
    const revocation = deferred<{ invitation_id: string }>();
    jest
      .mocked(submitInvitation)
      .mockReturnValueOnce(creation.promise)
      .mockReturnValueOnce(revocation.promise);
    const view = await open();
    await send();
    server = {
      ...server,
      outgoing: [
        ...server.outgoing,
        { ...server.outgoing[0], id: id(50), recipient_code: id(12) },
      ],
    };
    const user = userEvent.setup();
    await user.press(
      screen.getByRole('button', { name: 'Actualizar invitaciones' }),
    );
    await waitFor(() =>
      expect(
        view.client.getQueryData(pendingInvitationKey(profile.id)),
      ).toBeNull(),
    );
    await user.press(
      await screen.findByRole('button', {
        name: `Cancelar invitación ${id(50).slice(-8)}`,
      }),
    );
    await user.press(
      screen.getByRole('button', {
        name: 'Confirmar cancelación de invitación',
      }),
    );
    const current = { action: 'REVOKE', id: id(50), inFlight: true };
    expect(view.client.getQueryData(pendingInvitationKey(profile.id))).toEqual(
      current,
    );
    const reads = jest.mocked(readInvitations).mock.calls.length;
    await act(async () => {
      if (outcome === 'success') creation.resolve({ invitation_id: id(50) });
      else
        creation.reject({
          code: '42501',
          message: 'Late prior-operation rejection',
        });
    });
    expect(view.client.getQueryData(pendingInvitationKey(profile.id))).toEqual(
      current,
    );
    expect(jest.mocked(readInvitations).mock.calls.length).toBe(reads);
    await act(async () =>
      revocation.reject(new Error('Uncertain cancellation')),
    );
    await waitFor(() =>
      expect(
        view.client.getQueryData(pendingInvitationKey(profile.id)),
      ).toEqual({ ...current, inFlight: false }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Comprobar invitación pendiente' }),
      ).toBeEnabled(),
    );
    await user.press(
      screen.getByRole('button', { name: 'Comprobar invitación pendiente' }),
    );
    expect(jest.mocked(submitInvitation).mock.calls[2][0]).toEqual({
      action: 'REVOKE',
      id: id(50),
    });
  },
);
