import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { HistoryScreen } from '../HistoryScreen';
import { useAuth } from '../../auth/AuthProvider';
import { readHistory } from '../history-data';
import {
  correctTransaction,
  readCorrectionContext,
  readRevisionPage,
} from '../correction-data';
import { profile, period, category } from '../../expense/__tests__/fixtures';
import { target, context } from './correction-fixtures';
import { createTransaction } from '../../../domain/transaction/transaction';
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('../history-data', () => ({
  ...jest.requireActual('../history-data'),
  readHistory: jest.fn(),
}));
jest.mock('../correction-data', () => ({
  ...jest.requireActual('../correction-data'),
  readCorrectionContext: jest.fn(),
  readRevisionPage: jest.fn(),
  correctTransaction: jest.fn(),
}));
jest.mock('../../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'f1220000-0000-4000-8000-000000000999',
}));
jest.mock('../../budget/budget-setup', () => ({
  ...jest.requireActual('../../budget/budget-setup'),
  currentMonth: () => '2026-10-01',
}));
const tx = createTransaction({
  id: target.id,
  ownerProfileId: profile.id,
  budgetPeriodId: period.id,
  scope: 'PERSONAL',
  type: 'EXPENSE',
  amountMinor: target.amount_minor,
  currency: 'USD',
  transactionDate: target.transaction_date,
  categoryId: category.id,
  description: 'Lunch',
  deletedAt: null,
});
let currentOwner: string | null;
function authenticate(owner: string | null = profile.id) {
  currentOwner = owner;
  jest.mocked(useAuth).mockReturnValue({
    state: owner
      ? {
          status: 'AUTHENTICATED_READY',
          userId: owner,
          profile: { ...profile, id: owner },
        }
      : { status: 'SIGNED_OUT' },
    isCurrentUser: (id: string) => currentOwner === id,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    retry: jest.fn(),
    warning: null,
  } as ReturnType<typeof useAuth>);
}
beforeEach(() => {
  jest.clearAllMocks();
  authenticate();
  jest.mocked(readHistory).mockResolvedValue({
    items: [{ transaction: tx, categoryName: category.name }],
    nextCursor: null,
  });
  jest.mocked(readCorrectionContext).mockResolvedValue(context);
  jest
    .mocked(readRevisionPage)
    .mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(correctTransaction).mockImplementation(async (request) => ({
    ...request.target,
    ...request.changes,
    revision: request.target.revision + 1,
    deleted_at: request.action === 'DELETE' ? '2026-10-20T00:00:00Z' : null,
  }));
});
async function open() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  const element = (
    <QueryClientProvider client={client}>
      <HistoryScreen />
    </QueryClientProvider>
  );
  const view = await render(element);
  let cleanup: (() => void) | void;
  await act(async () => {
    cleanup = jest.mocked(useFocusEffect).mock.calls.at(-1)![0]();
  });
  await screen.findByText('Lunch');
  return {
    ...view,
    client,
    element,
    blur: async () => {
      await act(async () => {
        cleanup?.();
      });
    },
    focus: async () => {
      await act(async () => {
        cleanup = jest.mocked(useFocusEffect).mock.calls.at(-1)![0]();
      });
    },
  };
}
async function edit() {
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Ver y corregir' }));
  await screen.findByText('Corregir movimiento');
  await screen.findByText('Sin correcciones registradas.');
}
async function reviewDelete() {
  await edit();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Revisar eliminación' }));
}
test('edit requires explicit review/confirmation, sends exact amount/date and invalidates all financial families', async () => {
  const view = await open();
  const invalidate = jest.spyOn(view.client, 'invalidateQueries');
  await edit();
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Importe corregido'));
  await user.type(screen.getByLabelText('Importe corregido'), '200.01');
  await user.clear(screen.getByLabelText('Fecha corregida (AAAA-MM-DD)'));
  await user.type(
    screen.getByLabelText('Fecha corregida (AAAA-MM-DD)'),
    '2026-10-21',
  );
  await user.press(screen.getByRole('button', { name: 'Revisar corrección' }));
  expect(correctTransaction).not.toHaveBeenCalled();
  expect(screen.getByText(/Corrección: USD/)).toHaveTextContent(/200,01/);
  await user.press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  await screen.findByText(/Cambio confirmado/);
  expect(correctTransaction).toHaveBeenCalledTimes(1);
  expect(jest.mocked(correctTransaction).mock.calls[0][0]).toMatchObject({
    action: 'EDIT',
    target: { revision: 3, id: target.id },
    changes: { amount_minor: 20001, transaction_date: '2026-10-21' },
  });
  for (const key of [
    ['savings', profile.id],
    ['recurring', profile.id],
    ['history', profile.id],
    ['income', profile.id],
    ['expenses', profile.id],
    ['bucket-consumption', profile.id],
    ['budget-setup', profile.id, period.starts_on],
  ])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
});
test('cancelling review and then leaving the editor sends nothing', async () => {
  await open();
  await reviewDelete();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Cancelar cambio' }));
  expect(await screen.findByText('Corregir movimiento')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Volver al historial' }));
  expect(await screen.findByText('Lunch')).toBeOnTheScreen();
  expect(correctTransaction).not.toHaveBeenCalled();
});
test('recurring deletion explicitly confirms monthly cancellation, not merely payment deletion', async () => {
  jest.mocked(readCorrectionContext).mockResolvedValue({
    ...context,
    target: {
      ...target,
      recurring_template_id: 'f1170000-0000-4000-8000-000000000001',
      recurring_month: period.starts_on,
    },
  });
  await open();
  await reviewDelete();
  expect(
    screen.getByText(/CANCELA la obligación recurrente de este mes/),
  ).toBeOnTheScreen();
  expect(correctTransaction).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  await screen.findByText(/Cambio confirmado/);
  expect(jest.mocked(correctTransaction).mock.calls[0][0].action).toBe(
    'DELETE',
  );
});
test('deleted history offers guarded same-ID restoration with unchanged corrected amount', async () => {
  const deleted = '2026-10-20T00:00:00Z';
  jest.mocked(readHistory).mockResolvedValue({
    items: [
      {
        transaction: { ...tx, deletedAt: deleted },
        categoryName: category.name,
      },
    ],
    nextCursor: null,
  });
  jest.mocked(readCorrectionContext).mockResolvedValue({
    ...context,
    target: { ...target, deleted_at: deleted },
  });
  await open();
  const user = userEvent.setup();
  await user.press(
    screen.getByRole('button', { name: 'Ver movimientos eliminados' }),
  );
  await user.press(
    await screen.findByRole('button', { name: 'Ver y restaurar' }),
  );
  await user.press(
    await screen.findByRole('button', { name: 'Revisar restauración' }),
  );
  expect(
    screen.getByText(/Se restaurará el mismo movimiento/),
  ).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  await screen.findByText(/Cambio confirmado/);
  expect(jest.mocked(correctTransaction).mock.calls[0][0]).toMatchObject({
    action: 'RESTORE',
    target: { id: target.id, amount_minor: target.amount_minor },
    changes: null,
  });
});
test('closed period shows history but no new edit/delete/restore action', async () => {
  jest
    .mocked(readCorrectionContext)
    .mockResolvedValue({ ...context, period: { ...period, status: 'CLOSED' } });
  await open();
  await edit();
  expect(screen.getByText(/Este período está cerrado/)).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Revisar corrección' }),
  ).not.toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Revisar eliminación' }),
  ).not.toBeOnTheScreen();
});
test.each([
  ['Importe corregido', '0'],
  ['Fecha corregida (AAAA-MM-DD)', '2026-11-01'],
])('validation blocks invalid %s', async (label, value) => {
  await open();
  await edit();
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText(label));
  await user.type(screen.getByLabelText(label), value);
  await user.press(screen.getByRole('button', { name: 'Revisar corrección' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    /Revisa el importe positivo/,
  );
  expect(correctTransaction).not.toHaveBeenCalled();
});
test('unknown outcome retains exact request after cancel, month navigation and refocus', async () => {
  jest.mocked(correctTransaction).mockRejectedValueOnce(new Error('network'));
  const view = await open();
  await reviewDelete();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Comprobar la misma operación' }),
    ).toBeEnabled(),
  );
  const original = jest.mocked(correctTransaction).mock.calls[0][0];
  await user.press(screen.getByRole('button', { name: 'Volver al historial' }));
  await user.press(screen.getByRole('button', { name: 'Mes anterior' }));
  await view.blur();
  await view.focus();
  await user.press(
    await screen.findByRole('button', {
      name: 'Comprobar corrección pendiente',
    }),
  );
  jest
    .mocked(readCorrectionContext)
    .mockRejectedValue(new Error('read unavailable'));
  await user.press(
    await screen.findByRole('button', { name: 'Comprobar la misma operación' }),
  );
  await screen.findByText(/Cambio confirmado/);
  expect(correctTransaction).toHaveBeenCalledTimes(2);
  expect(jest.mocked(correctTransaction).mock.calls[1][0]).toEqual(original);
});
test('pending repeated confirmation is disabled and cancellation does not imply rollback', async () => {
  let resolve!: (value: typeof target) => void;
  jest.mocked(correctTransaction).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await open();
  await reviewDelete();
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  expect(
    screen.getByRole('button', { name: 'Comprobar la misma operación' }),
  ).toBeDisabled();
  await user.press(
    screen.getByRole('button', { name: 'Comprobar la misma operación' }),
  );
  expect(correctTransaction).toHaveBeenCalledTimes(1);
  await user.press(screen.getByRole('button', { name: 'Volver al historial' }));
  expect(
    await screen.findByRole('button', {
      name: 'Comprobar corrección pendiente',
    }),
  ).toBeOnTheScreen();
  await act(async () =>
    resolve({ ...target, revision: 4, deleted_at: '2026-10-20T00:00:00Z' }),
  );
  expect(screen.queryByText(/Cambio confirmado/)).not.toBeOnTheScreen();
  expect(await screen.findByText('Historial personal')).toBeOnTheScreen();
});
test('blur dismisses unsent review and late successful result never reopens old selection', async () => {
  const view = await open();
  await reviewDelete();
  await view.blur();
  expect(await screen.findByText('Historial personal')).toBeOnTheScreen();
  expect(correctTransaction).not.toHaveBeenCalled();
  await view.focus();
  await reviewDelete();
  let resolve!: (value: typeof target) => void;
  jest.mocked(correctTransaction).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  await view.blur();
  await act(async () => resolve({ ...target, revision: 4 }));
  expect(screen.queryByText(/Cambio confirmado/)).not.toBeOnTheScreen();
  expect(screen.queryByText('Confirmar cambio')).not.toBeOnTheScreen();
});
test('known stale rejection discards pending identity and asks to reload without automatic replay', async () => {
  jest
    .mocked(correctTransaction)
    .mockRejectedValue({ code: '40001', message: 'private internals' });
  await open();
  await reviewDelete();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  expect(await screen.findByText(/El movimiento cambió/)).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Comprobar corrección pendiente' }),
  ).not.toBeOnTheScreen();
  expect(screen.queryByText(/private internals/)).not.toBeOnTheScreen();
  expect(correctTransaction).toHaveBeenCalledTimes(1);
});
test('auth change clears pending/private editor and late response never invalidates old owner cache', async () => {
  let resolve!: (value: typeof target) => void;
  jest.mocked(correctTransaction).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = await open();
  await reviewDelete();
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Confirmar cambio' }));
  const invalidation = jest.spyOn(view.client, 'invalidateQueries');
  invalidation.mockClear();
  authenticate(null);
  await view.rerender(
    <QueryClientProvider client={view.client}>
      <HistoryScreen />
    </QueryClientProvider>,
  );
  await act(async () => resolve({ ...target, revision: 4 }));
  expect(screen.queryByText('Lunch')).not.toBeOnTheScreen();
  expect(
    screen.queryByText('Comprobar operación pendiente'),
  ).not.toBeOnTheScreen();
  expect(invalidation).not.toHaveBeenCalled();
});
test('refreshing detail hides cached private amount and action buttons', async () => {
  const view = await open();
  await edit();
  jest
    .mocked(readCorrectionContext)
    .mockImplementation(() => new Promise(() => {}));
  await act(async () => {
    void view.client.invalidateQueries({
      queryKey: ['history', profile.id, 'transaction', target.id],
    });
  });
  expect(await screen.findByText('Actualizando movimiento…')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Importe corregido')).not.toBeOnTheScreen();
});
