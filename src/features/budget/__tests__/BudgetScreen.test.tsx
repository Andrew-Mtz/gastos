import { MonthlyBudgetImpact } from '../MonthlyBudgetImpact';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { BudgetScreen, SetupEditor } from '../BudgetScreen';
import {
  prepareBudgetBuckets,
  readBudget,
  saveInitialBudget,
} from '../budget-data';
import { useAuth } from '../../auth/AuthProvider';
import { buckets } from './fixtures';
import { readReceivedIncome } from '../../income/income-data';
import {
  readBucketConsumption,
  consumptionOwnerKey,
} from '../consumption-data';
import { createMoney } from '../../../domain/money/money';
jest.mock('../MonthlyBudgetImpact', () => ({
  MonthlyBudgetImpact: jest.fn(() => null),
}));
jest.mock('../consumption-data', () => ({
  ...jest.requireActual('../consumption-data'),
  readBucketConsumption: jest.fn(),
}));
jest.mock('../budget-data', () => ({
  ...jest.requireActual('../budget-data'),
  readBudget: jest.fn(),
  prepareBudgetBuckets: jest.fn(),
  saveInitialBudget: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('../../income/income-data', () => ({
  ...jest.requireActual('../../income/income-data'),
  readReceivedIncome: jest.fn(),
}));
jest.mock('../SafeToSpend', () => ({ SafeToSpend: jest.fn(() => null) }));
const save = jest.fn<Promise<void>, [unknown]>();
const cancel = jest.fn();
const emptyBudget = { period: null, buckets: [], allocations: [] };
let focus: (() => void | (() => void)) | undefined;
const profile = {
  id: buckets[0].profile_id,
  display_name: 'Test',
  base_currency: 'USD',
  timezone: 'UTC',
  created_at: '',
  updated_at: '',
};
const isCurrentUser = jest.fn(() => true);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readReceivedIncome).mockResolvedValue(143000);
  jest
    .mocked(readBucketConsumption)
    .mockResolvedValue({ totalSpent: createMoney(0, 'USD'), buckets: [] });
  save.mockResolvedValue(undefined);
  isCurrentUser.mockReturnValue(true);
  jest.mocked(readBudget).mockResolvedValue(emptyBudget);
  jest.mocked(prepareBudgetBuckets).mockResolvedValue(buckets);
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
async function editor() {
  return render(
    <SetupEditor
      month="2026-10-01"
      currency="USD"
      buckets={buckets}
      expectedIncome={150000}
      onCancel={cancel}
      onSave={save}
    />,
  );
}
async function budget() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const result = await render(
    <QueryClientProvider client={client}>
      <BudgetScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    focus?.();
  });
  await screen.findByRole('button', { name: 'Configurar presupuesto' });
  return { client, ...result };
}
test('shows exact suggested percentages and expected amounts before any save', async () => {
  await editor();
  expect(screen.getByText(/Necesidades: 50.00%/)).toHaveTextContent(/750,00/);
  expect(save).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Ahorrador' }));
  expect(screen.getByText(/Ahorro: 30.00%/)).toHaveTextContent(/450,00/);
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Ahorro intensivo' }));
  expect(screen.getByText(/Ahorro: 40.00%/)).toHaveTextContent(/600,00/);
  expect(screen.getByText(/no registra ingresos recibidos/)).toBeOnTheScreen();
});
test('custom percentages must sum to 100 before saving', async () => {
  await editor();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Personalizado' }));
  await user.clear(screen.getByLabelText('Necesidades (%)'));
  await user.type(screen.getByLabelText('Necesidades (%)'), '40');
  expect(
    screen.getByRole('button', { name: 'Guardar presupuesto' }),
  ).toBeDisabled();
  await user.clear(screen.getByLabelText('Ahorro (%)'));
  await user.type(screen.getByLabelText('Ahorro (%)'), '30');
  expect(
    screen.getByRole('button', { name: 'Guardar presupuesto' }),
  ).toBeEnabled();
  await user.press(screen.getByRole('button', { name: 'Guardar presupuesto' }));
  expect(save).toHaveBeenCalledWith({
    expectedIncome: '1500.00',
    NEEDS: '40',
    LEISURE: '30',
    SAVINGS: '30',
  });
});
test('cancellation never submits and reopening resets unsaved choices', async () => {
  const view = await editor();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Ahorrador' }));
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  await view.unmount();
  await editor();
  expect(screen.getByRole('button', { name: 'Equilibrado' })).toBeSelected();
});
test('pending save blocks repeated submissions and cancel', async () => {
  let finish!: () => void;
  save.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await editor();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Guardar presupuesto' }));
  expect(
    screen.getByRole('button', { name: 'Guardar presupuesto' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Guardar presupuesto' }));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
  });
});
test('failed save keeps input and allows a sanitized retry', async () => {
  save.mockRejectedValueOnce(new Error('private database detail'));
  await editor();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Guardar presupuesto' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /Revisa tu conexión/,
  );
  expect(screen.queryByText('private database detail')).not.toBeOnTheScreen();
  expect(
    screen.getByLabelText('Ingreso esperado (USD, opcional)'),
  ).toHaveDisplayValue('1500.00');
  await user.press(screen.getByRole('button', { name: 'Guardar presupuesto' }));
  expect(save).toHaveBeenCalledTimes(2);
});
test('unknown estimate is visibly different from zero', async () => {
  await editor();
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Ingreso esperado (USD, opcional)'));
  expect(
    screen.getByText('Necesidades: 50.00% · Sin estimación'),
  ).toBeOnTheScreen();
  await user.type(
    screen.getByLabelText('Ingreso esperado (USD, opcional)'),
    '0',
  );
  expect(screen.getByText(/Necesidades: 50.00%/)).toHaveTextContent(/0,00/);
});
test('opening and cancelling setup has no save and repeated opening reuses preparation', async () => {
  await budget();
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Configurar presupuesto' }),
  );
  await screen.findByRole('button', { name: 'Cancelar' });
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  expect(saveInitialBudget).not.toHaveBeenCalled();
  await user.press(
    screen.getByRole('button', { name: 'Configurar presupuesto' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Equilibrado' }),
  ).toBeSelected();
});
test('leaving and returning while preparation is pending cannot reopen a dismissed editor', async () => {
  let finish!: (value: typeof buckets) => void;
  jest.mocked(prepareBudgetBuckets).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await budget();
  let blur: void | (() => void);
  await act(async () => {
    blur = focus?.();
  });
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Configurar presupuesto' }));
  await act(async () => {
    blur?.();
    focus?.();
    finish(buckets);
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Configurar presupuesto' }),
    ).toBeEnabled(),
  );
  expect(
    screen.queryByRole('button', { name: 'Cancelar' }),
  ).not.toBeOnTheScreen();
});
test('a late auth interruption cannot open the personal editor', async () => {
  let finish!: (value: typeof buckets) => void;
  jest.mocked(prepareBudgetBuckets).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await budget();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Configurar presupuesto' }));
  isCurrentUser.mockReturnValue(false);
  await act(async () => finish(buckets));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Configurar presupuesto' }),
    ).toBeEnabled(),
  );
  expect(
    screen.queryByRole('button', { name: 'Cancelar' }),
  ).not.toBeOnTheScreen();
});
test('query failures show a retry action rather than starting a fresh plan', async () => {
  jest.mocked(readBudget).mockRejectedValue(new Error('secret'));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <BudgetScreen />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole('button', { name: 'Reintentar' }),
  ).toBeOnTheScreen();
  expect(prepareBudgetBuckets).not.toHaveBeenCalled();
});
test('existing plan and closed period are read-only', async () => {
  jest.mocked(readBudget).mockResolvedValue({
    period: {
      id: 'a1060000-0000-4000-8000-000000000001',
      profile_id: profile.id,
      starts_on: '2026-10-01',
      ends_on: '2026-10-31',
      status: 'CLOSED',
      base_currency: 'USD',
      expected_income_minor: 10000,
    },
    buckets,
    allocations: buckets.map((bucket, index) => ({
      budget_period_id: 'a1060000-0000-4000-8000-000000000001',
      budget_bucket_id: bucket.id,
      percentage_basis_points: [5000, 3000, 2000][index],
    })),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <BudgetScreen />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Presupuesto guardado')).toBeOnTheScreen();
  expect(screen.getByText('Este período está cerrado.')).toBeOnTheScreen();
  expect(await screen.findByText(/Total recibido:/)).toHaveTextContent(
    /1.430,00/,
  );
  expect(screen.getByText(/Necesidades: 50.00%/)).toHaveTextContent(/50,00/);
  expect(screen.getByText(/Necesidades:.*715,00/)).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Configurar presupuesto' }),
  ).not.toBeOnTheScreen();
});
test('successful save refreshes owner-scoped data', async () => {
  const { client } = await budget();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Configurar presupuesto' }));
  await userEvent
    .setup()
    .press(await screen.findByRole('button', { name: 'Guardar presupuesto' }));
  await waitFor(() => expect(saveInitialBudget).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByRole('button', { name: 'Configurar presupuesto' }),
  ).toBeOnTheScreen();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: expect.arrayContaining(['budget-setup', profile.id]),
  });
});

test('late save success refreshes data without dismissing a newer draft', async () => {
  let finish!: () => void;
  jest.mocked(saveInitialBudget).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            id: 'a1060000-0000-4000-8000-000000000001',
            profile_id: profile.id,
            starts_on: '2026-10-01',
            ends_on: '2026-10-31',
            status: 'OPEN',
            base_currency: 'USD',
            expected_income_minor: null,
          });
      }),
  );
  const { client } = await budget();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  let blur: void | (() => void);
  await act(async () => {
    blur = focus?.();
  });
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Configurar presupuesto' }),
  );
  await user.press(
    await screen.findByRole('button', { name: 'Guardar presupuesto' }),
  );
  await act(async () => {
    blur?.();
    focus?.();
  });
  await user.press(
    screen.getByRole('button', { name: 'Configurar presupuesto' }),
  );
  await user.press(await screen.findByRole('button', { name: 'Ahorrador' }));
  invalidate.mockClear();
  await act(async () => {
    finish();
  });
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5));
  for (const prefix of ['recurring', 'savings', 'income', 'bucket-consumption'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [prefix, profile.id] });
  expect(screen.getByRole('button', { name: 'Ahorrador' })).toBeSelected();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeOnTheScreen();
});

test('refocus reloads period allocations before showing actual bucket amounts', async () => {
  let rootFocus: (() => void | (() => void)) | undefined;
  jest.mocked(useFocusEffect).mockImplementation((callback) => {
    rootFocus ??= callback;
  });
  const saved = {
    period: {
      id: 'a1100000-0000-4000-8000-000000000001',
      profile_id: profile.id,
      starts_on: '2026-10-01',
      ends_on: '2026-10-31',
      status: 'OPEN' as const,
      base_currency: 'USD',
      expected_income_minor: 150000,
    },
    buckets,
    allocations: buckets.map((bucket, index) => ({
      budget_period_id: 'a1100000-0000-4000-8000-000000000001',
      budget_bucket_id: bucket.id,
      percentage_basis_points: [5000, 3000, 2000][index],
    })),
  };
  jest.mocked(readBudget).mockResolvedValue(saved);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <BudgetScreen />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/Necesidades:.*715,00/)).toBeOnTheScreen();
  let finish!: (value: typeof saved) => void;
  jest.mocked(readBudget).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    rootFocus?.();
  });
  await screen.findAllByRole('progressbar');
  expect(screen.queryByText(/Total recibido:/)).not.toBeOnTheScreen();
  expect(
    screen.queryByText(/Ahorro protegido asignado:/),
  ).not.toBeOnTheScreen();
  await act(async () => {
    finish({
      ...saved,
      allocations: saved.allocations.map((item, index) => ({
        ...item,
        percentage_basis_points: [4500, 1500, 4000][index],
      })),
    });
  });
  expect(await screen.findByText(/Necesidades:.*643,50/)).toBeOnTheScreen();
  expect(screen.getByText(/Ahorro:.*572,00/)).toBeOnTheScreen();
  expect(screen.getByText(/Ahorro protegido asignado:/)).toHaveTextContent(
    /572,00/,
  );
  expect(screen.getByText(/Asignado a gasto ordinario:/)).toHaveTextContent(
    /858,00/,
  );
  expect(screen.getByText(/Necesidades: 45.00%/)).toHaveTextContent(/675,00/);
});

test('first expected-income digit, saving and reopening render without NumberFormat.formatToParts', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Intl.NumberFormat.prototype,
    'formatToParts',
  )!;
  Object.defineProperty(Intl.NumberFormat.prototype, 'formatToParts', {
    ...descriptor,
    value: undefined,
  });
  try {
    const view = await budget();
    const user = userEvent.setup();
    await user.press(
      screen.getByRole('button', { name: 'Configurar presupuesto' }),
    );
    const input = await screen.findByLabelText(
      'Ingreso esperado (USD, opcional)',
    );
    await user.type(input, '1');
    expect(screen.getByText(/Necesidades: 50.00%/)).toHaveTextContent(/0,50/);
    await user.type(input, '500');
    const period = {
      id: 'a1060000-0000-4000-8000-000000000001',
      profile_id: profile.id,
      starts_on: '2026-10-01',
      ends_on: '2026-10-31',
      status: 'OPEN' as const,
      base_currency: 'USD',
      expected_income_minor: 150000,
    };
    jest.mocked(readBudget).mockResolvedValue({
      period,
      buckets,
      allocations: buckets.map((bucket, index) => ({
        budget_period_id: period.id,
        budget_bucket_id: bucket.id,
        percentage_basis_points: [5000, 3000, 2000][index],
      })),
    });
    jest.mocked(saveInitialBudget).mockResolvedValue(period);
    await user.press(
      screen.getByRole('button', { name: 'Guardar presupuesto' }),
    );
    expect(await screen.findByText('Presupuesto guardado')).toBeOnTheScreen();
    expect(saveInitialBudget).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Necesidades: 50.00%/)).toHaveTextContent(/750,00/);
    expect(await screen.findByText(/Total recibido:/)).toHaveTextContent(
      /1.430,00/,
    );
    expect(screen.getByText(/Necesidades:.*715,00/)).toBeOnTheScreen();
    await view.unmount();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    await render(
      <QueryClientProvider client={client}>
        <BudgetScreen />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Presupuesto guardado')).toBeOnTheScreen();
    expect(screen.getByText(/Necesidades: 50.00%/)).toHaveTextContent(/750,00/);
    expect(await screen.findByText(/Total recibido:/)).toHaveTextContent(
      /1.430,00/,
    );
  } finally {
    Object.defineProperty(
      Intl.NumberFormat.prototype,
      'formatToParts',
      descriptor,
    );
  }
});

test('a period without active allocations still shows spending and manual refresh invalidates consumption', async () => {
  jest.mocked(readBudget).mockResolvedValue({
    period: {
      id: 'f1030000-0000-4000-8000-000000000001',
      profile_id: profile.id,
      starts_on: '2026-10-01',
      ends_on: '2026-10-31',
      status: 'OPEN',
      base_currency: 'USD',
      expected_income_minor: null,
    },
    buckets,
    allocations: [],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await render(
    <QueryClientProvider client={client}>
      <BudgetScreen />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Configurar presupuesto' });
  expect(MonthlyBudgetImpact).toHaveBeenCalledWith(
    expect.objectContaining({ owner: profile.id, refreshingPlan: false }),
    undefined,
  );
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Actualizar' }));
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: consumptionOwnerKey(profile.id),
  });
  expect(
    screen.queryByText(/Ahorro protegido asignado:/),
  ).not.toBeOnTheScreen();
});

test('snapshot-based impact is mounted beside protected received allocation, and logout hides both', async () => {
  jest.mocked(readBudget).mockResolvedValue({
    period: {
      id: 'f1140000-0000-4000-8000-000000000001',
      profile_id: profile.id,
      starts_on: '2026-10-01',
      ends_on: '2026-10-31',
      status: 'OPEN',
      base_currency: 'USD',
      expected_income_minor: 999999,
    },
    buckets,
    allocations: buckets.map((bucket, index) => ({
      budget_period_id: 'f1140000-0000-4000-8000-000000000001',
      budget_bucket_id: bucket.id,
      percentage_basis_points: [5000, 3000, 2000][index],
    })),
  });
  jest.mocked(readReceivedIncome).mockResolvedValue(150000);
  jest.mocked(readBucketConsumption).mockResolvedValue({
    totalSpent: createMoney(160000, 'USD'),
    buckets: [],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <BudgetScreen />
    </QueryClientProvider>
  );
  const view = await render(tree());
  await screen.findByText(/Presupuesto guardado/);
  expect(MonthlyBudgetImpact).toHaveBeenCalledWith(
    expect.objectContaining({ owner: profile.id, refreshingPlan: false }),
    undefined,
  );
  expect(
    await screen.findByText(/Ahorro protegido asignado:/),
  ).toHaveTextContent(/300,00/);
  expect(screen.getByText(/Asignado a gasto ordinario:/)).toHaveTextContent(
    /1.200,00/,
  );
  expect(screen.getByText(/No son un saldo restante/)).toBeOnTheScreen();
  jest.mocked(useAuth).mockReturnValue({
    ...jest.mocked(useAuth)(),
    state: { status: 'UNAUTHENTICATED' },
  });
  await view.rerender(tree());
  expect(
    screen.queryByText(/Ahorro protegido asignado:/),
  ).not.toBeOnTheScreen();
});
