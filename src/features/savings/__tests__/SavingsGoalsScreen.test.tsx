import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { SavingsGoalsScreen } from '../SavingsGoalsScreen';
import {
  readSavingsGoals,
  createSavingsGoal,
  readGoalHistory,
  goalsKey,
} from '../goals-data';
import { readSavingsMonth, registerSavings, savingsKey } from '../savings-data';
import { useAuth } from '../../auth/AuthProvider';
import { period, profile } from '../../income/__tests__/fixtures';
import { budgetKey } from '../../budget/budget-data';
import { currentMonth } from '../../budget/budget-setup';
import { financialDate } from '../../income/income-form';
import { goalProgress } from '../../../domain/savings/savings-goal';
import { calculateSavingsAvailability } from '../../../domain/savings/savings-availability';
import { createMoney } from '../../../domain/money/money';
jest.mock('../goals-data', () => ({
  ...jest.requireActual('../goals-data'),
  readSavingsGoals: jest.fn(),
  createSavingsGoal: jest.fn(),
  readGoalHistory: jest.fn(),
}));
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
const goal = {
  id: '61160000-0000-4000-8000-000000000001',
  owner_profile_id: profile.id,
  scope: 'PERSONAL' as const,
  name: 'Viaje',
  target_amount_minor: 10000,
  currency: 'USD',
  target_date: '2027-03-01',
  balance_minor: 10000,
  progress: goalProgress(10000, 10000, 'USD'),
};
const savings = {
  protectedSavings: createMoney(40000, 'USD'),
  sharedResponsibilities: {
    owner_profile_id: profile.id,
    month: period.starts_on,
    period: {
      id: period.id,
      status: period.status,
      base_currency: period.base_currency,
    },
    entries: [],
  },
  period,
  configured: true,
  carry: {
    incoming_minor: 0,
    outgoing_minor: 0,
    unallocated_minor: 0,
    buckets: [],
  },
  goalReserved: createMoney(10000, 'USD'),
  unassignedSavings: createMoney(30000, 'USD'),
  availability: calculateSavingsAvailability('USD', {
    openingProtectedMinor: 10000,
    allocatedSavingsMinor: 20000,
    contributionsMinor: 10000,
    withdrawalsMinor: 0,
    spendableAllocatedMinor: 80000,
    spentMinor: 0,
  }),
};
const isCurrentUser = jest.fn(() => true);
let focus: (() => void | (() => void)) | undefined;
let blur: void | (() => void);
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(currentMonth).mockReturnValue('2026-10-01');
  jest.mocked(financialDate).mockReturnValue('2026-10-20');
  let next = 1;
  jest
    .mocked(randomUUID)
    .mockImplementation(
      () => `a1160000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
    );
  jest.mocked(readSavingsGoals).mockResolvedValue([goal]);
  jest.mocked(readSavingsMonth).mockResolvedValue(savings);
  jest.mocked(createSavingsGoal).mockResolvedValue(goal);
  jest.mocked(registerSavings).mockResolvedValue({} as never);
  jest
    .mocked(readGoalHistory)
    .mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(useFocusEffect).mockImplementation((cb) => {
    focus = cb;
  });
  isCurrentUser.mockReturnValue(true);
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
afterEach(() => jest.useRealTimers());
async function openScreen() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <SavingsGoalsScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    blur = focus?.();
  });
  await screen.findByText('Viaje');
  return { client, ...view };
}
async function beginCreate() {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Crear meta' }));
  await user.type(screen.getByLabelText('Nombre de la meta'), 'Casa');
  await user.type(screen.getByLabelText('Objetivo (USD)'), '250.55');
  await user.type(
    screen.getByLabelText('Fecha objetivo (AAAA-MM-DD, opcional)'),
    '2027-04-30',
  );
  return user;
}
async function beginMovement(withdraw = false) {
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', {
      name: withdraw ? 'Retirar de Viaje' : 'Aportar a Viaje',
    }),
  );
  await user.type(screen.getByLabelText('Importe (USD)'), '25.50');
  return user;
}
test('goals show a subset of savings, exact progress, target and date, not bank balances', async () => {
  await openScreen();
  expect(screen.getByText(/no saldos bancarios/)).toBeOnTheScreen();
  expect(screen.getByText(/Reservado:/)).toHaveTextContent(/100,00.*100,00/);
  expect(screen.getByText('Objetivo alcanzado')).toBeOnTheScreen();
  expect(screen.getByText('Fecha objetivo: 2027-03-01')).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Ahorro general' }));
  expect(router.push).toHaveBeenCalledWith('/savings');
});
test('creation cancel writes nothing; saving creates only the goal with optional date', async () => {
  await openScreen();
  let user = await beginCreate();
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(createSavingsGoal).not.toHaveBeenCalled();
  user = await beginCreate();
  await user.press(screen.getByRole('button', { name: 'Guardar meta' }));
  await screen.findByText('Viaje');
  expect(createSavingsGoal).toHaveBeenCalledTimes(1);
  expect(jest.mocked(createSavingsGoal).mock.calls[0]).toEqual([
    profile.id,
    {
      id: expect.any(String),
      form: {
        name: 'Casa',
        target: '250.55',
        currency: 'USD',
        targetDate: '2027-04-30',
      },
    },
  ]);
  expect(registerSavings).not.toHaveBeenCalled();
});
test('creation does not require a month budget; cross-currency and closed-month funding is disabled', async () => {
  jest.mocked(readSavingsMonth).mockResolvedValue({
    period: null,
    availability: null,
    protectedSavings: null,
    configured: false,
    sharedResponsibilities: {
      ...savings.sharedResponsibilities,
      period: null,
    },
  });
  const view = await openScreen();
  expect(screen.getByRole('button', { name: 'Crear meta' })).toBeEnabled();
  expect(
    screen.getByRole('button', { name: 'Aportar a Viaje' }),
  ).toBeDisabled();
  await view.unmount();
  jest
    .mocked(readSavingsMonth)
    .mockResolvedValue({ ...savings, period: { ...period, status: 'CLOSED' } });
  await openScreen();
  expect(
    screen.getByRole('button', { name: 'Retirar de Viaje' }),
  ).toBeDisabled();
});
test('goal creation uncertainty pins exact identity and payload through navigation and month rollover', async () => {
  jest.mocked(createSavingsGoal).mockRejectedValueOnce(new Error('timeout'));
  await openScreen();
  const user = await beginCreate();
  await user.press(screen.getByRole('button', { name: 'Guardar meta' }));
  await screen.findByRole('alert');
  const original = jest.mocked(createSavingsGoal).mock.calls[0];
  await act(async () => {
    blur?.();
  });
  jest.mocked(currentMonth).mockReturnValue('2026-11-01');
  jest.mocked(readSavingsGoals).mockRejectedValue(new Error('summary offline'));
  await act(async () => {
    blur = focus?.();
  });
  await user.press(
    await screen.findByRole('button', {
      name: 'Comprobar operación pendiente',
    }),
  );
  expect(screen.getByLabelText('Nombre de la meta')).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Moneda' })).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar misma meta' }),
  );
  await waitFor(() => expect(createSavingsGoal).toHaveBeenCalledTimes(2));
  expect(jest.mocked(createSavingsGoal).mock.calls[1]).toEqual(original);
});
test('funding keeps goal identity and invalidates all owner savings months plus history and budget', async () => {
  const { client } = await openScreen();
  const keys = [
    goalsKey(profile.id, '2026-11-01'),
    savingsKey(profile.id, '2026-11-01'),
    ['recurring', profile.id, 'commitments', period.id],
    ['history', profile.id, '2026-10-01'],
    budgetKey(profile.id, '2026-10-01'),
  ];
  keys.forEach((key) => client.setQueryData(key, {}));
  const user = await beginMovement();
  await user.press(screen.getByRole('button', { name: 'Guardar aporte' }));
  await screen.findByText('Viaje');
  expect(jest.mocked(registerSavings).mock.calls[0][1]).toMatchObject({
    savingsGoalId: goal.id,
    type: 'SAVINGS_CONTRIBUTION',
    withdrawalConfirmed: false,
    form: { amount: '25.50' },
  });
  for (const key of keys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
test('goal withdrawal explicitly describes progress impact and cancellation cannot withdraw', async () => {
  await openScreen();
  const user = await beginMovement(true);
  await user.press(screen.getByRole('button', { name: 'Revisar retiro' }));
  expect(screen.getByText(/Este retiro reduce su progreso/)).toHaveTextContent(
    /Viaje/,
  );
  expect(registerSavings).not.toHaveBeenCalled();
  await user.press(screen.getByRole('button', { name: 'Volver sin retirar' }));
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(registerSavings).not.toHaveBeenCalled();
});
test('confirmed withdrawal can lower an attained goal below target after refresh', async () => {
  await openScreen();
  const user = await beginMovement(true);
  await user.press(screen.getByRole('button', { name: 'Revisar retiro' }));
  jest.mocked(readSavingsGoals).mockResolvedValue([
    {
      ...goal,
      balance_minor: 7450,
      progress: goalProgress(10000, 7450, 'USD'),
    },
  ]);
  await user.press(
    screen.getByRole('button', { name: 'Confirmar retiro de ahorro' }),
  );
  await screen.findByText(/Falta:/);
  expect(screen.queryByText('Objetivo alcanzado')).not.toBeOnTheScreen();
  expect(jest.mocked(registerSavings).mock.calls[0][1]).toMatchObject({
    savingsGoalId: goal.id,
    type: 'SAVINGS_WITHDRAWAL',
    withdrawalConfirmed: true,
  });
});
test('uncertain goal movement preserves goal/month/form across focus rollover', async () => {
  jest.mocked(registerSavings).mockRejectedValueOnce(new Error('timeout'));
  await openScreen();
  const user = await beginMovement();
  await user.press(screen.getByRole('button', { name: 'Guardar aporte' }));
  await screen.findByRole('alert');
  const original = jest.mocked(registerSavings).mock.calls[0];
  await act(async () => {
    blur?.();
  });
  jest.mocked(currentMonth).mockReturnValue('2026-11-01');
  jest.mocked(readSavingsMonth).mockResolvedValue({
    ...savings,
    period: {
      ...period,
      id: 'f1160000-0000-4000-8000-000000000002',
      starts_on: '2026-11-01',
      ends_on: '2026-11-30',
    },
  });
  await act(async () => {
    blur = focus?.();
  });
  await user.press(
    await screen.findByRole('button', {
      name: 'Comprobar operación pendiente',
    }),
  );
  expect(screen.getByLabelText('Importe (USD)')).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar mismo movimiento' }),
  );
  await waitFor(() => expect(registerSavings).toHaveBeenCalledTimes(2));
  expect(jest.mocked(registerSavings).mock.calls[1]).toEqual(original);
});
test('pending create blocks repeat taps and late completion cannot reveal old owner data', async () => {
  let resolve!: (value: never) => void;
  jest.mocked(createSavingsGoal).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { client, rerender } = await openScreen();
  const user = await beginCreate();
  await user.press(screen.getByRole('button', { name: 'Guardar meta' }));
  expect(
    screen.getByRole('button', { name: 'Comprobar misma meta' }),
  ).toBeDisabled();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  invalidate.mockClear();
  isCurrentUser.mockReturnValue(false);
  jest.mocked(useAuth).mockReturnValue({
    ...jest.mocked(useAuth)(),
    state: { status: 'UNAUTHENTICATED' },
  } as never);
  await rerender(
    <QueryClientProvider client={client}>
      <SavingsGoalsScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    resolve(goal as never);
  });
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.queryByText('Viaje')).not.toBeOnTheScreen();
  expect(createSavingsGoal).toHaveBeenCalledTimes(1);
});
test('refetch hides stale funded values and fails without fallback progress', async () => {
  await openScreen();
  let reject!: (error: unknown) => void;
  jest.mocked(readSavingsGoals).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    blur?.();
    blur = focus?.();
  });
  await screen.findByText('Actualizando metas…');
  expect(screen.queryByText(/Reservado:/)).not.toBeOnTheScreen();
  await act(async () => {
    reject({ code: '23514' });
  });
  expect(screen.queryByText(/Reservado:/)).not.toBeOnTheScreen();
});
test('history belongs to chosen goal and supports explicit hide', async () => {
  await openScreen();
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Ver movimientos de Viaje' }),
  );
  await screen.findByText('Esta meta todavía no tiene movimientos.');
  expect(readGoalHistory).toHaveBeenCalledWith(
    profile.id,
    goal.id,
    '2026-10-01',
    null,
    expect.any(AbortSignal),
  );
  await user.press(
    screen.getByRole('button', { name: 'Ocultar movimientos de Viaje' }),
  );
  expect(
    screen.queryByText('Esta meta todavía no tiene movimientos.'),
  ).not.toBeOnTheScreen();
});

test('different-currency goal cannot use the current month funding or withdrawal', async () => {
  jest
    .mocked(readSavingsGoals)
    .mockResolvedValue([
      { ...goal, currency: 'EUR', progress: goalProgress(10000, 10000, 'EUR') },
    ]);
  await openScreen();
  expect(
    screen.getByRole('button', { name: 'Aportar a Viaje' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Retirar de Viaje' }),
  ).toBeDisabled();
  expect(screen.getByText(/No hay conversión/)).toBeOnTheScreen();
});
