import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { RecurringScreen } from '../RecurringScreen';
import {
  readRecurringMonth,
  createTemplate,
  resolveRecurring,
  stopTemplate,
} from '../recurring-data';
import { useAuth } from '../../auth/AuthProvider';
import { currentMonth } from '../../budget/budget-setup';
import { financialDate } from '../../income/income-form';
import { period, profile, screenData, template } from './fixtures';
jest.mock('../CommittedMoney', () => ({ CommittedMoney: () => null }));
jest.mock('../recurring-data', () => ({
  ...jest.requireActual('../recurring-data'),
  readRecurringMonth: jest.fn(),
  createTemplate: jest.fn(),
  resolveRecurring: jest.fn(),
  stopTemplate: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
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
const isCurrentUser = jest.fn((_id: string) => true);
let focus: (() => void | (() => void)) | undefined, blur: void | (() => void);
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(currentMonth).mockReturnValue(period.starts_on);
  jest.mocked(financialDate).mockReturnValue('2026-10-20');
  let next = 1;
  jest
    .mocked(randomUUID)
    .mockImplementation(
      () => `a1180000-0000-4000-8000-${String(next++).padStart(12, '0')}`,
    );
  jest.mocked(readRecurringMonth).mockResolvedValue(screenData);
  jest.mocked(createTemplate).mockResolvedValue(template);
  jest.mocked(resolveRecurring).mockResolvedValue({} as never);
  jest.mocked(stopTemplate).mockResolvedValue(template);
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
      <RecurringScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    blur = focus?.();
  });
  await screen.findByText('Electricidad');
  return { client, ...view };
}
async function beginResolve() {
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar Electricidad' }),
  );
  await user.type(screen.getByLabelText('Importe real (USD)'), '28.40');
  return user;
}
async function beginCreate() {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Crear plantilla' }));
  await user.type(screen.getByLabelText('Nombre'), 'Agua');
  await user.press(screen.getByRole('button', { name: 'Servicios' }));
  return user;
}
test('pending variable explicitly distinguishes estimate from actual and cancel writes nothing', async () => {
  await openScreen();
  expect(screen.getByText(/Estimación desconocida/)).toBeOnTheScreen();
  const user = await beginResolve();
  expect(screen.getByText(/ni se retira ahorro/)).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(resolveRecurring).not.toHaveBeenCalled();
});
test('creation saves only a template and does not invalidate actual balances', async () => {
  const { client } = await openScreen();
  const key = ['savings', profile.id, '2026-11-01'];
  client.setQueryData(key, {});
  const user = await beginCreate();
  await user.press(screen.getByRole('button', { name: 'Guardar plantilla' }));
  await screen.findByText('Electricidad');
  expect(createTemplate).toHaveBeenCalledWith(
    profile.id,
    expect.objectContaining({
      form: expect.objectContaining({
        amountMode: 'VARIABLE',
        amount: '',
        name: 'Agua',
      }),
    }),
  );
  expect(resolveRecurring).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});
test('actual resolution invalidates owner-wide savings/history/consumption and monthly budget', async () => {
  const { client } = await openScreen();
  const keys = [
    ['savings', profile.id, '2026-11-01'],
    ['history', profile.id, '2026-10-01'],
    ['bucket-consumption', profile.id, '2026-10-01'],
    ['budget-setup', profile.id, '2026-10-01'],
    ['expenses', profile.id, '2026-11-01'],
    ['recurring', profile.id, 'commitments', period.id],
  ];
  keys.forEach((k) => client.setQueryData(k, {}));
  const user = await beginResolve();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar importe real' }),
  );
  await screen.findByText('Electricidad');
  expect(resolveRecurring).toHaveBeenCalledWith(
    period,
    template,
    expect.objectContaining({
      form: { amount: '28.40', date: '2026-10-20', description: '' },
    }),
  );
  for (const key of keys)
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});
test.each(['missing', 'closed', 'currency', 'category'])(
  'unresolvable %s context cannot confirm',
  async (kind) => {
    jest.mocked(readRecurringMonth).mockResolvedValue({
      ...screenData,
      ...(kind === 'missing'
        ? { period: null }
        : kind === 'closed'
          ? { period: { ...period, status: 'CLOSED' } }
          : kind === 'currency'
            ? { period: { ...period, base_currency: 'EUR' } }
            : { categories: [] }),
    } as never);
    await openScreen();
    expect(
      screen.getByRole('button', { name: 'Confirmar Electricidad' }),
    ).toBeDisabled();
    if (kind === 'missing')
      expect(
        screen.getByRole('button', { name: 'Crear plantilla' }),
      ).toBeEnabled();
  },
);
test('stop presents preservation warning, cancellation writes nothing, confirmation uses chosen month', async () => {
  await openScreen();
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Detener Electricidad' }),
  );
  expect(
    screen.getByText(/confirmados o cancelados se conservan/),
  ).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(stopTemplate).not.toHaveBeenCalled();
  await user.press(
    screen.getByRole('button', { name: 'Detener Electricidad' }),
  );
  await user.clear(screen.getByLabelText('Detener desde (AAAA-MM-01)'));
  await user.type(
    screen.getByLabelText('Detener desde (AAAA-MM-01)'),
    '2026-11-01',
  );
  await user.press(screen.getByRole('button', { name: 'Confirmar detención' }));
  await screen.findByText('Electricidad');
  expect(stopTemplate).toHaveBeenCalledWith(profile.id, template, '2026-11-01');
  expect(resolveRecurring).not.toHaveBeenCalled();
});
test('uncertain resolve survives blur, changed selected month and failed refresh with identical payload', async () => {
  jest.mocked(resolveRecurring).mockRejectedValueOnce(new Error('timeout'));
  await openScreen();
  const user = await beginResolve();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar importe real' }),
  );
  await screen.findByRole('alert');
  const original = jest.mocked(resolveRecurring).mock.calls[0];
  await act(async () => {
    blur?.();
  });
  jest.mocked(currentMonth).mockReturnValue('2026-11-01');
  jest.mocked(readRecurringMonth).mockRejectedValue(new Error('offline'));
  await act(async () => {
    blur = focus?.();
  });
  await user.press(screen.getByRole('button', { name: 'Mes siguiente' }));
  await user.press(
    screen.getByRole('button', { name: 'Comprobar operación pendiente' }),
  );
  expect(screen.getByLabelText('Importe real (USD)')).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar mismo gasto' }),
  );
  await waitFor(() => expect(resolveRecurring).toHaveBeenCalledTimes(2));
  expect(jest.mocked(resolveRecurring).mock.calls[1]).toEqual(original);
});
test('uncertain creation survives navigation without generating a new UUID', async () => {
  jest.mocked(createTemplate).mockRejectedValueOnce(new Error('timeout'));
  await openScreen();
  const user = await beginCreate();
  await user.press(screen.getByRole('button', { name: 'Guardar plantilla' }));
  await screen.findByRole('alert');
  const original = jest.mocked(createTemplate).mock.calls[0];
  await act(async () => {
    blur?.();
    blur = focus?.();
  });
  await user.press(
    screen.getByRole('button', { name: 'Comprobar operación pendiente' }),
  );
  expect(screen.getByLabelText('Nombre')).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar misma plantilla' }),
  );
  await waitFor(() => expect(createTemplate).toHaveBeenCalledTimes(2));
  expect(jest.mocked(createTemplate).mock.calls[1]).toEqual(original);
});
test('uncertain stop retains exact month on retry', async () => {
  jest.mocked(stopTemplate).mockRejectedValueOnce(new Error('timeout'));
  await openScreen();
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Detener Electricidad' }),
  );
  await user.press(screen.getByRole('button', { name: 'Confirmar detención' }));
  await screen.findByRole('alert');
  const original = jest.mocked(stopTemplate).mock.calls[0];
  await act(async () => {
    blur?.();
    blur = focus?.();
  });
  await user.press(
    screen.getByRole('button', { name: 'Comprobar operación pendiente' }),
  );
  expect(screen.getByLabelText('Detener desde (AAAA-MM-01)')).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar misma detención' }),
  );
  await waitFor(() => expect(stopTemplate).toHaveBeenCalledTimes(2));
  expect(jest.mocked(stopTemplate).mock.calls[1]).toEqual(original);
});
test('cancelled stopped history is visible and cannot be re-resolved', async () => {
  jest.mocked(readRecurringMonth).mockResolvedValue({
    ...screenData,
    items: [
      {
        template: { ...template, stoppedFrom: period.starts_on },
        dueDate: null,
        status: 'CANCELLED',
        actual: {
          amountMinor: 2840,
          currency: 'USD',
          transactionDate: '2026-10-20',
          deletedAt: '2026-10-21',
        },
      },
    ],
  } as never);
  await openScreen();
  expect(screen.getByText(/no vuelve a pendiente/)).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Confirmar Electricidad' }),
  ).not.toBeOnTheScreen();
});
test('fixed template requires explicit confirmation of its readonly exact amount', async () => {
  jest.mocked(readRecurringMonth).mockResolvedValue({
    ...screenData,
    items: [
      {
        ...screenData.items[0],
        template: {
          ...template,
          amountMode: 'FIXED',
          defaultAmountMinor: 100,
        },
      },
    ],
  });
  await openScreen();
  expect(screen.getByText(/Fijo confirmado como obligación/)).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar Electricidad' }),
  );
  expect(screen.getByLabelText('Importe real (USD)')).toHaveDisplayValue(
    '1.00',
  );
  expect(screen.getByLabelText('Importe real (USD)')).toBeDisabled();
  expect(
    screen.getByText(/Si cambió, no confirmes un importe incorrecto/),
  ).toBeOnTheScreen();
  expect(resolveRecurring).not.toHaveBeenCalled();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar importe real' }),
  );
  await screen.findByText('Electricidad');
  expect(resolveRecurring).toHaveBeenCalledWith(
    period,
    expect.objectContaining({ amountMode: 'FIXED' }),
    expect.objectContaining({
      form: expect.objectContaining({ amount: '1.00' }),
    }),
  );
});
test('duplicate taps blocked and late completion cannot repopulate a logged-out session', async () => {
  let done!: (value: never) => void;
  jest.mocked(resolveRecurring).mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const { client, rerender } = await openScreen();
  const user = await beginResolve();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar importe real' }),
  );
  expect(
    screen.getByRole('button', { name: 'Comprobar mismo gasto' }),
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
      <RecurringScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    done({} as never);
  });
  expect(resolveRecurring).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalled();
  expect(screen.queryByText('Electricidad')).not.toBeOnTheScreen();
});
test('focus refresh and month navigation reload recurring data', async () => {
  await openScreen();
  const before = jest.mocked(readRecurringMonth).mock.calls.length;
  await act(async () => {
    blur?.();
    blur = focus?.();
  });
  await waitFor(() =>
    expect(jest.mocked(readRecurringMonth).mock.calls.length).toBeGreaterThan(
      before,
    ),
  );
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Mes anterior' }));
  await waitFor(() =>
    expect(readRecurringMonth).toHaveBeenCalledWith(
      profile.id,
      '2026-09-01',
      expect.any(AbortSignal),
    ),
  );
});

test('a direct account switch discards pending identity and old completion cannot dismiss the new owner draft', async () => {
  let done!: (value: never) => void;
  jest.mocked(resolveRecurring).mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const { client, rerender } = await openScreen();
  const user = await beginResolve();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar importe real' }),
  );
  const second = { ...profile, id: 'f0050000-0000-4000-8000-000000000002' };
  const otherTemplate = {
    ...template,
    id: 'f1170000-0000-4000-8000-000000000002',
    ownerProfileId: second.id,
    name: 'Internet privado',
  };
  jest.mocked(readRecurringMonth).mockResolvedValue({
    ...screenData,
    period: { ...period, profile_id: second.id },
    items: [{ ...screenData.items[0], template: otherTemplate }],
  });
  isCurrentUser.mockImplementation((id) => id === second.id);
  jest.mocked(useAuth).mockReturnValue({
    ...jest.mocked(useAuth)(),
    state: {
      status: 'AUTHENTICATED_READY',
      userId: second.id,
      profile: second,
    },
  });
  await rerender(
    <QueryClientProvider client={client}>
      <RecurringScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    blur = focus?.();
  });
  await screen.findByText('Internet privado');
  expect(screen.queryByText('Electricidad')).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Comprobar operación pendiente' }),
  ).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Crear plantilla' }));
  await user.type(screen.getByLabelText('Nombre'), 'Nueva plantilla');
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  invalidate.mockClear();
  await act(async () => {
    done({} as never);
  });
  expect(screen.getByLabelText('Nombre')).toHaveDisplayValue('Nueva plantilla');
  expect(invalidate).not.toHaveBeenCalled();
});

test('past or future month never pre-fills a fictitious payment date to clear a commitment', async () => {
  const past = { ...period, starts_on: '2026-09-01', ends_on: '2026-09-30' };
  jest.mocked(currentMonth).mockReturnValue(past.starts_on);
  jest
    .mocked(readRecurringMonth)
    .mockResolvedValue({ ...screenData, period: past });
  await openScreen();
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Confirmar Electricidad' }),
  );
  expect(screen.getByLabelText('Fecha real (AAAA-MM-DD)')).toHaveDisplayValue(
    '',
  );
  expect(
    screen.getByText(/No lo registres con una fecha anterior/),
  ).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Importe real (USD)'), '1');
  await user.press(
    screen.getByRole('button', { name: 'Confirmar importe real' }),
  );
  expect(resolveRecurring).not.toHaveBeenCalled();
});

test('dashboard month parameter resets retained selection on re-entry without locking manual navigation', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ month: period.starts_on });
  await openScreen();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Mes anterior' }));
  await waitFor(() =>
    expect(readRecurringMonth).toHaveBeenLastCalledWith(
      profile.id,
      '2026-09-01',
      expect.any(AbortSignal),
    ),
  );
  await act(async () => {
    if (blur) blur();
  });
  await act(async () => {
    blur = focus?.();
  });
  await waitFor(() =>
    expect(readRecurringMonth).toHaveBeenLastCalledWith(
      profile.id,
      '2026-10-01',
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByText(/2026-10/)).toBeOnTheScreen();
});
test.each(['2026-13-01', '2026-09-02', ['2026-09-01', '2026-10-01']])(
  'malformed month deep link %s cannot select another period',
  async (month) => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ month });
    await openScreen();
    expect(readRecurringMonth).toHaveBeenLastCalledWith(
      profile.id,
      period.starts_on,
      expect.any(AbortSignal),
    );
  },
);
