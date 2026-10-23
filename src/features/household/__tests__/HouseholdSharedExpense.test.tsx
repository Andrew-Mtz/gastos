import { createContext, useContext, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useAuth, type AuthState } from '../../auth/AuthProvider';
import { HouseholdScreen } from '../HouseholdScreen';
import { readHouseholdMemberships } from '../household-data';
import { readDefaultSplit, type SplitSnapshot } from '../split-data';
import {
  createSharedExpense,
  readSharedExpense,
  type SharedExpense,
  type SharedExpenseRequest,
} from '../shared-expense-data';
import {
  pendingSharedExpenseKey,
  sharedExpenseReceiptKey,
} from '../shared-expense-entry';
import { calculateSharedExpenseSplit } from '../../../domain/shared-expenses/shared-expense-split';
import { createMoney } from '../../../domain/money/money';
import { splitId as id, splitSnapshot } from './split-fixtures';
jest.mock('../shared-expense-data', () => ({
  ...jest.requireActual('../shared-expense-data'),
  createSharedExpense: jest.fn(),
  readSharedExpense: jest.fn(),
}));
jest.mock('../HouseholdDefaultSplit', () => ({
  HouseholdDefaultSplit: () => null,
}));
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
let currency: string;
let saved: SharedExpense | null;
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
function receiptFor(request: SharedExpenseRequest): SharedExpense {
  return {
    profile_id: id(1),
    expense_id: request.id,
    transaction_id: request.id,
    household_id: request.householdId,
    created_by: id(1),
    payer_member_id: request.payerMemberId,
    template_id: request.templateId,
    template_version: request.templateVersion,
    amount_minor: request.amountMinor,
    currency: request.currency,
    transaction_date: request.transactionDate,
    description: request.description,
    splits: calculateSharedExpenseSplit(
      createMoney(request.amountMinor, request.currency),
      server.template!.shares.map((share) => ({
        memberId: share.member_id,
        basisPoints: share.basis_points,
      })),
    ).map((share) => ({
      member_id: share.memberId,
      basis_points: share.basisPoints,
      responsibility_amount_minor: share.responsibilityAmount.amountMinor,
    })),
  };
}
async function review(payer = 'Beatriz', amount = '10.01') {
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Registrar gasto en Casa' }),
  );
  await user.type(
    screen.getByLabelText(`Importe del gasto (${currency})`),
    amount,
  );
  await user.press(screen.getByRole('radio', { name: `Pagó ${payer}` }));
  expect(screen.getByText(`Pagó ${payer} (seleccionado)`)).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: `Pagó ${payer}` })).toBeChecked();
  await user.press(screen.getByRole('button', { name: 'Revisar gasto' }));
  await screen.findByText('Confirmar gasto en Casa');
  return user;
}
async function confirm(user = userEvent.setup()) {
  await user.press(
    screen.getByRole('button', { name: 'Confirmar y registrar gasto' }),
  );
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  AppState.currentState = 'active';
  server = splitSnapshot('READY');
  currency = 'UYU';
  saved = null;
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
  jest.mocked(randomUUID).mockReturnValue(id(60));
  jest.mocked(readHouseholdMemberships).mockImplementation(async () => ({
    profile_id: server.profile_id,
    creation_status: 'ACTIVE_MEMBERSHIP',
    households: [
      {
        id: server.household_id,
        name: 'Casa',
        default_currency: currency,
        members: server.roster,
      },
    ],
  }));
  jest.mocked(readDefaultSplit).mockImplementation(async () => server);
  jest
    .mocked(createSharedExpense)
    .mockImplementation(async (_profile, request) => {
      saved = receiptFor(request);
      return saved;
    });
  jest.mocked(readSharedExpense).mockImplementation(async () => {
    if (!saved) throw { code: '42501' };
    return saved;
  });
});
afterEach(() => {
  AppState.currentState = initialAppState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});
test.each(['OWNER', 'MEMBER'])(
  '%s can record using fixed household currency and automatic responsibility',
  async (role) => {
    server = splitSnapshot('READY', role);
    await open();
    const user = await review();
    expect(screen.getByText(/Ana: 70.00% · UYU/)).toHaveTextContent(/7,01/);
    expect(screen.getByText(/Beatriz: 30.00% · UYU/)).toHaveTextContent(/3,00/);
    expect(screen.getByText('Pagó: Beatriz')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Porcentaje de Ana')).not.toBeOnTheScreen();
    expect(createSharedExpense).not.toHaveBeenCalled();
    const beforeConfirm = jest.mocked(readDefaultSplit).mock.calls.length;
    await confirm(user);
    await screen.findByText('Gasto registrado');
    expect(jest.mocked(readDefaultSplit).mock.calls.length).toBeGreaterThan(
      beforeConfirm,
    );
    expect(createSharedExpense).toHaveBeenCalledTimes(1);
    expect(createSharedExpense).toHaveBeenCalledWith(
      id(1),
      expect.objectContaining({
        currency: 'UYU',
        amountMinor: 1001,
        payerMemberId: id(41),
        templateId: id(50),
        templateVersion: 1,
      }),
    );
    expect(readSharedExpense).toHaveBeenCalledWith(
      id(1),
      id(20),
      id(60),
      expect.any(AbortSignal),
    );
    await user.press(
      screen.getByRole('button', { name: 'Cerrar comprobante' }),
    );
    await user.press(
      screen.getByRole('button', { name: 'Registrar gasto en Casa' }),
    );
    expect(screen.getByLabelText('Importe del gasto (UYU)')).toHaveDisplayValue(
      '',
    );
  },
);
test('payer selection does not alter the automatic percentages or amounts', async () => {
  await open();
  const user = await review('Ana');
  expect(screen.getByText(/Ana: 70.00% · UYU/)).toHaveTextContent(/7,01/);
  await user.press(screen.getByRole('button', { name: 'Volver al gasto' }));
  await user.press(screen.getByRole('radio', { name: 'Pagó Beatriz' }));
  await user.press(screen.getByRole('button', { name: 'Revisar gasto' }));
  await screen.findByText('Pagó: Beatriz');
  expect(screen.getByText(/Ana: 70.00% · UYU/)).toHaveTextContent(/7,01/);
});
test('form validates positive amount and explicit payer; cancel/back never persist', async () => {
  await open();
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Registrar gasto en Casa' }),
  );
  await user.type(screen.getByLabelText('Importe del gasto (UYU)'), '0');
  await user.press(screen.getByRole('button', { name: 'Revisar gasto' }));
  expect(screen.getByText(/Ingresa un importe positivo/)).toBeOnTheScreen();
  expect(screen.getByText('Selecciona quién pagó.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Cancelar gasto' }));
  await review();
  await user.press(screen.getByRole('button', { name: 'Volver al gasto' }));
  expect(screen.getByLabelText('Importe del gasto (UYU)')).toHaveDisplayValue(
    '10.01',
  );
  await user.press(screen.getByRole('button', { name: 'Cancelar gasto' }));
  expect(createSharedExpense).not.toHaveBeenCalled();
});
test.each(['UNCONFIGURED', 'STALE'] as const)(
  '%s blocks entry without inventing allocation',
  async (status) => {
    server = splitSnapshot(status);
    await open();
    await screen.findByText(/El propietario debe|el propietario debe/i);
    expect(
      screen.queryByRole('button', { name: 'Registrar gasto en Casa' }),
    ).not.toBeOnTheScreen();
    expect(createSharedExpense).not.toHaveBeenCalled();
  },
);
test('new template before final confirmation requires explicit review, never silently changes payload', async () => {
  const view = await open();
  const user = await review();
  server = {
    ...server,
    version: 2,
    template: { ...server.template!, id: id(51), version: 2 },
  };
  await confirm(user);
  await screen.findByText(/Cambió el reparto o la lista/);
  expect(createSharedExpense).not.toHaveBeenCalled();
  expect(
    view.client.getQueryData(pendingSharedExpenseKey(id(1), id(20))),
  ).toBeNull();
  expect(screen.queryByText('Confirmar gasto en Casa')).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Revisar gasto' }));
  await screen.findByText('Reparto automático, versión 2');
});
test('server template conflict is explicit, has no receipt and requires a new review', async () => {
  jest
    .mocked(createSharedExpense)
    .mockRejectedValueOnce({ code: '40001', message: 'secret server detail' });
  const view = await open();
  const user = await review();
  await confirm(user);
  await screen.findByText(/Cambió el reparto o la lista/);
  expect(
    view.client.getQueryData(pendingSharedExpenseKey(id(1), id(20))),
  ).toBeNull();
  expect(screen.queryByText('Gasto registrado')).not.toBeOnTheScreen();
  expect(screen.queryByText('secret server detail')).not.toBeOnTheScreen();
});
test('failed final preflight does not write or show stale preview', async () => {
  await open();
  const user = await review();
  jest.mocked(readDefaultSplit).mockRejectedValueOnce(new Error('offline'));
  await confirm(user);
  await screen.findByText(/No pudimos comprobar el acceso/);
  expect(createSharedExpense).not.toHaveBeenCalled();
  expect(screen.queryByText('Confirmar gasto en Casa')).not.toBeOnTheScreen();
});
test('create response alone is not confirmation; lost readback retains exact request for retry', async () => {
  jest.mocked(readSharedExpense).mockRejectedValueOnce(new Error('offline'));
  const view = await open();
  const user = await review();
  await confirm(user);
  await screen.findByText(/Resultado pendiente de confirmación/);
  expect(screen.queryByText('Gasto registrado')).not.toBeOnTheScreen();
  const original = jest.mocked(createSharedExpense).mock.calls[0][1];
  expect(
    view.client.getQueryData(pendingSharedExpenseKey(id(1), id(20))),
  ).toEqual({ request: original, inFlight: false });
  await user.press(
    screen.getByRole('button', { name: 'Comprobar gasto pendiente' }),
  );
  await screen.findByText('Gasto registrado');
  expect(jest.mocked(createSharedExpense).mock.calls[1][1]).toEqual(original);
});
test('lost create response reconciles by authoritative matching point read without resubmitting', async () => {
  jest
    .mocked(createSharedExpense)
    .mockImplementationOnce(async (_profile, request) => {
      saved = receiptFor(request);
      throw new Error('response lost');
    });
  await open();
  const user = await review();
  await confirm(user);
  await screen.findByText('Gasto registrado');
  expect(createSharedExpense).toHaveBeenCalledTimes(1);
});
test('mismatched readback never confirms or unlocks a new expense', async () => {
  jest.mocked(readSharedExpense).mockImplementationOnce(async () => ({
    ...saved!,
    description: 'different payload',
  }));
  await open();
  const user = await review();
  await confirm(user);
  await screen.findByText(/Resultado pendiente de confirmación/);
  expect(screen.queryByText('Gasto registrado')).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Registrar gasto en Casa' }),
  ).not.toBeOnTheScreen();
});
test('in-flight request survives remount, blocks rapid retries, and never adopts newer template', async () => {
  const held = deferred<SharedExpense>();
  jest.mocked(createSharedExpense).mockReturnValueOnce(held.promise);
  const view = await open();
  const user = await review();
  await confirm(user);
  await screen.findByText(/Registro en curso/);
  expect(
    screen.getByRole('button', { name: 'Comprobar gasto pendiente' }),
  ).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar gasto pendiente' }),
  );
  await view.unmount();
  server = {
    ...server,
    version: 2,
    template: { ...server.template!, id: id(51), version: 2 },
  };
  await open(view.client);
  await screen.findByText(/Registro en curso/);
  await act(async () => held.reject(new Error('transport')));
  await screen.findByText(/Resultado pendiente de confirmación/);
  await user.press(
    screen.getByRole('button', { name: 'Comprobar gasto pendiente' }),
  );
  await screen.findByText('Gasto registrado');
  expect(createSharedExpense).toHaveBeenCalledTimes(2);
  expect(jest.mocked(createSharedExpense).mock.calls[1][1]).toEqual(
    jest.mocked(createSharedExpense).mock.calls[0][1],
  );
  expect(screen.getByText(/Reparto guardado, versión 1/)).toBeOnTheScreen();
});
test('denied retry of an uncertain outcome retains original request rather than risking a duplicate', async () => {
  jest
    .mocked(createSharedExpense)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce({ code: '42501' });
  const view = await open();
  const user = await review();
  await confirm(user);
  await screen.findByText(/Resultado pendiente de confirmación/);
  const original = view.client.getQueryData(
    pendingSharedExpenseKey(id(1), id(20)),
  );
  await user.press(
    screen.getByRole('button', { name: 'Comprobar gasto pendiente' }),
  );
  await screen.findByText(/Resultado pendiente de confirmación/);
  expect(
    view.client.getQueryData(pendingSharedExpenseKey(id(1), id(20))),
  ).toEqual(original);
  expect(
    screen.queryByRole('button', { name: 'Registrar gasto en Casa' }),
  ).not.toBeOnTheScreen();
});
test.each(['blur', 'background'] as const)(
  '%s discards unsent review and revalidates before displaying household information',
  async (mode) => {
    const view = await open();
    await review();
    if (mode === 'blur') await view.rerender(view.tree(false));
    else await act(async () => listener('background'));
    expect(screen.queryByText('Confirmar gasto en Casa')).not.toBeOnTheScreen();
    const held = deferred<SplitSnapshot>();
    jest.mocked(readDefaultSplit).mockReturnValueOnce(held.promise);
    if (mode === 'blur') await view.rerender(view.tree());
    else await act(async () => listener('active'));
    await screen.findByText('Comprobando datos para el gasto…');
    expect(screen.queryByText(/Ana: 70/)).not.toBeOnTheScreen();
    await act(async () => held.resolve(server));
    await screen.findByRole('button', { name: 'Registrar gasto en Casa' });
    expect(createSharedExpense).not.toHaveBeenCalled();
  },
);
test('household refresh replaces fixed currency and discards unsent old-currency review', async () => {
  await open();
  const user = await review();
  currency = 'EUR';
  await user.press(screen.getByRole('button', { name: 'Actualizar hogar' }));
  await user.press(
    await screen.findByRole('button', { name: 'Registrar gasto en Casa' }),
  );
  expect(screen.getByLabelText('Importe del gasto (EUR)')).toHaveDisplayValue(
    '',
  );
  expect(screen.queryByText('Confirmar gasto en Casa')).not.toBeOnTheScreen();
});
test('confirmed receipt is hidden on remount until authoritative re-read, not flashed from cache', async () => {
  const view = await open();
  const user = await review();
  await confirm(user);
  await screen.findByText('Gasto registrado');
  await view.unmount();
  const held = deferred<SharedExpense>();
  jest.mocked(readSharedExpense).mockReturnValueOnce(held.promise);
  await open(view.client);
  await screen.findByText(/Comprobando el comprobante/);
  expect(screen.queryByText('Gasto registrado')).not.toBeOnTheScreen();
  await act(async () => held.resolve(saved!));
  await screen.findByText('Gasto registrado');
});
test.each(['success', 'failure'] as const)(
  'logout and same-account re-login ignore old mutation %s and cannot restore cache',
  async (outcome) => {
    const held = deferred<SharedExpense>();
    jest.mocked(createSharedExpense).mockReturnValueOnce(held.promise);
    const view = await open();
    const user = await review();
    await confirm(user);
    const request = jest.mocked(createSharedExpense).mock.calls[0][1];
    await act(async () => {
      state = { status: 'UNAUTHENTICATED' };
      view.client.clear();
    });
    await view.rerender(view.tree());
    state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
    await view.rerender(view.tree());
    await screen.findByRole('button', { name: 'Registrar gasto en Casa' });
    await act(async () =>
      outcome === 'success'
        ? held.resolve(receiptFor(request))
        : held.reject(new Error('late')),
    );
    expect(
      view.client.getQueryData(pendingSharedExpenseKey(id(1), id(20))),
    ).toBeNull();
    expect(
      view.client.getQueryData(sharedExpenseReceiptKey(id(1), id(20), id(60))),
    ).toBeUndefined();
    expect(screen.queryByText('Gasto registrado')).not.toBeOnTheScreen();
  },
);
test('switch to another household ignores late prior mutation and receipt', async () => {
  const held = deferred<SharedExpense>();
  jest.mocked(createSharedExpense).mockReturnValueOnce(held.promise);
  const view = await open();
  const user = await review();
  await confirm(user);
  const request = jest.mocked(createSharedExpense).mock.calls[0][1];
  const oldReceipt = receiptFor(request);
  server = { ...server, household_id: id(21) };
  await user.press(screen.getByRole('button', { name: 'Actualizar hogar' }));
  await screen.findByRole('button', { name: 'Registrar gasto en Casa' });
  await act(async () => held.resolve(oldReceipt));
  expect(screen.queryByText('Gasto registrado')).not.toBeOnTheScreen();
  expect(
    view.client.getQueryData(pendingSharedExpenseKey(id(1), id(21))),
  ).toBeNull();
});
test('rapid final confirmation cannot submit twice while preflight is pending', async () => {
  await open();
  await review();
  const held = deferred<SplitSnapshot>();
  jest.mocked(readDefaultSplit).mockReturnValueOnce(held.promise);
  const button = screen.getByRole('button', {
    name: 'Confirmar y registrar gasto',
  });
  // Low-level events deliberately model a queued second tap on the old control.
  await fireEvent.press(button);
  await fireEvent.press(button);
  expect(createSharedExpense).not.toHaveBeenCalled();
  await act(async () => held.resolve(server));
  await screen.findByText('Gasto registrado');
  expect(createSharedExpense).toHaveBeenCalledTimes(1);
});
test('receipt preserves historical shares after a later owner template change', async () => {
  await open();
  const user = await review();
  await confirm(user);
  await screen.findByText('Gasto registrado');
  server = {
    ...server,
    version: 2,
    template: {
      ...server.template!,
      id: id(51),
      version: 2,
      shares: [
        { member_id: id(40), basis_points: 10000 },
        { member_id: id(41), basis_points: 0 },
      ],
    },
  };
  await user.press(screen.getByRole('button', { name: 'Actualizar hogar' }));
  await screen.findByText('Gasto registrado');
  expect(screen.getByText(/Ana: 70.00% · UYU/)).toHaveTextContent(/7,01/);
  expect(screen.getByText(/Beatriz: 30.00% · UYU/)).toHaveTextContent(/3,00/);
  expect(createSharedExpense).toHaveBeenCalledTimes(1);
});
test('uncertain old-currency request survives household currency refresh without payload conversion', async () => {
  jest
    .mocked(createSharedExpense)
    .mockRejectedValueOnce(new Error('response lost'));
  await open();
  const user = await review();
  await confirm(user);
  await screen.findByText(/Resultado pendiente de confirmación/);
  const original = jest.mocked(createSharedExpense).mock.calls[0][1];
  currency = 'EUR';
  await user.press(screen.getByRole('button', { name: 'Actualizar hogar' }));
  await screen.findByText(/Resultado pendiente de confirmación/);
  await user.press(
    screen.getByRole('button', { name: 'Comprobar gasto pendiente' }),
  );
  await screen.findByText('Gasto registrado');
  expect(jest.mocked(createSharedExpense).mock.calls[1][1]).toEqual(original);
  expect(screen.getByText(/Total: UYU/)).toBeOnTheScreen();
});
test('late receipt cannot expose the old household after account switch', async () => {
  const held = deferred<SharedExpense>();
  jest.mocked(readSharedExpense).mockReturnValueOnce(held.promise);
  const view = await open();
  const user = await review();
  await confirm(user);
  await screen.findByText(/Comprobando el comprobante/);
  const oldReceipt = saved!;
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
      profile: { ...profile, id: id(3), display_name: 'Carla' },
    };
    view.client.clear();
  });
  await view.rerender(view.tree());
  await screen.findByText(/El propietario debe configurar/);
  await act(async () => held.resolve(oldReceipt));
  expect(screen.queryByText('Gasto registrado')).not.toBeOnTheScreen();
  expect(screen.queryByText(/Ana/)).not.toBeOnTheScreen();
  expect(
    view.client.getQueryData(sharedExpenseReceiptKey(id(1), id(20), id(60))),
  ).toBeUndefined();
});
test.each(['blur', 'background'] as const)(
  'held final preflight cannot write after %s, even when the response arrives later',
  async (mode) => {
    const view = await open();
    const user = await review();
    const held = deferred<SplitSnapshot>();
    jest.mocked(readDefaultSplit).mockReturnValueOnce(held.promise);
    await confirm(user);
    await screen.findByText('Comprobando datos para el gasto…');
    if (mode === 'blur') await view.rerender(view.tree(false));
    else await act(async () => listener('background'));
    await act(async () => held.resolve(server));
    expect(createSharedExpense).not.toHaveBeenCalled();
    expect(
      view.client.getQueryData(pendingSharedExpenseKey(id(1), id(20))),
    ).toBeNull();
    if (mode === 'blur') await view.rerender(view.tree());
    else await act(async () => listener('active'));
    await screen.findByRole('button', { name: 'Registrar gasto en Casa' });
    expect(screen.queryByText('Confirmar gasto en Casa')).not.toBeOnTheScreen();
  },
);
