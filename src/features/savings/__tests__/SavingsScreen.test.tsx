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
import { SavingsScreen } from '../SavingsScreen';
import { readSavingsMonth, registerSavings, savingsKey } from '../savings-data';
import { useAuth } from '../../auth/AuthProvider';
import { period, profile } from '../../income/__tests__/fixtures';
import { currentMonth } from '../../budget/budget-setup';
import { financialDate } from '../../income/income-form';
import { createMoney } from '../../../domain/money/money';
import { calculateSavingsAvailability } from '../../../domain/savings/savings-availability';
jest.mock('../savings-data', () => ({
  ...jest.requireActual('../savings-data'),
  readSavingsMonth: jest.fn(),
  registerSavings: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn() },
}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../../budget/budget-setup', () => ({
  ...jest.requireActual('../../budget/budget-setup'),
  currentMonth: jest.fn(),
}));
jest.mock('../../income/income-form', () => ({
  ...jest.requireActual('../../income/income-form'),
  financialDate: jest.fn(),
}));
let focus: (() => void | (() => void)) | undefined;
let blur: void | (() => void);
const isCurrentUser = jest.fn(() => true);
const data = {
  period,
  configured: true,
  carry: {
    incoming_minor: 0,
    outgoing_minor: 0,
    unallocated_minor: 0,
    buckets: [],
  },
  goalReserved: createMoney(0, 'USD'),
  unassignedSavings: createMoney(40000, 'USD'),
  availability: calculateSavingsAvailability('USD', {
    openingProtectedMinor: 10000,
    allocatedSavingsMinor: 30000,
    contributionsMinor: 0,
    withdrawalsMinor: 0,
    spendableAllocatedMinor: 120000,
    spentMinor: 40000,
  }),
};
// Keep Query notification timers within RNTL's controlled async clock.
afterEach(() => {
  jest.useRealTimers();
});
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(currentMonth).mockReturnValue('2026-10-01');
  jest.mocked(financialDate).mockReturnValue('2026-10-20');
  let nextId = 1;
  jest
    .mocked(randomUUID)
    .mockImplementation(
      () => `f1150000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
    );
  isCurrentUser.mockReturnValue(true);
  jest.mocked(readSavingsMonth).mockResolvedValue(data);
  jest.mocked(registerSavings).mockResolvedValue({} as never);
  jest.mocked(useFocusEffect).mockImplementation((cb) => {
    focus = cb;
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
      <SavingsScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    blur = focus?.();
  });
  await screen.findByText(/Ahorro protegido acumulado/);
  return { client, ...view };
}
async function begin(withdrawal = false) {
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', {
      name: withdrawal ? 'Retirar de ahorro' : 'Aportar a ahorro',
    }),
  );
  await user.type(screen.getByLabelText('Importe (USD)'), '25.50');
  return user;
}
test('labels cumulative saving and ordinary remainder before commitments truthfully', async () => {
  await openScreen();
  expect(screen.getByText(/Ahorro protegido acumulado/)).toHaveTextContent(
    /400,00/,
  );
  expect(screen.getByText(/Resto ordinario del mes/)).toHaveTextContent(
    /800,00/,
  );
  expect(screen.getByText(/no es dinero seguro/)).toBeOnTheScreen();
});
test('withdrawal requires review and explicit confirmation; back or cancel writes nothing', async () => {
  await openScreen();
  const user = await begin(true);
  await user.press(screen.getByRole('button', { name: 'Revisar retiro' }));
  expect(registerSavings).not.toHaveBeenCalled();
  expect(screen.getByText(/Retirar.*25,50/)).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Volver sin retirar' }));
  expect(screen.getByLabelText('Importe (USD)')).toHaveDisplayValue('25.50');
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(registerSavings).not.toHaveBeenCalled();
});
test('confirmed withdrawal is recorded once and invalidates all owner months and history', async () => {
  const { client } = await openScreen();
  const future = savingsKey(profile.id, '2026-11-01');
  client.setQueryData(future, data);
  const commitments = ['recurring', profile.id, 'commitments', period.id];
  client.setQueryData(commitments, {});
  client.setQueryData(['history', profile.id, '2026-10-01'], {});
  const user = await begin(true);
  await user.press(screen.getByRole('button', { name: 'Revisar retiro' }));
  await user.press(
    screen.getByRole('button', { name: 'Confirmar retiro de ahorro' }),
  );
  await screen.findByText(/Ahorro protegido acumulado/);
  expect(registerSavings).toHaveBeenCalledTimes(1);
  expect(jest.mocked(registerSavings).mock.calls[0][1]).toMatchObject({
    type: 'SAVINGS_WITHDRAWAL',
    withdrawalConfirmed: true,
  });
  await waitFor(() =>
    expect(client.getQueryState(future)?.isInvalidated).toBe(true),
  );
  expect(client.getQueryState(commitments)?.isInvalidated).toBe(true);
});
test('contribution does not require withdrawal confirmation and cancel discards draft', async () => {
  await openScreen();
  let user = await begin();
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  user = await begin();
  await user.press(screen.getByRole('button', { name: 'Guardar aporte' }));
  await screen.findByText(/Ahorro protegido acumulado/);
  expect(jest.mocked(registerSavings).mock.calls[0][1]).toMatchObject({
    type: 'SAVINGS_CONTRIBUTION',
    withdrawalConfirmed: false,
  });
});
test('timeout preserves request id, type and amount across navigation and month rollover', async () => {
  jest.mocked(registerSavings).mockRejectedValueOnce(new Error('timeout'));
  await openScreen();
  const user = await begin(true);
  await user.press(screen.getByRole('button', { name: 'Revisar retiro' }));
  await user.press(
    screen.getByRole('button', { name: 'Confirmar retiro de ahorro' }),
  );
  await screen.findByRole('alert');
  const original = jest.mocked(registerSavings).mock.calls[0];
  await act(async () => {
    blur?.();
  });
  jest.mocked(currentMonth).mockReturnValue('2026-11-01');
  jest.mocked(readSavingsMonth).mockResolvedValue({
    ...data,
    period: {
      ...period,
      id: 'f1030000-0000-4000-8000-000000000003',
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
    },
  });
  await act(async () => {
    blur = focus?.();
  });
  await user.press(
    await screen.findByRole('button', {
      name: 'Comprobar movimiento pendiente',
    }),
  );
  expect(screen.getByLabelText('Importe (USD)')).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar mismo movimiento' }),
  );
  await waitFor(() => expect(registerSavings).toHaveBeenCalledTimes(2));
  expect(jest.mocked(registerSavings).mock.calls[1]).toEqual(original);
});
test('pending write blocks duplicate taps and survives navigation', async () => {
  let resolve!: (value: never) => void;
  jest.mocked(registerSavings).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await openScreen();
  const user = await begin();
  await user.press(screen.getByRole('button', { name: 'Guardar aporte' }));
  expect(
    screen.getByRole('button', { name: 'Comprobar mismo movimiento' }),
  ).toBeDisabled();
  await act(async () => {
    blur?.();
  });
  await act(async () => {
    blur = focus?.();
  });
  await act(async () => {
    resolve({} as never);
  });
  await screen.findByText(/Ahorro protegido acumulado/);
  expect(registerSavings).toHaveBeenCalledTimes(1);
});
test('auth change discards private UI and late write cannot invalidate a new owner cache', async () => {
  let resolve!: (value: never) => void;
  jest.mocked(registerSavings).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { client, rerender } = await openScreen();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const user = await begin();
  await user.press(screen.getByRole('button', { name: 'Guardar aporte' }));
  invalidate.mockClear();
  isCurrentUser.mockReturnValue(false);
  jest.mocked(useAuth).mockReturnValue({
    ...jest.mocked(useAuth)(),
    state: { status: 'UNAUTHENTICATED' },
  } as never);
  await rerender(
    <QueryClientProvider client={client}>
      <SavingsScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    resolve({} as never);
  });
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.queryByText(/Ahorro protegido/)).not.toBeOnTheScreen();
});
test('refocus refresh hides stale financial totals and errors never show a fallback', async () => {
  await openScreen();
  let reject!: (reason: unknown) => void;
  jest.mocked(readSavingsMonth).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    blur?.();
    blur = focus?.();
  });
  await screen.findByText('Actualizando ahorro…');
  expect(
    screen.queryByText(/Ahorro protegido acumulado/),
  ).not.toBeOnTheScreen();
  await act(async () => {
    reject({ code: '23514' });
  });
  expect(
    screen.queryByText(/Ahorro protegido acumulado/),
  ).not.toBeOnTheScreen();
});
test('closed month shows no new movement actions', async () => {
  jest
    .mocked(readSavingsMonth)
    .mockResolvedValue({ ...data, period: { ...period, status: 'CLOSED' } });
  await openScreen();
  expect(
    screen.queryByRole('button', { name: 'Aportar a ahorro' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Retirar de ahorro' }),
  ).not.toBeOnTheScreen();
});

test('an older replay completion cannot dismiss a newly opened draft', async () => {
  const resolvers: ((value: never) => void)[] = [];
  jest.mocked(registerSavings).mockImplementation(
    () =>
      new Promise((done) => {
        resolvers.push(done);
      }),
  );
  await openScreen();
  const user = await begin();
  await user.press(screen.getByRole('button', { name: 'Guardar aporte' }));
  await act(async () => {
    blur?.();
    blur = focus?.();
  });
  await user.press(
    await screen.findByRole('button', {
      name: 'Comprobar movimiento pendiente',
    }),
  );
  await user.press(
    screen.getByRole('button', { name: 'Comprobar mismo movimiento' }),
  );
  await waitFor(() => expect(registerSavings).toHaveBeenCalledTimes(2));
  expect(jest.mocked(registerSavings).mock.calls[1]).toEqual(
    jest.mocked(registerSavings).mock.calls[0],
  );
  await act(async () => {
    resolvers[0]({} as never);
  });
  await screen.findByText(/Ahorro protegido acumulado/);
  await begin(true);
  await act(async () => {
    resolvers[1]({} as never);
  });
  expect(screen.getByLabelText('Importe (USD)')).toHaveDisplayValue('25.50');
  expect(
    screen.getByRole('button', { name: 'Revisar retiro' }),
  ).toBeOnTheScreen();
});
