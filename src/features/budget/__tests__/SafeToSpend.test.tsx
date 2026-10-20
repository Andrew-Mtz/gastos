import { act, render, screen, userEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { calculateSafeToSpend } from '../../../domain/budget/safe-to-spend';
import { formatMoney } from '../budget-setup';
import { createMoney } from '../../../domain/money/money';
import { SafeToSpend } from '../SafeToSpend';
import { readSafeToSpend, safeToSpendKey } from '../safe-to-spend-data';
import { recurringOwnerKey } from '../../recurring/recurring-data';
import { period, profile } from '../../recurring/__tests__/fixtures';
jest.mock('../safe-to-spend-data', () => ({
  ...jest.requireActual('../safe-to-spend-data'),
  readSafeToSpend: jest.fn(),
}));
jest.mock('../../../infrastructure/supabase/client', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn() },
}));
function result(
  unknownCount = 0,
  priorUnresolvedCount = 0,
  configured = true,
  spentMinor = 100,
) {
  return {
    ...calculateSafeToSpend({
      configured,
      savings: {
        openingProtectedMinor: 0,
        allocatedSavingsMinor: 200,
        contributionsMinor: 0,
        withdrawalsMinor: 0,
        spendableAllocatedMinor: 800,
        spentMinor,
      },
      commitments: {
        currency: 'USD',
        priorUnresolvedCount,
        buckets: [
          {
            budgetBucketId: 'f1040000-0000-4000-8000-000000000001',
            confirmedMinor: 200,
            estimatedMinor: 0,
            confirmedCount: 1,
            estimatedCount: 1,
            unknownCount,
          },
        ],
      },
    }),
    components: {
      budget_period_id: period.id,
      base_currency: 'USD',
      configured,
      snapshot_version: 2 as const,
      carry: {
        incoming_minor: 0,
        outgoing_minor: 0,
        unallocated_minor: 0,
        buckets: [] as { budget_bucket_id: string; amount_minor: number }[],
      },
      opening_protected_minor: 0,
      allocated_savings_minor: 200,
      contributions_minor: 0,
      withdrawals_minor: 0,
      spendable_allocated_minor: 800,
      spent_minor: spentMinor,
      goal_reserved_minor: 0,
      unassigned_savings_minor: 200,
    },
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.mocked(readSafeToSpend).mockResolvedValue(result());
});
afterEach(() => jest.useRealTimers());
async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <SafeToSpend period={period} />
    </QueryClientProvider>,
  );
  await screen.findByText('Margen mensual para gastar');
  return { client, ...view };
}
test('honest monthly labels, zero estimates, traceable formula and relevant navigation', async () => {
  await open();
  expect(
    screen.getByText(
      `Margen antes de estimaciones: ${formatMoney(createMoney(500, 'USD'))}`,
    ),
  ).toBeOnTheScreen();
  expect(
    screen.getByText(
      `Margen estimado tras estimaciones conocidas: aproximadamente ${formatMoney(createMoney(500, 'USD'))}. No es dinero garantizado.`,
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText(/no saldo bancario ni garantía/)).toBeOnTheScreen();
  expect(
    screen.getByText(
      /Los movimientos de metas ya están incluidos una sola vez/,
    ),
  ).toBeOnTheScreen();
  await userEvent
    .setup()
    .press(
      screen.getByRole('button', { name: 'Revisar obligaciones recurrentes' }),
    );
  expect(router.push).toHaveBeenCalledWith({
    pathname: '/recurring',
    params: { month: period.starts_on },
  });
});
test.each([
  [1, 0, true],
  [0, 2, true],
  [0, 0, false],
] as const)(
  'withholds margins for unknown %s, prior %s, configured %s',
  async (unknown, prior, configured) => {
    jest
      .mocked(readSafeToSpend)
      .mockResolvedValue(result(unknown, prior, configured));
    await open();
    expect(screen.getByText(/Margen no disponible/)).toBeOnTheScreen();
    expect(
      screen.queryByText(/Margen antes de estimaciones:/),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText(/Margen estimado tras/)).not.toBeOnTheScreen();
    expect(
      screen.getByText(
        `Menos gastos registrados: ${formatMoney(createMoney(100, 'USD'))}`,
      ),
    ).toBeOnTheScreen();
    if (prior)
      expect(screen.getByText(/no cambies su fecha real/)).toBeOnTheScreen();
    if (unknown)
      expect(screen.getByText(/no se tratarán como cero/)).toBeOnTheScreen();
    if (!configured)
      expect(screen.getByText(/Configura la distribución/)).toBeOnTheScreen();
  },
);
test('negative honest result does not become zero or consume protected savings', async () => {
  jest.mocked(readSafeToSpend).mockResolvedValue(result(0, 0, true, 900));
  await open();
  expect(
    screen.getByText(
      `Margen antes de estimaciones: ${formatMoney(createMoney(-300, 'USD'))}`,
    ),
  ).toBeOnTheScreen();
});
test('owner mutation invalidation hides stale figures through pending refresh and failure; explicit retry recovers', async () => {
  const { client } = await open();
  let reject!: (error: Error) => void;
  jest.mocked(readSafeToSpend).mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  await act(async () => {
    void client.invalidateQueries({ queryKey: recurringOwnerKey(profile.id) });
  });
  await screen.findByText('Actualizando margen mensual…');
  expect(
    screen.queryByText(/Margen antes de estimaciones:/),
  ).not.toBeOnTheScreen();
  await act(async () => {
    reject(new Error('offline'));
  });
  await screen.findByText(/No se considerarán cero/);
  expect(
    screen.queryByText(/Margen antes de estimaciones:/),
  ).not.toBeOnTheScreen();
  jest.mocked(readSafeToSpend).mockResolvedValue(result());
  await userEvent
    .setup()
    .press(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText(
    `Margen antes de estimaciones: ${formatMoney(createMoney(500, 'USD'))}`,
  );
});
test('plan refresh and owner/month change hide cached figures, focus refreshes current exact key', async () => {
  const { client, rerender } = await open();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const focus = jest.mocked(useFocusEffect).mock.calls.at(-1)![0];
  await act(async () => {
    focus();
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: safeToSpendKey(profile.id, period.id),
  });
  await rerender(
    <QueryClientProvider client={client}>
      <SafeToSpend period={period} refreshingPlan />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByText(/Margen antes de estimaciones:/),
  ).not.toBeOnTheScreen();
  jest.mocked(readSafeToSpend).mockImplementation(() => new Promise(() => {}));
  const other = {
    ...period,
    id: profile.id,
    profile_id: period.id,
    starts_on: '2026-11-01',
    ends_on: '2026-11-30',
  };
  await rerender(
    <QueryClientProvider client={client}>
      <SafeToSpend period={other} />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByText(/Margen antes de estimaciones:/),
  ).not.toBeOnTheScreen();
  expect(readSafeToSpend).toHaveBeenLastCalledWith(
    other,
    expect.any(AbortSignal),
  );
});
