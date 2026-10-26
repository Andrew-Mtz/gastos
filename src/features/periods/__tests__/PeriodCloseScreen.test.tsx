import { recurringOwnerKey } from '../../recurring/recurring-data';
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
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth, type AuthState } from '../../auth/AuthProvider';
import { PeriodCloseScreen } from '../PeriodCloseScreen';
import {
  readPeriodClose,
  closePeriod,
  reopenPeriod,
  pendingLifecycleKey,
  mapPeriodClose,
  periodCloseKey,
} from '../period-close-data';
import {
  closeContext,
  closedContext,
  closure,
  reopening,
  profile,
  period,
} from './fixtures';
import {
  readRemainder,
  readReversal,
  disposeRemainder,
  reverseCarry,
  mapRemainder,
  mapReversal,
} from '../remainder-data';
import {
  remainderContext,
  disposedContext,
  disposition,
  reversalContext,
  reversalResult,
} from './remainder-fixtures';
jest.mock('../../budget/SharedResponsibilities', () => ({
  ...jest.requireActual('../../budget/SharedResponsibilities'),
  SharedResponsibilities: () => null,
}));
jest.mock('../remainder-data', () => ({
  ...jest.requireActual('../remainder-data'),
  readRemainder: jest.fn(),
  readReversal: jest.fn(),
  disposeRemainder: jest.fn(),
  reverseCarry: jest.fn(),
}));
jest.mock('../period-close-data', () => ({
  ...jest.requireActual('../period-close-data'),
  readPeriodClose: jest.fn(),
  closePeriod: jest.fn(),
  reopenPeriod: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'f1230000-0000-4000-8000-000000000050',
}));
const Focus = createContext(true);
let state: AuthState;
let listener: (s: AppStateStatus) => void;
const mapped = () =>
  mapPeriodClose(profile.id, period.starts_on, closeContext());
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
  jest.mocked(useAuth).mockImplementation(
    () =>
      ({
        state,
        isCurrentUser: (owner: string) =>
          state.status === 'AUTHENTICATED_READY' && state.userId === owner,
      }) as ReturnType<typeof useAuth>,
  );
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ month: period.starts_on });
  jest.mocked(useFocusEffect).mockImplementation(function useFocus(cb) {
    const focused = useContext(Focus);
    useEffect(() => {
      if (focused) return cb();
    }, [cb, focused]);
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    listener = cb;
    return { remove: jest.fn() };
  });
  jest.mocked(readPeriodClose).mockResolvedValue(mapped());
  jest.mocked(closePeriod).mockResolvedValue(closure());
  jest
    .mocked(readRemainder)
    .mockResolvedValue(
      mapRemainder(profile.id, period.starts_on, remainderContext()),
    );
  jest
    .mocked(readReversal)
    .mockResolvedValue(
      mapReversal(profile.id, disposition().id, reversalContext()),
    );
  jest.mocked(disposeRemainder).mockResolvedValue({
    disposition: disposition(),
    closure: disposedContext().closure,
  });
  jest.mocked(reverseCarry).mockResolvedValue(reversalResult());
  jest.mocked(reopenPeriod).mockResolvedValue(reopening());
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const tree = (focused = true) => (
    <QueryClientProvider client={client}>
      <Focus.Provider value={focused}>
        <PeriodCloseScreen />
      </Focus.Provider>
    </QueryClientProvider>
  );
  const view = await render(tree());
  return { client, tree, ...view };
}
async function review() {
  await userEvent
    .setup()
    .press(await screen.findByRole('button', { name: 'Revisar cierre' }));
}
async function confirm() {
  await review();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar cierre' }));
}
test('reviews exact month, monthly versus as-of savings, confirms explicitly and invalidates owner-wide data', async () => {
  const { client } = await open();
  const spy = jest.spyOn(client, 'invalidateQueries');
  await review();
  expect(closePeriod).not.toHaveBeenCalled();
  expect(
    screen.getByText(/deberás reabrirlo explícitamente/),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(/Ahorro protegido acumulado hasta el mes/),
  ).toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar cierre' }));
  expect(await screen.findByText(/Cierre confirmado/)).toBeOnTheScreen();
  expect(closePeriod).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith({ queryKey: recurringOwnerKey(profile.id) });
  expect(spy.mock.calls.length).toBeGreaterThanOrEqual(7);
});
test('cancel and navigation discard unconfirmed review without writing', async () => {
  await open();
  await review();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(
    screen.queryByRole('button', { name: 'Confirmar cierre' }),
  ).not.toBeOnTheScreen();
  await review();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Mes anterior' }));
  expect(
    screen.queryByRole('button', { name: 'Confirmar cierre' }),
  ).not.toBeOnTheScreen();
  expect(closePeriod).not.toHaveBeenCalled();
});
test('current incomplete month hides closing even with a completed-looking device date', async () => {
  const data = closeContext();
  data.financial_month = period.starts_on;
  data.can_close = false;
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(mapPeriodClose(profile.id, period.starts_on, data));
  await open();
  expect(
    await screen.findByText(/aún no terminó según la fecha del servidor/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Revisar cierre' }),
  ).not.toBeOnTheScreen();
});
test('prior obligations block close and link to correct month without backdate suggestion', async () => {
  const data = closeContext();
  data.summary.availability.commitments.prior_unresolved_count = 1;
  data.can_close = false;
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(mapPeriodClose(profile.id, period.starts_on, data));
  await open();
  expect(
    await screen.findByText(/No se puede cerrar mientras existan/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Revisar cierre' }),
  ).not.toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Revisar obligaciones' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/recurring',
    params: { month: period.starts_on },
  });
});
test('closed immutable evidence readable with history but no ordinary close action', async () => {
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(
      mapPeriodClose(profile.id, period.starts_on, closedContext()),
    );
  await open();
  expect(
    await screen.findByText('Resumen conservado al cierre'),
  ).toBeOnTheScreen();
  expect(screen.getByText(/registrado al cierre/)).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Revisar cierre' }),
  ).not.toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Ver movimientos de este mes' }));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: '/history',
    params: { month: period.starts_on },
  });
});
test('uncertain request retains identical payload through navigation and retries exactly once', async () => {
  jest.mocked(closePeriod).mockRejectedValueOnce(new Error('Network'));
  const { rerender, tree } = await open();
  await confirm();
  expect(
    await screen.findByRole('button', { name: 'Comprobar cierre pendiente' }),
  ).toBeOnTheScreen();
  const request = jest.mocked(closePeriod).mock.calls[0][0];
  await rerender(tree(false));
  await rerender(tree());
  await userEvent
    .setup()
    .press(
      await screen.findByRole('button', { name: 'Comprobar cierre pendiente' }),
    );
  expect(closePeriod).toHaveBeenLastCalledWith(request);
  expect(closePeriod).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Comprobar cierre pendiente' }),
    ).not.toBeOnTheScreen(),
  );
});
test('stale preview rejection clears pending and requires fresh confirmation', async () => {
  jest.mocked(closePeriod).mockRejectedValueOnce({ code: '40001' });
  await open();
  await confirm();
  expect(
    await screen.findByText(/vuelve a revisar antes de cerrar/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Comprobar cierre pendiente' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Confirmar cierre' }),
  ).not.toBeOnTheScreen();
});
test('blur/background cancel review and hide all financial content until fresh reads', async () => {
  const { client, rerender, tree } = await open();
  await review();
  await rerender(tree(false));
  expect(
    screen.queryByText(/Ingresos recibidos del mes/),
  ).not.toBeOnTheScreen();
  await rerender(tree());
  await review();
  await act(async () => listener('background'));
  expect(
    screen.queryByRole('button', { name: 'Confirmar cierre' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Ingresos recibidos del mes/),
  ).not.toBeOnTheScreen();
  await act(async () => listener('active'));
  expect(
    await screen.findByRole('button', { name: 'Revisar cierre' }),
  ).toBeOnTheScreen();
  expect(
    client.getQueryData(periodCloseKey(profile.id, period.starts_on)),
  ).toBeDefined();
});
test('refresh error hides cached summary and confirmation', async () => {
  await open();
  await review();
  jest.mocked(readPeriodClose).mockRejectedValueOnce(new Error('Offline'));
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Actualizar mes' }));
  expect(
    await screen.findByText(/No se pudo cargar un resumen válido/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByText(/Ingresos recibidos del mes/),
  ).not.toBeOnTheScreen();
});
test('late success after logout does not restore private UI or invalidate another owner', async () => {
  let resolve!: (value: ReturnType<typeof closure>) => void;
  jest.mocked(closePeriod).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { client, rerender, tree } = await open();
  await confirm();
  const spy = jest.spyOn(client, 'invalidateQueries');
  spy.mockClear();
  state = { status: 'UNAUTHENTICATED' };
  await rerender(tree());
  await act(async () => resolve(closure()));
  expect(screen.queryByText(/Cierre confirmado/)).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Ingresos recibidos del mes/),
  ).not.toBeOnTheScreen();
  expect(spy).not.toHaveBeenCalled();
});

async function openClosed() {
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(
      mapPeriodClose(profile.id, period.starts_on, closedContext()),
    );
  return open();
}
async function reviewReopen() {
  await userEvent
    .setup()
    .press(await screen.findByRole('button', { name: 'Revisar reapertura' }));
}
async function confirmReopen() {
  await reviewReopen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar reapertura' }));
}
test('reopening requires explicit review and confirmation and invalidates all financial namespaces', async () => {
  const { client } = await openClosed();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await reviewReopen();
  expect(reopenPeriod).not.toHaveBeenCalled();
  expect(screen.getByText(/Todos los cierres anteriores/)).toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(reopenPeriod).not.toHaveBeenCalled();
  await confirmReopen();
  expect(await screen.findByText(/Reapertura confirmada/)).toBeOnTheScreen();
  expect(reopenPeriod).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: recurringOwnerKey(profile.id),
  });
  expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(7);
});
test('uncertain reopening survives a real screen unmount with unchanged UUID version and fingerprint', async () => {
  jest.mocked(reopenPeriod).mockRejectedValueOnce(new Error('Offline'));
  const { client, unmount, tree } = await openClosed();
  await confirmReopen();
  expect(
    await screen.findByRole('button', {
      name: 'Comprobar reapertura pendiente',
    }),
  ).toBeOnTheScreen();
  const request = jest.mocked(reopenPeriod).mock.calls[0][0];
  await unmount();
  await render(tree());
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Comprobar reapertura pendiente',
    }),
  );
  expect(reopenPeriod).toHaveBeenLastCalledWith(request);
  expect(reopenPeriod).toHaveBeenCalledTimes(2);
  await waitFor(() =>
    expect(client.getQueryData(pendingLifecycleKey(profile.id))).toBeNull(),
  );
});
test('uncertain close also survives a real remount rather than creating a new request', async () => {
  jest.mocked(closePeriod).mockRejectedValueOnce(new Error('Offline'));
  const { unmount, tree } = await open();
  await confirm();
  const request = jest.mocked(closePeriod).mock.calls[0][0];
  await unmount();
  await render(tree());
  await userEvent
    .setup()
    .press(
      await screen.findByRole('button', { name: 'Comprobar cierre pendiente' }),
    );
  expect(closePeriod).toHaveBeenLastCalledWith(request);
  expect(closePeriod).toHaveBeenCalledTimes(2);
});
test('remount during in-flight reopening cannot send a duplicate request', async () => {
  let resolve!: (value: ReturnType<typeof reopening>) => void;
  jest.mocked(reopenPeriod).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { unmount, tree } = await openClosed();
  await confirmReopen();
  await unmount();
  await render(tree());
  const retry = await screen.findByRole('button', {
    name: 'Comprobar reapertura pendiente',
  });
  expect(retry).toBeDisabled();
  await userEvent.setup().press(retry);
  expect(reopenPeriod).toHaveBeenCalledTimes(1);
  await act(async () => resolve(reopening()));
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Comprobar reapertura pendiente' }),
    ).not.toBeOnTheScreen(),
  );
});
test('auth cache clear discards pending data and ignores old response even after same-owner login', async () => {
  let resolve!: (value: ReturnType<typeof reopening>) => void;
  jest.mocked(reopenPeriod).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { client, rerender, tree } = await openClosed();
  await confirmReopen();
  state = { status: 'UNAUTHENTICATED' };
  await rerender(tree());
  client.clear();
  state = { status: 'AUTHENTICATED_READY', userId: profile.id, profile };
  await rerender(tree());
  await screen.findByRole('button', { name: 'Revisar reapertura' });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  invalidate.mockClear();
  await act(async () => resolve(reopening()));
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.queryByText(/Reapertura confirmada/)).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Comprobar reapertura pendiente' }),
  ).not.toBeOnTheScreen();
});
test('stale reopening requires new review, no uncertain retry', async () => {
  jest.mocked(reopenPeriod).mockRejectedValueOnce({ code: '40001' });
  await openClosed();
  await confirmReopen();
  expect(
    await screen.findByText(/vuelve a revisar antes de reabrir/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Comprobar reapertura pendiente' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Confirmar reapertura' }),
  ).not.toBeOnTheScreen();
});
test('reopened context still presents immutable closure summary and reopen evidence', async () => {
  const original = closure();
  const data = closeContext();
  data.period.lifecycle_version = 2;
  data.summary.period.lifecycle_version = 2;
  data.history = {
    dispositions: [],
    reversals: [],
    closures: [original],
    reopenings: [reopening()],
  };
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(mapPeriodClose(profile.id, period.starts_on, data));
  await open();
  expect(await screen.findByText(/Reapertura · versión 2/)).toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: /Ver cierre versión 1/ }));
  expect(screen.getByText('Resumen conservado al cierre')).toBeOnTheScreen();
});
test('reopen review clears on month navigation and background', async () => {
  await openClosed();
  await reviewReopen();
  await act(async () => listener('background'));
  expect(
    screen.queryByRole('button', { name: 'Confirmar reapertura' }),
  ).not.toBeOnTheScreen();
  await act(async () => listener('active'));
  await reviewReopen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Mes anterior' }));
  expect(
    screen.queryByRole('button', { name: 'Confirmar reapertura' }),
  ).not.toBeOnTheScreen();
  expect(reopenPeriod).not.toHaveBeenCalled();
});

async function reviewDisposition(
  action = 'Mantener disponible sin asignar el mes siguiente',
) {
  const user = userEvent.setup();
  await user.press(
    await screen.findByRole('button', { name: 'Gestionar remanente y cerrar' }),
  );
  await user.press(await screen.findByRole('button', { name: action }));
  await user.type(screen.getByLabelText('Importe del remanente'), '1.50');
  await user.press(
    screen.getByRole('button', { name: 'Revisar disposición y cierre' }),
  );
}
test('disposition has three explicit choices, a net cap and confirmation of both effects', async () => {
  const { client } = await open();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await reviewDisposition();
  expect(screen.getByText(/Máximo neto del mes/)).toBeOnTheScreen();
  expect(
    screen.getByText(/El mes de origen quedará cerrado/),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Aportar a ahorro general' }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('button', {
      name: 'Arrastrar a un fondo del mes siguiente',
    }),
  ).toBeOnTheScreen();
  expect(disposeRemainder).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Confirmar disposición y cierre' }),
    );
  expect(
    await screen.findByText(/Disposición y cierre confirmados/),
  ).toBeOnTheScreen();
  expect(disposeRemainder).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'CARRY_UNALLOCATED',
      amount: 150,
      destinationBucketId: null,
      hash: 'c'.repeat(32),
    }),
  );
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['budget-setup', profile.id],
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: recurringOwnerKey(profile.id),
  });
});
test('uncertain disposition survives real remount with identical child identities and amount', async () => {
  jest.mocked(disposeRemainder).mockRejectedValueOnce(new Error('Offline'));
  const { tree, unmount } = await open();
  await reviewDisposition();
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Confirmar disposición y cierre' }),
    );
  await screen.findByRole('button', {
    name: 'Comprobar disposición pendiente',
  });
  const request = jest.mocked(disposeRemainder).mock.calls[0][0];
  await unmount();
  await render(tree());
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Comprobar disposición pendiente',
    }),
  );
  expect(disposeRemainder).toHaveBeenLastCalledWith(request);
  expect(disposeRemainder).toHaveBeenCalledTimes(2);
});
test('changing amount discards the reviewed disposition and cancel never writes', async () => {
  await open();
  await reviewDisposition('Aportar a ahorro general');
  await userEvent
    .setup()
    .type(screen.getByLabelText('Importe del remanente'), '0');
  expect(
    screen.queryByRole('button', { name: 'Confirmar disposición y cierre' }),
  ).not.toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Cancelar disposición' }));
  expect(disposeRemainder).not.toHaveBeenCalled();
});
test('reversal explicitly reviews destination debit and source reopening; ordinary reopen stays blocked', async () => {
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(
      mapPeriodClose(profile.id, period.starts_on, disposedContext()),
    );
  await open();
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Revisar reversión y reapertura',
    }),
  );
  expect(
    screen.queryByRole('button', { name: 'Revisar reapertura' }),
  ).not.toBeOnTheScreen();
  expect(
    await screen.findByText(/El origen se reabrirá para correcciones/),
  ).toBeOnTheScreen();
  expect(reverseCarry).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Confirmar reversión y reapertura' }),
    );
  expect(
    await screen.findByText(/Reversión y reapertura confirmadas/),
  ).toBeOnTheScreen();
  expect(reverseCarry).toHaveBeenCalledWith(
    expect.objectContaining({
      dispositionId: disposition().id,
      version: 1,
      destinationVersion: 0,
      hash: 'd'.repeat(32),
    }),
  );
  expect(reopenPeriod).not.toHaveBeenCalled();
});
test('reversal blocked by destination state never offers confirmation', async () => {
  const raw = reversalContext();
  raw.can_reverse = false;
  raw.destination.period.status = 'CLOSED';
  raw.destination.shared_responsibilities.period.status = 'CLOSED';
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(
      mapPeriodClose(profile.id, period.starts_on, disposedContext()),
    );
  jest
    .mocked(readReversal)
    .mockResolvedValue(mapReversal(profile.id, disposition().id, raw));
  await open();
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Revisar reversión y reapertura',
    }),
  );
  expect(
    await screen.findByText(/No se puede revertir ahora/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Confirmar reversión y reapertura' }),
  ).not.toBeOnTheScreen();
});
test('failed full remainder read withholds all old disposition amounts', async () => {
  jest.mocked(readRemainder).mockRejectedValue(new Error('Unavailable'));
  await open();
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Gestionar remanente y cerrar',
    }),
  );
  expect(
    await screen.findByText(/No se pudo revisar el remanente completo/),
  ).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Confirmar disposición y cierre' }),
  ).not.toBeOnTheScreen();
  expect(disposeRemainder).not.toHaveBeenCalled();
});
test('uncertain combined reversal survives real remount without a new source reopen', async () => {
  jest
    .mocked(readPeriodClose)
    .mockResolvedValue(
      mapPeriodClose(profile.id, period.starts_on, disposedContext()),
    );
  jest.mocked(reverseCarry).mockRejectedValueOnce(new Error('Offline'));
  const { tree, unmount } = await open();
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Revisar reversión y reapertura',
    }),
  );
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Confirmar reversión y reapertura',
    }),
  );
  await screen.findByRole('button', { name: 'Comprobar reversión pendiente' });
  const request = jest.mocked(reverseCarry).mock.calls[0][0];
  await unmount();
  await render(tree());
  await userEvent.setup().press(
    await screen.findByRole('button', {
      name: 'Comprobar reversión pendiente',
    }),
  );
  expect(reverseCarry).toHaveBeenLastCalledWith(request);
  expect(reverseCarry).toHaveBeenCalledTimes(2);
  expect(reopenPeriod).not.toHaveBeenCalled();
});

test('refresh from household sources hides closure capacity and sources together', async () => {
  await open();
  await screen.findByRole('button', { name: 'Revisar cierre' });
  let resolve!: (value: ReturnType<typeof mapped>) => void;
  jest.mocked(readPeriodClose).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Actualizar consumo del hogar' }),
    );
  expect(
    screen.queryByRole('button', { name: 'Revisar cierre' }),
  ).not.toBeOnTheScreen();
  expect(screen.queryByText(/Tu consumo del hogar/)).not.toBeOnTheScreen();
  await act(async () => resolve(mapped()));
  expect(
    await screen.findByRole('button', { name: 'Revisar cierre' }),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Tu consumo del hogar/)).toBeOnTheScreen();
});
