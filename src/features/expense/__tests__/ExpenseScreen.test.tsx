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
import { ExpenseEditor, ExpenseScreen } from '../ExpenseScreen';
import {
  readExpenseMonth,
  registerExpense,
  expenseOwnerKey,
} from '../expense-data';
import { useAuth } from '../../auth/AuthProvider';
import { period, profile, request, category, bucket } from './fixtures';
import { currentMonth } from '../../budget/budget-setup';
import { financialDate } from '../../income/income-form';
jest.mock('../expense-data', () => ({
  ...jest.requireActual('../expense-data'),
  readExpenseMonth: jest.fn(),
  registerExpense: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
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
  buckets: [bucket],
  allocations: [],
  categories: [category],
};
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
  jest.mocked(readExpenseMonth).mockResolvedValue(data);
  jest.mocked(registerExpense).mockResolvedValue({} as never);
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
      <ExpenseScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    blur = focus?.();
  });
  await screen.findByText(/Gastos ·/);
  return { client, ...view };
}
async function beginExpense() {
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Registrar gasto' }));
  await user.type(screen.getByLabelText('Importe (USD)'), '123.45');
  await user.press(screen.getByRole('button', { name: 'Food' }));
  expect(screen.getByRole('button', { name: 'Food' })).toBeSelected();
  return user;
}
test('cancel discards unsaved input without writing', async () => {
  await openScreen();
  const user = await beginExpense();
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  await user.press(screen.getByRole('button', { name: 'Registrar gasto' }));
  expect(screen.getByLabelText('Importe (USD)')).toHaveDisplayValue('');
  expect(registerExpense).not.toHaveBeenCalled();
});
test('successful expense refreshes totals and returns to summary', async () => {
  const { client } = await openScreen();
  const actualKey = expenseOwnerKey(profile.id);
  client.setQueryData(actualKey, 100000);
  const user = await beginExpense();
  await user.press(screen.getByRole('button', { name: 'Guardar gasto' }));
  await screen.findByText(/Solo gastos en/);
  expect(registerExpense).toHaveBeenCalledTimes(1);
  expect(jest.mocked(registerExpense).mock.calls[0][1].form.amount).toBe(
    '123.45',
  );
  await waitFor(() =>
    expect(client.getQueryState(actualKey)?.isInvalidated).toBe(true),
  );
});
test('pending request blocks duplicate taps and survives leave/return', async () => {
  let resolve!: () => void;
  jest.mocked(registerExpense).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = () => done({} as never);
      }),
  );
  await openScreen();
  const user = await beginExpense();
  await user.press(screen.getByRole('button', { name: 'Guardar gasto' }));
  expect(
    screen.getByRole('button', { name: 'Comprobar mismo gasto' }),
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
  await screen.findByText(/Solo gastos en/);
  expect(registerExpense).toHaveBeenCalledTimes(1);
});
test('uncertain network result retries same identity after navigation', async () => {
  jest.mocked(registerExpense).mockRejectedValueOnce(new Error('network'));
  await openScreen();
  const user = await beginExpense();
  await user.press(screen.getByRole('button', { name: 'Guardar gasto' }));
  await screen.findByRole('alert');
  const first = jest.mocked(registerExpense).mock.calls[0][1];
  await user.press(screen.getByRole('button', { name: 'Cancelar' }));
  await user.press(
    screen.getByRole('button', { name: 'Comprobar registro pendiente' }),
  );
  await user.press(
    screen.getByRole('button', { name: 'Comprobar mismo gasto' }),
  );
  await screen.findByText(/Solo gastos en/);
  expect(jest.mocked(registerExpense).mock.calls[1][1]).toEqual(first);
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
  const user = await beginExpense();
  await user.press(screen.getByRole('button', { name: 'Guardar gasto' }));
  await screen.findByText(/Solo gastos en/);
  await user.press(screen.getByRole('button', { name: 'Registrar gasto' }));
  await user.type(screen.getByLabelText('Importe (USD)'), '55');
  await act(async () => {
    finishRefresh.forEach((resolve) => resolve());
  });
  expect(screen.getByLabelText('Importe (USD)')).toHaveDisplayValue('55');
});
test('changed identity blocks submission', async () => {
  await openScreen();
  const user = await beginExpense();
  isCurrentUser.mockReturnValue(false);
  await user.press(screen.getByRole('button', { name: 'Guardar gasto' }));
  await screen.findByRole('alert');
  expect(registerExpense).not.toHaveBeenCalled();
});
test('closed period has no new-registration action', async () => {
  jest
    .mocked(readExpenseMonth)
    .mockResolvedValue({ ...data, period: { ...period, status: 'CLOSED' } });
  await openScreen();
  expect(
    screen.queryByRole('button', { name: 'Registrar gasto' }),
  ).not.toBeOnTheScreen();
});
test('form rejects zero before invoking use case', async () => {
  const save = jest.fn();
  const client = new QueryClient();
  await render(
    <QueryClientProvider client={client}>
      <ExpenseEditor
        requestId={request.id}
        categories={[category]}
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
  await user.press(screen.getByRole('button', { name: 'Guardar gasto' }));
  await waitFor(() =>
    expect(screen.getByText(/Ingresa un importe positivo/)).toBeOnTheScreen(),
  );
  expect(save).not.toHaveBeenCalled();
});

test('returning after budget setup refreshes previously missing budget', async () => {
  jest.mocked(readExpenseMonth).mockResolvedValue({
    period: null,
    buckets: [],
    allocations: [],
    categories: [],
  });
  await openScreen();
  expect(screen.getByText(/Configura el presupuesto/)).toBeOnTheScreen();
  await act(async () => {
    blur?.();
  });
  jest.mocked(readExpenseMonth).mockResolvedValue(data);
  await act(async () => {
    blur = focus?.();
  });
  expect(await screen.findByText(/Solo gastos en/)).toBeOnTheScreen();
  expect(
    screen.getByRole('button', { name: 'Registrar gasto' }),
  ).toBeOnTheScreen();
});

test('uncertain request keeps its original period across month rollover', async () => {
  jest.mocked(registerExpense).mockRejectedValueOnce(new Error('network'));
  await openScreen();
  const user = await beginExpense();
  await user.press(screen.getByRole('button', { name: 'Guardar gasto' }));
  await screen.findByRole('alert');
  const first = jest.mocked(registerExpense).mock.calls[0];
  await act(async () => {
    blur?.();
  });
  jest.mocked(currentMonth).mockReturnValue('2026-11-01');
  jest.mocked(financialDate).mockReturnValue('2026-11-01');
  jest.mocked(readExpenseMonth).mockResolvedValue({
    period: null,
    buckets: [],
    allocations: [],
    categories: [],
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
    screen.getByRole('button', { name: 'Comprobar mismo gasto' }),
  );
  await screen.findByText(/Configura el presupuesto/);
  expect(jest.mocked(registerExpense).mock.calls[1]).toEqual(first);
});
