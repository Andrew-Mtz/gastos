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
import { router, useFocusEffect } from 'expo-router';
import { DashboardScreen } from '../DashboardScreen';
import { dashboardKey, mapDashboard, readDashboard } from '../dashboard-data';
import { useAuth, type AuthState } from '../../auth/AuthProvider';
import { recurringOwnerKey } from '../../recurring/recurring-data';
import { formatMoney } from '../../budget/budget-setup';
import { MarginReadError } from '../../budget/margin-read-error';
import { createMoney } from '../../../domain/money/money';
import { period, profile, snapshot } from './fixtures';
jest.mock('../dashboard-data', () => ({
  ...jest.requireActual('../dashboard-data'),
  readDashboard: jest.fn(),
}));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: jest.fn(),
}));
const Focus = createContext(true);
let state: AuthState;
let appListener: (state: AppStateStatus) => void;
const result = (s = snapshot()) =>
  mapDashboard(profile.id, period.starts_on, s);
const money = (n: number) => formatMoney(createMoney(n, 'USD'));
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  state = {
    status: 'AUTHENTICATED_READY',
    userId: profile.id,
    profile: { ...profile, timezone: 'UTC' },
  };
  jest
    .mocked(useAuth)
    .mockImplementation(() => ({ state }) as ReturnType<typeof useAuth>);
  jest
    .mocked(useFocusEffect)
    .mockImplementation(function useFixtureFocus(callback) {
      const focused = useContext(Focus);
      useEffect(() => {
        if (focused) return callback();
      }, [callback, focused]);
    });
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      appListener = listener;
      return { remove: jest.fn() };
    });
  jest.mocked(readDashboard).mockResolvedValue(result());
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const tree = (focus = true) => (
    <QueryClientProvider client={client}>
      <Focus.Provider value={focus}>
        <DashboardScreen />
      </Focus.Provider>
    </QueryClientProvider>
  );
  const view = await render(tree());
  return { client, tree, ...view };
}
test('Inicio shows a consistent actionable current month with honest labels and all routes', async () => {
  await open();
  expect(
    await screen.findByText(`Ingresos recibidos: ${money(1000)}`),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Tu mes · 2026-10/)).toBeOnTheScreen();
  expect(
    screen.getByLabelText(`Margen antes de estimaciones: ${money(500)}`),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(`Asignado a ahorro este mes: ${money(200)}`),
  ).toBeOnTheScreen();
  expect(screen.getByText(money(750))).toBeOnTheScreen();
  expect(screen.getByText(/No son fondos restantes/)).toBeOnTheScreen();
  expect(screen.getByText(/no saldo bancario ni garantía/)).toBeOnTheScreen();
  expect(
    screen.getByText(/Ingresos esperados:.*No disponibles para gastar/),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Necesidades: gastado.*asignado/)).toBeOnTheScreen();
  expect(
    screen.getByText(/Cuenta lo recibido, no los ingresos esperados/),
  ).toBeOnTheScreen();
  const actions = screen
    .getAllByRole('button')
    .map((button) => button.props.accessibilityLabel);
  expect(actions.indexOf('Registrar gasto')).toBeLessThan(
    actions.indexOf('Ver presupuesto'),
  );
  expect(actions.indexOf('Registrar ingreso')).toBeLessThan(
    actions.indexOf('Ver ahorro'),
  );
  expect(
    screen.getByText(/2026-10-01 · Alquiler · Confirmado/),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(/2026-10-31 · Electricidad · Estimado: aproximadamente/),
  ).toBeOnTheScreen();
  for (const [label, route] of [
    ['Registrar ingreso', '/transactions'],
    ['Registrar gasto', '/expenses'],
    ['Ver presupuesto', '/budget'],
    ['Ver ahorro', '/savings'],
    ['Ver metas', '/savings-goals'],
    ['Ver historial', '/history'],
    ['Ver todas las obligaciones', '/recurring'],
  ]) {
    await userEvent.setup().press(screen.getByRole('button', { name: label }));
    expect(router.push).toHaveBeenLastCalledWith(
      route === '/recurring' || route === '/history'
        ? { pathname: route, params: { month: period.starts_on } }
        : route,
    );
  }
  expect(readDashboard).toHaveBeenCalledWith(
    profile.id,
    '2026-10-01',
    expect.any(AbortSignal),
  );
});
test('missing period asks for setup without an invented balance', async () => {
  jest.mocked(readDashboard).mockResolvedValue({ period: null });
  await open();
  expect(
    await screen.findByText(/Aún no tienes un presupuesto/),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/Margen.*:/)).not.toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Configurar presupuesto' }));
  expect(router.push).toHaveBeenCalledWith('/budget');
});
test('older unresolved obligations block both margins while component facts remain', async () => {
  const s = snapshot();
  s.availability.commitments.prior_unresolved_count = 2;
  jest.mocked(readDashboard).mockResolvedValue(result(s));
  await open();
  expect(await screen.findByText(/Margen no disponible/)).toBeOnTheScreen();
  expect(screen.getByText(/no cambies su fecha real/)).toBeOnTheScreen();
  expect(
    screen.queryByText(/Margen antes de estimaciones:/),
  ).not.toBeOnTheScreen();
  expect(screen.queryByText(/Margen estimado tras/)).not.toBeOnTheScreen();
  expect(
    screen.getByText(`Ingresos recibidos: ${money(1000)}`),
  ).toBeOnTheScreen();
});
test('manual refetch hides ALL old figures and errors cannot reuse them; retry recovers', async () => {
  const view = await open();
  await screen.findByText(/Ingresos recibidos:/);
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Ver cálculo del margen' }));
  expect(screen.getByText(/Menos gastos registrados:/)).toBeOnTheScreen();
  let reject!: (error: unknown) => void;
  jest.mocked(readDashboard).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Actualizar resumen' }));
  expect(await screen.findByRole('progressbar')).toHaveTextContent(
    /Actualizando tu resumen mensual/,
  );
  expect(screen.queryByText(/Ingresos recibidos:/)).not.toBeOnTheScreen();
  expect(screen.queryByLabelText(/Margen antes/)).not.toBeOnTheScreen();
  expect(screen.queryByText(/Menos gastos registrados:/)).not.toBeOnTheScreen();
  expect(screen.queryByText(/Alquiler/)).not.toBeOnTheScreen();
  await act(async () => reject({ code: '23514' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /datos incompatibles/,
  );
  expect(screen.queryByText(/Ingresos recibidos:/)).not.toBeOnTheScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText(/Ingresos recibidos:/);
  expect(
    screen.getByRole('button', { name: 'Ver cálculo del margen' }),
  ).toBeCollapsed();
  expect(screen.queryByText(/Menos gastos registrados:/)).not.toBeOnTheScreen();
  expect(
    view.client.getQueryData(dashboardKey(profile.id, period.starts_on)),
  ).toBeDefined();
});
test('calculation is opt-in, accessible, reversible and never issues a financial request', async () => {
  await open();
  await screen.findByText(/Ingresos recibidos:/);
  const reads = jest.mocked(readDashboard).mock.calls.length;
  const user = userEvent.setup();
  expect(screen.queryByText(/Cómo se calcula/)).not.toBeOnTheScreen();
  expect(
    screen.getByRole('heading', { name: 'Margen mensual para gastar' }),
  ).toBeOnTheScreen();
  for (let i = 0; i < 2; i++) {
    const expand = screen.getByRole('button', {
      name: 'Ver cálculo del margen',
    });
    expect(expand).toBeCollapsed();
    await user.press(expand);
    const collapse = screen.getByRole('button', {
      name: 'Ocultar cálculo del margen',
    });
    expect(collapse).toBeExpanded();
    expect(screen.getByText(/Menos gastos registrados:/)).toBeOnTheScreen();
    await user.press(collapse);
    expect(
      screen.queryByText(/Menos gastos registrados:/),
    ).not.toBeOnTheScreen();
    expect(
      screen.getByLabelText(`Margen antes de estimaciones: ${money(500)}`),
    ).toBeOnTheScreen();
  }
  expect(readDashboard).toHaveBeenCalledTimes(reads);
  expect(router.push).not.toHaveBeenCalled();
});
test.each(['unknown', 'unconfigured'] as const)(
  '%s blocker stays visible with calculation collapsed',
  async (blocker) => {
    const s = snapshot();
    if (blocker === 'unknown') {
      s.availability.commitments.buckets[0].estimated_count = 0;
      s.availability.commitments.buckets[0].estimated_minor = 0;
      s.availability.commitments.buckets[0].unknown_count = 1;
      s.upcoming[1].default_amount_minor = null;
    } else {
      s.allocations = [];
      s.availability.savings.configured = false;
      s.availability.savings.allocated_savings_minor = 0;
      s.availability.savings.spendable_allocated_minor = 0;
      s.availability.savings.unassigned_savings_minor = 450;
    }
    jest.mocked(readDashboard).mockResolvedValue(result(s));
    await open();
    expect(await screen.findByText(/Margen no disponible/)).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Ver cálculo del margen' }),
    ).toBeCollapsed();
    expect(
      screen.queryByLabelText(/Margen antes de estimaciones:/),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText(/Margen estimado tras/)).not.toBeOnTheScreen();
    if (blocker === 'unknown') {
      expect(screen.getByText(/no se tratarán como cero/)).toBeOnTheScreen();
      await userEvent.setup().press(
        screen.getByRole('button', {
          name: 'Revisar obligaciones recurrentes',
        }),
      );
      expect(router.push).toHaveBeenLastCalledWith({
        pathname: '/recurring',
        params: { month: period.starts_on },
      });
    } else {
      expect(screen.getByText(/Configura la distribución/)).toBeOnTheScreen();
      await userEvent
        .setup()
        .press(screen.getByRole('button', { name: 'Configurar presupuesto' }));
      expect(router.push).toHaveBeenLastCalledWith('/budget');
    }
  },
);
test('negative and zero-estimate warnings remain visible without expanding details', async () => {
  const s = snapshot();
  s.availability.savings.spent_minor = 750;
  s.consumption.buckets[0].spent_minor = 750;
  s.availability.commitments.buckets[0].estimated_minor = 0;
  s.upcoming[1].default_amount_minor = 0;
  jest.mocked(readDashboard).mockResolvedValue(result(s));
  await open();
  expect(
    await screen.findByLabelText(
      `Margen antes de estimaciones: ${money(-100)}`,
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Déficit mensual/)).toBeOnTheScreen();
  expect(screen.getByText(/posible déficit/)).toBeOnTheScreen();
  expect(
    screen.getByText(
      /Margen estimado tras estimaciones conocidas: aproximadamente/,
    ),
  ).toHaveTextContent(
    `Margen estimado tras estimaciones conocidas: aproximadamente ${money(-100)}. No es dinero garantizado.`,
  );
  expect(
    screen.getByText(/Electricidad · Estimado: aproximadamente/),
  ).toHaveTextContent(
    `2026-10-31 · Electricidad · Estimado: aproximadamente ${money(0)}`,
  );
  expect(screen.queryByText(/Cómo se calcula/)).not.toBeOnTheScreen();
});
test('closed period explains blocked entry actions while keeping history accessible', async () => {
  const s = snapshot();
  const data = result(s);
  if (!data.period) throw new Error('Fixture must include a period.');
  data.period.status = 'CLOSED';
  jest.mocked(readDashboard).mockResolvedValue(data);
  await open();
  expect(
    await screen.findByText(/Este período está cerrado/),
  ).toBeOnTheScreen();
  const user = userEvent.setup();
  for (const label of ['Registrar gasto', 'Registrar ingreso']) {
    const button = screen.getByRole('button', { name: label });
    expect(button).toBeDisabled();
    await user.press(button);
  }
  expect(router.push).not.toHaveBeenCalled();
  await user.press(screen.getByRole('button', { name: 'Ver historial' }));
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/history',
    params: { month: period.starts_on },
  });
});
test.each([
  ['TRANSPORT', 'MARGEN-CONEXION'],
  ['RPC', 'MARGEN-SERVICIO'],
  ['INVALID_CONTRACT', 'MARGEN-RESPUESTA'],
] as const)(
  '%s diagnostic is accessible, hides amounts and retries explicitly',
  async (reason, reference) => {
    jest
      .mocked(readDashboard)
      .mockRejectedValueOnce(new MarginReadError(reason));
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      new RegExp(reference),
    );
    expect(screen.queryByText(/Ingresos recibidos:/)).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(/Margen antes/)).not.toBeOnTheScreen();
    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByLabelText(
        `Margen antes de estimaciones: ${money(500)}`,
      ),
    ).toBeOnTheScreen();
  },
);
test('every existing owner-wide financial invalidation refetches the dashboard', async () => {
  const { client } = await open();
  await screen.findByText(/Ingresos recibidos:/);
  const previous = jest.mocked(readDashboard).mock.calls.length;
  await act(async () => {
    await client.invalidateQueries({ queryKey: recurringOwnerKey(profile.id) });
  });
  expect(jest.mocked(readDashboard).mock.calls.length).toBeGreaterThan(
    previous,
  );
});
test('blur cancels pending read, hides stale money and focus reloads', async () => {
  let signal: AbortSignal | undefined;
  jest.mocked(readDashboard).mockImplementationOnce((_owner, _month, abort) => {
    signal = abort;
    return new Promise(() => {});
  });
  const view = await open();
  await screen.findByRole('progressbar');
  await view.rerender(view.tree(false));
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
  await view.rerender(view.tree(true));
  expect(await screen.findByText(/Ingresos recibidos:/)).toBeOnTheScreen();
});
test('background hides the snapshot and foreground refreshes it', async () => {
  await open();
  await screen.findByText(/Ingresos recibidos:/);
  const previous = jest.mocked(readDashboard).mock.calls.length;
  await act(async () => appListener('background'));
  expect(screen.queryByText(/Ingresos recibidos:/)).not.toBeOnTheScreen();
  await act(async () => appListener('active'));
  expect(await screen.findByText(/Ingresos recibidos:/)).toBeOnTheScreen();
  expect(jest.mocked(readDashboard).mock.calls.length).toBeGreaterThan(
    previous,
  );
});
test('active month rollover cancels old request and does not display previous month data', async () => {
  let signal: AbortSignal | undefined;
  jest.mocked(readDashboard).mockImplementationOnce((_owner, _month, abort) => {
    signal = abort;
    return new Promise(() => {});
  });
  await open();
  await screen.findByRole('progressbar');
  jest.mocked(readDashboard).mockResolvedValue({ period: null });
  await act(async () => {
    jest.setSystemTime(new Date('2026-11-01T00:01:00Z'));
    jest.advanceTimersByTime(60000);
  });
  expect(await screen.findByText(/Tu mes · 2026-11/)).toBeOnTheScreen();
  expect(signal?.aborted).toBe(true);
  expect(readDashboard).toHaveBeenLastCalledWith(
    profile.id,
    '2026-11-01',
    expect.any(AbortSignal),
  );
});
test('profile timezone determines the financial month', async () => {
  jest.setSystemTime(new Date('2026-11-01T01:00:00Z'));
  state = {
    status: 'AUTHENTICATED_READY',
    userId: profile.id,
    profile: { ...profile, timezone: 'America/Montevideo' },
  };
  await open();
  expect(await screen.findByText(/Tu mes · 2026-10/)).toBeOnTheScreen();
  expect(readDashboard).toHaveBeenLastCalledWith(
    profile.id,
    '2026-10-01',
    expect.any(AbortSignal),
  );
});
test.each([
  'INITIALIZING',
  'UNAUTHENTICATED',
  'SIGNING_OUT',
  'AUTHENTICATED_PROFILE_MISSING',
  'AUTHENTICATED_PROFILE_ERROR',
] as const)(
  '%s never queries or displays a private dashboard',
  async (status) => {
    state = { status, userId: profile.id } as AuthState;
    await open();
    expect(readDashboard).not.toHaveBeenCalled();
    expect(screen.queryByText(/Ingresos recibidos:/)).not.toBeOnTheScreen();
  },
);
test('logout and account switch cancel private reads and isolate the cache key', async () => {
  let signal: AbortSignal | undefined;
  jest.mocked(readDashboard).mockImplementationOnce((_owner, _month, abort) => {
    signal = abort;
    return new Promise(() => {});
  });
  const view = await open();
  await screen.findByRole('progressbar');
  state = { status: 'UNAUTHENTICATED' };
  await view.rerender(view.tree());
  expect(signal?.aborted).toBe(true);
  jest.mocked(readDashboard).mockResolvedValue({ period: null });
  state = {
    status: 'AUTHENTICATED_READY',
    userId: period.id,
    profile: { ...profile, id: period.id },
  };
  await view.rerender(view.tree());
  await waitFor(() =>
    expect(readDashboard).toHaveBeenLastCalledWith(
      period.id,
      period.starts_on,
      expect.any(AbortSignal),
    ),
  );
  expect(
    await screen.findByText(/Aún no tienes un presupuesto/),
  ).toBeOnTheScreen();
});
