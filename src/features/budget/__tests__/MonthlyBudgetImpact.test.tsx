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
import { MonthlyBudgetImpact } from '../MonthlyBudgetImpact';
import { SharedResponsibilitiesSummary } from '../SharedResponsibilities';
import { mapDashboard, readDashboard } from '../../dashboard/dashboard-data';
import { snapshot, profile, period } from '../../dashboard/__tests__/fixtures';
import {
  mapSharedResponsibilities,
  readSharedResponsibilities,
  sharedResponsibilityKey,
} from '../shared-responsibility-data';
import { MarginReadError } from '../margin-read-error';
import { createMoney } from '../../../domain/money/money';
import { formatMoney } from '../budget-setup';
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../dashboard/dashboard-data', () => ({
  ...jest.requireActual('../../dashboard/dashboard-data'),
  readDashboard: jest.fn(),
}));
jest.mock('../shared-responsibility-data', () => ({
  ...jest.requireActual('../shared-responsibility-data'),
  readSharedResponsibilities: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn() },
}));
const Focus = createContext(true);
const listeners = new Set<(state: AppStateStatus) => void>();
const money = (n: number, currency = 'USD') =>
  formatMoney(createMoney(n, currency));
const entry = (currency = 'USD', classification: 'NEEDS' | null = 'NEEDS') => ({
  expense_id: 'f2100000-0000-4000-8000-000000000050',
  household_id: 'f2100000-0000-4000-8000-000000000020',
  household_name: 'Casa',
  transaction_date: '2026-10-02',
  description: 'Compra común',
  budget_classification: classification,
  responsibility_amount_minor: 100,
  currency,
  application_status:
    classification === null
      ? ('UNCLASSIFIED' as const)
      : currency === 'USD'
        ? ('APPLIED' as const)
        : ('OTHER_CURRENCY' as const),
  included_in_closed_period: null,
});
function sources(currency = 'USD') {
  return mapSharedResponsibilities(profile.id, period.starts_on, {
    ...snapshot().shared_responsibilities,
    entries: [entry(currency)],
  });
}
function aggregate(spent = 150) {
  const s = snapshot();
  s.consumption.buckets[0].spent_minor = spent;
  s.availability.savings.spent_minor = spent;
  return mapDashboard(profile.id, period.starts_on, {
    ...s,
    shared_responsibilities: sources(),
  });
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
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  listeners.clear();
  jest.mocked(useFocusEffect).mockImplementation(function useTestFocus(cb) {
    const focus = useContext(Focus);
    useEffect(() => (focus ? cb() : undefined), [cb, focus]);
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    listeners.add(cb);
    return { remove: () => listeners.delete(cb) };
  });
  jest.mocked(readDashboard).mockResolvedValue(aggregate());
  jest.mocked(readSharedResponsibilities).mockResolvedValue(sources('UYU'));
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const tree = (owner = profile.id, focused = true) => (
    <QueryClientProvider client={client}>
      <Focus.Provider value={focused}>
        <MonthlyBudgetImpact owner={owner} month={period.starts_on} />
      </Focus.Provider>
    </QueryClientProvider>
  );
  const view = await render(tree());
  return { ...view, client, tree };
}
test('source refresh replaces consumed amount and margin atomically, never reading a second source snapshot', async () => {
  const view = await open();
  await screen.findByText(`Necesidades: gastado ${money(150)}`);
  const next = deferred<Awaited<ReturnType<typeof readDashboard>>>();
  jest.mocked(readDashboard).mockReturnValue(next.promise);
  // Even independently cached newer foreign facts cannot mix into this aggregate.
  view.client.setQueryData(
    sharedResponsibilityKey(profile.id, period.starts_on),
    sources('UYU'),
  );
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Actualizar consumo del hogar' }),
    );
  expect(screen.queryByText(/gastado/)).not.toBeOnTheScreen();
  expect(screen.queryByText(/Compra común/)).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Margen mensual para gastar/),
  ).not.toBeOnTheScreen();
  await act(async () => next.resolve(aggregate(250)));
  expect(
    await screen.findByText(`Necesidades: gastado ${money(250)}`),
  ).toBeOnTheScreen();
  expect(screen.getByText('Compra común')).toBeOnTheScreen();
  expect(screen.queryByText(/UYU/)).not.toBeOnTheScreen();
  expect(readSharedResponsibilities).not.toHaveBeenCalled();
});
test('a failed complete aggregate reveals separate original-currency facts only after hiding all dependent values', async () => {
  await open();
  await screen.findByText(`Necesidades: gastado ${money(150)}`);
  const next = deferred<Awaited<ReturnType<typeof readDashboard>>>();
  const own =
    deferred<Awaited<ReturnType<typeof readSharedResponsibilities>>>();
  jest.mocked(readDashboard).mockReturnValue(next.promise);
  jest.mocked(readSharedResponsibilities).mockReturnValue(own.promise);
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Actualizar consumo del hogar' }),
    );
  await act(async () => next.reject(new MarginReadError('INCOMPATIBLE_DATA')));
  await waitFor(() => expect(readSharedResponsibilities).toHaveBeenCalled());
  expect(screen.queryByText(/gastado/)).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Margen mensual para gastar/),
  ).not.toBeOnTheScreen();
  await act(async () => own.resolve(sources('UYU')));
  expect(
    await screen.findByText(`Necesidades: ${money(-100, 'UYU')}`),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(/saldo, margen y remanente del mes están incompletos/),
  ).toBeOnTheScreen();
  expect(screen.queryByText(/gastado/)).not.toBeOnTheScreen();
});
test.each(['blur', 'background'] as const)(
  'late aggregate after %s cannot restore financial values',
  async (mode) => {
    const view = await open();
    await screen.findByText(/Compra común/);
    const next = deferred<Awaited<ReturnType<typeof readDashboard>>>();
    jest.mocked(readDashboard).mockReturnValue(next.promise);
    await userEvent
      .setup()
      .press(
        screen.getByRole('button', { name: 'Actualizar consumo del hogar' }),
      );
    if (mode === 'blur') await view.rerender(view.tree(profile.id, false));
    else
      await act(async () => {
        listeners.forEach((cb) => cb('background'));
      });
    await act(async () => next.resolve(aggregate(300)));
    expect(
      screen.queryByText(/Compra común|gastado|Margen mensual/),
    ).not.toBeOnTheScreen();
    jest.mocked(readDashboard).mockResolvedValue(aggregate(400));
    if (mode === 'blur') await view.rerender(view.tree());
    else
      await act(async () => {
        listeners.forEach((cb) => cb('active'));
      });
    expect(
      await screen.findByText(`Necesidades: gastado ${money(400)}`),
    ).toBeOnTheScreen();
  },
);
test('late account A read never appears under account B, including no-period source facts', async () => {
  const view = await open();
  await screen.findByText(/Compra común/);
  const next = deferred<Awaited<ReturnType<typeof readDashboard>>>();
  jest.mocked(readDashboard).mockReturnValueOnce(next.promise);
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Actualizar consumo del hogar' }),
    );
  const other = 'f0050000-0000-4000-8000-000000000002';
  const own = mapSharedResponsibilities(other, period.starts_on, {
    owner_profile_id: other,
    month: period.starts_on,
    period: null,
    entries: [
      {
        ...entry('UYU'),
        description: 'Cena propia B',
        responsibility_amount_minor: 250,
        application_status: 'NO_PERIOD',
      },
    ],
  });
  jest
    .mocked(readDashboard)
    .mockResolvedValue({ period: null, sharedResponsibilities: own });
  await view.rerender(view.tree(other));
  expect(
    await screen.findByText(`Necesidades: ${money(-250, 'UYU')}`),
  ).toBeOnTheScreen();
  await act(async () => next.resolve(aggregate(999)));
  expect(
    screen.queryByText(/Compra común|gastado|Margen mensual/),
  ).not.toBeOnTheScreen();
  expect(
    screen.getByText(/aunque todavía no tengas presupuesto o ingresos/),
  ).toBeOnTheScreen();
});
test('closed legacy/foreign causes stay combinable, while exact zero is not a warning', async () => {
  const base = snapshot().shared_responsibilities;
  const data = mapSharedResponsibilities(profile.id, period.starts_on, {
    ...base,
    period: { ...base.period, status: 'CLOSED' },
    entries: [{ ...entry('UYU', null), included_in_closed_period: false }],
  });
  await render(<SharedResponsibilitiesSummary data={data} />);
  expect(
    screen.getByText(/gasto anterior no tiene clasificación/),
  ).toBeOnTheScreen();
  expect(screen.getByText(/Se mantiene en UYU/)).toBeOnTheScreen();
  expect(screen.getByText(/Pendiente de aplicar/)).toBeOnTheScreen();
  expect(screen.getByText(/sin resolver por sí sola/)).toBeOnTheScreen();
});
