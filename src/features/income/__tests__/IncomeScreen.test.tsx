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
import { IncomeEditor, IncomeScreen } from '../IncomeScreen';
import {
  readIncomeMonth,
  registerIncome,
  receivedIncomeKey,
} from '../income-data';
import { useAuth } from '../../auth/AuthProvider';
import { period, profile, request } from './fixtures';
import { currentMonth } from '../../budget/budget-setup';
import { financialDate } from '../income-form';
jest.mock('../income-data', () => ({
  ...jest.requireActual('../income-data'),
  readIncomeMonth: jest.fn(),
  registerIncome: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../../budget/budget-setup', () => ({
  ...jest.requireActual('../../budget/budget-setup'),
  currentMonth: jest.fn(),
}));
jest.mock('../income-form', () => ({
  ...jest.requireActual('../income-form'),
  financialDate: jest.fn(),
}));
let focus: (() => void | (() => void)) | undefined;
let blur: void | (() => void);
const isCurrentUser = jest.fn(() => true);
const data = { period, buckets: [], allocations: [], receivedMinor: 100000 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(currentMonth).mockReturnValue('2026-10-01');
  jest.mocked(financialDate).mockReturnValue('2026-10-20');
  let nextId = 1;
  jest
    .mocked(randomUUID)
    .mockImplementation(
      () => `f1090000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
    );
  isCurrentUser.mockReturnValue(true);
  jest.mocked(readIncomeMonth).mockResolvedValue(data);
  jest.mocked(registerIncome).mockResolvedValue({} as never);
  jest.mocked(useFocusEffect).mockImplementation((callback) => {
    focus = callback;
  });
  jest.mocked(useAuth).mockReturnValue({
    state: { status: 'AUTHENTICATED_READY', userId: profile.id, profile },
    isCurrentUser,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    retry: jest.fn(),
    warning: null,
  });
});
async function openScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <IncomeScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    blur = focus?.();
  });
  await screen.findByText(/Ingresos ·/);
  return { client, ...view };
}
async function beginIncome() {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Registrar ingreso' }));
  await user.type(screen.getByLabelText('Importe (USD)'), '123.45');
  return user;
}
test('expected and received remain visibly separate', async () => {
  await openScreen();
  expect(screen.getByText(/Recibido:/)).toHaveTextContent(/1.000,00/);
  expect(screen.getByText(/Esperado:/)).toHaveTextContent(/1.500,00/);
});
test('persisted expected and received income render without NumberFormat.formatToParts', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Intl.NumberFormat.prototype,
    'formatToParts',
  )!;
  Object.defineProperty(Intl.NumberFormat.prototype, 'formatToParts', {
    ...descriptor,
    value: undefined,
  });
  try {
    await openScreen();
    expect(screen.getByText(/Recibido:/)).toHaveTextContent(/1.000,00/);
    expect(screen.getByText(/Esperado:/)).toHaveTextContent(/1.500,00/);
    const user = await beginIncome();
    await user.press(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText(/Recibido:/)).toHaveTextContent(/1.000,00/);
    expect(registerIncome).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(
      Intl.NumberFormat.prototype,
      'formatToParts',
      descriptor,
    );
  }
});
test('cancel discards unsaved input without writing', async () => {
  await openScreen();
  const user = await beginIncome();
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  await user.press(screen.getByRole('button', { name: 'Registrar ingreso' }));
  expect(screen.getByLabelText('Importe (USD)')).toHaveDisplayValue('');
  expect(registerIncome).not.toHaveBeenCalled();
});
test('successful income refreshes totals and returns to summary', async () => {
  const { client } = await openScreen();
  const actualKey = receivedIncomeKey(profile.id, period.id);
  client.setQueryData(actualKey, 100000);
  const user = await beginIncome();
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  await screen.findByText(/Recibido:/);
  expect(registerIncome).toHaveBeenCalledTimes(1);
  expect(jest.mocked(registerIncome).mock.calls[0][1].form.amount).toBe(
    '123.45',
  );
  await waitFor(() =>
    expect(client.getQueryState(actualKey)?.isInvalidated).toBe(true),
  );
});
test('pending request blocks duplicate taps and survives leave/return', async () => {
  let resolve!: () => void;
  jest.mocked(registerIncome).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = () => done({} as never);
      }),
  );
  await openScreen();
  const user = await beginIncome();
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  expect(
    screen.getByRole('button', { name: 'Comprobar mismo ingreso' }),
  ).toBeDisabled();
  await act(async () => {
    blur?.();
  });
  await act(async () => {
    blur = focus?.();
  });
  await user.press(
    screen.getByRole('button', { name: 'Comprobar registro pendiente' }),
  );
  expect(screen.getByLabelText('Importe (USD)')).toHaveDisplayValue('123.45');
  await act(async () => resolve());
  await screen.findByText(/Recibido:/);
  expect(registerIncome).toHaveBeenCalledTimes(1);
});
test('uncertain network result retries same identity after navigation', async () => {
  jest.mocked(registerIncome).mockRejectedValueOnce(new Error('network'));
  await openScreen();
  const user = await beginIncome();
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  await screen.findByRole('alert');
  const first = jest.mocked(registerIncome).mock.calls[0][1];
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  await user.press(
    screen.getByRole('button', { name: 'Comprobar registro pendiente' }),
  );
  await user.press(
    screen.getByRole('button', { name: 'Comprobar mismo ingreso' }),
  );
  await screen.findByText(/Recibido:/);
  expect(jest.mocked(registerIncome).mock.calls[1][1]).toEqual(first);
});
test('late completion cannot close a newer draft opened while refresh is pending', async () => {
  const { client } = await openScreen();
  const finishRefresh: (() => void)[] = [];
  jest.spyOn(client, 'invalidateQueries').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishRefresh.push(resolve);
      }),
  );
  const user = await beginIncome();
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  await screen.findByText(/Recibido:/);
  await user.press(screen.getByRole('button', { name: 'Registrar ingreso' }));
  await user.type(screen.getByLabelText('Importe (USD)'), '55');
  await act(async () => {
    finishRefresh.forEach((resolve) => resolve());
  });
  expect(screen.getByLabelText('Importe (USD)')).toHaveDisplayValue('55');
});
test('changed identity blocks submission', async () => {
  await openScreen();
  const user = await beginIncome();
  isCurrentUser.mockReturnValue(false);
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  await screen.findByRole('alert');
  expect(registerIncome).not.toHaveBeenCalled();
});
test('closed period has no new-registration action', async () => {
  jest
    .mocked(readIncomeMonth)
    .mockResolvedValue({ ...data, period: { ...period, status: 'CLOSED' } });
  await openScreen();
  expect(
    screen.queryByRole('button', { name: 'Registrar ingreso' }),
  ).not.toBeOnTheScreen();
});
test('form rejects zero before invoking use case', async () => {
  const save = jest.fn();
  const client = new QueryClient();
  await render(
    <QueryClientProvider client={client}>
      <IncomeEditor
        requestId={request.id}
        period={period}
        date="2026-10-20"
        pending={null}
        onSave={save}
        onCancel={jest.fn()}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Importe (USD)'), '0');
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  await waitFor(() =>
    expect(screen.getByText(/Ingresa un importe positivo/)).toBeOnTheScreen(),
  );
  expect(save).not.toHaveBeenCalled();
});

test('returning after budget setup refreshes previously missing budget', async () => {
  jest.mocked(readIncomeMonth).mockResolvedValue({
    period: null,
    buckets: [],
    allocations: [],
    receivedMinor: 0,
  });
  await openScreen();
  expect(screen.getByText(/Configura el presupuesto/)).toBeOnTheScreen();
  await act(async () => {
    blur?.();
  });
  jest.mocked(readIncomeMonth).mockResolvedValue(data);
  await act(async () => {
    blur = focus?.();
  });
  expect(await screen.findByText(/Recibido:/)).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Registrar ingreso' }),
  ).toBeOnTheScreen();
});

test('uncertain request keeps its original period across month rollover', async () => {
  jest.mocked(registerIncome).mockRejectedValueOnce(new Error('network'));
  await openScreen();
  const user = await beginIncome();
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  await screen.findByRole('alert');
  const first = jest.mocked(registerIncome).mock.calls[0];
  await act(async () => {
    blur?.();
  });
  jest.mocked(currentMonth).mockReturnValue('2026-11-01');
  jest.mocked(financialDate).mockReturnValue('2026-11-01');
  jest.mocked(readIncomeMonth).mockResolvedValue({
    period: null,
    buckets: [],
    allocations: [],
    receivedMinor: 0,
  });
  await act(async () => {
    blur = focus?.();
  });
  await screen.findByText(/Configura el presupuesto/);
  await user.press(
    screen.getByRole('button', { name: 'Comprobar registro pendiente' }),
  );
  expect(screen.getByLabelText('Fecha (AAAA-MM-DD)')).toHaveDisplayValue(
    '2026-10-20',
  );
  await user.press(
    screen.getByRole('button', { name: 'Comprobar mismo ingreso' }),
  );
  await screen.findByText(/Configura el presupuesto/);
  expect(jest.mocked(registerIncome).mock.calls[1]).toEqual(first);
});

test('actual registration invalidates owner commitments without another owner', async () => {
  const { client } = await openScreen();
  const own = ['recurring', profile.id, 'commitments', period.id];
  const other = ['recurring', 'other-owner', 'commitments', period.id];
  client.setQueryData(own, {});
  client.setQueryData(other, {});
  const user = await beginIncome();
  await user.press(screen.getByRole('button', { name: 'Guardar ingreso' }));
  await screen.findByText(/Recibido:/);
  expect(client.getQueryState(own)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});
