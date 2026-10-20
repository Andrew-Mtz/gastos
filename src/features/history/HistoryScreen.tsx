import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import { currentMonth, formatMoney } from '../budget/budget-setup';
import {
  transactionMoney,
  type Transaction,
} from '../../domain/transaction/transaction';
import {
  historyKey,
  monthSchema,
  readHistory,
  shiftMonth,
  type HistoryCursor,
} from './history-data';
import { spacing } from '../../theme/tokens';
import { CorrectionDialog } from './CorrectionDialog';
import {
  correctTransaction,
  correctionErrorMessage,
  isRejectedCorrection,
  type CorrectionRequest,
} from './correction-data';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { savingsOwnerKey } from '../savings/savings-data';
import { incomeOwnerKey } from '../income/income-data';
import { expenseOwnerKey } from '../expense/expense-data';
import { consumptionOwnerKey } from '../budget/consumption-data';
import { budgetKey } from '../budget/budget-data';
import { historyOwnerKey } from './history-data';

const labels: Record<Transaction['type'], string> = {
  INCOME: 'Ingreso',
  EXPENSE: 'Gasto',
  SAVINGS_CONTRIBUTION: 'Aporte a ahorro',
  SAVINGS_WITHDRAWAL: 'Retiro de ahorro',
};
export function HistoryScreen() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ month?: string }>();
  const target = monthSchema.safeParse(params.month);
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalHistory
      key={auth.state.userId}
      profile={auth.state.profile}
      requestedMonth={target.success ? target.data : undefined}
    />
  );
}
function PersonalHistory({
  profile,
  requestedMonth,
}: {
  profile: Profile;
  requestedMonth?: string;
}) {
  const client = useQueryClient();
  const auth = useAuth();
  const [deleted, setDeleted] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const selection = useRef<string | null>(null);
  const active = useRef(false);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CorrectionRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => {
    setSelected(null);
    selection.current = null;
  };
  const select = (id: string) => {
    selection.current = id;
    setSelected(id);
    setNotice(null);
  };
  const refreshFinancials = async (request: CorrectionRequest) => {
    await Promise.all(
      [
        recurringOwnerKey(profile.id),
        savingsOwnerKey(profile.id),
        historyOwnerKey(profile.id),
        incomeOwnerKey(profile.id),
        expenseOwnerKey(profile.id),
        consumptionOwnerKey(profile.id),
        budgetKey(
          profile.id,
          `${request.target.transaction_date.slice(0, 7)}-01`,
        ),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  const save = async (request: CorrectionRequest) => {
    if (!active.current || !auth.isCurrentUser(profile.id))
      throw { code: '42501' };
    if (inFlight.current) throw new Error('A correction is already pending.');
    inFlight.current = true;
    setBusy(true);
    setPending(request);
    try {
      await correctTransaction(request);
      if (auth.isCurrentUser(profile.id)) {
        setPending((value) => (value?.id === request.id ? null : value));
        if (active.current && selection.current === request.target.id) {
          close();
          setNotice(
            'Cambio confirmado. El historial conserva la versión anterior.',
          );
        }
        await refreshFinancials(request);
      }
    } catch (error) {
      if (auth.isCurrentUser(profile.id) && isRejectedCorrection(error)) {
        setPending((value) => (value?.id === request.id ? null : value));
        if (active.current && selection.current === request.target.id) {
          close();
          setNotice(correctionErrorMessage(error));
        }
        await refreshFinancials(request);
      }
      throw error;
    } finally {
      inFlight.current = false;
      if (auth.isCurrentUser(profile.id)) setBusy(false);
    }
  };
  const [month, setMonth] = useState(
    () => requestedMonth ?? currentMonth(profile.timezone),
  );
  const selectedMonth = useRef(month);
  useEffect(() => {
    selectedMonth.current = month;
  }, [month]);
  const query = useInfiniteQuery({
    queryKey: historyKey(profile.id, month, deleted),
    initialPageParam: null as HistoryCursor | null,
    queryFn: ({ pageParam, signal }) =>
      deleted
        ? readHistory(profile.id, month, pageParam, signal, true)
        : readHistory(profile.id, month, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
  });
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      const targetMonth = requestedMonth ?? selectedMonth.current;
      setMonth(targetMonth);
      void client.invalidateQueries({
        queryKey: historyKey(profile.id, targetMonth),
      });
      return () => {
        active.current = false;
        setSelected(null);
        selection.current = null;
        setNotice(null);
        void client.cancelQueries({ queryKey: historyOwnerKey(profile.id) });
      };
    }, [client, profile.id, requestedMonth]),
  );
  if (selected)
    return (
      <CorrectionDialog
        owner={profile.id}
        transactionId={selected}
        pending={pending?.target.id === selected ? pending : null}
        busy={busy}
        onCancel={close}
        onSave={save}
      />
    );
  return (
    <Screen scroll>
      <AppText variant="title">Historial personal</AppText>
      {notice && <AppText role="status">{notice}</AppText>}
      {pending && (
        <Button onPress={() => select(pending.target.id)}>
          Comprobar corrección pendiente
        </Button>
      )}
      <Button variant="secondary" onPress={() => setDeleted((value) => !value)}>
        {deleted ? 'Ver movimientos activos' : 'Ver movimientos eliminados'}
      </Button>
      {deleted && (
        <AppText>
          Los eliminados no participan en los cálculos. Restaurarlos requiere un
          mes abierto y conservar los fondos históricos.
        </AppText>
      )}
      <AppText variant="section">{month.slice(0, 7)}</AppText>
      <Button
        variant="secondary"
        disabled={month === '0001-01-01'}
        onPress={() => setMonth((value) => shiftMonth(value, -1))}
      >
        Mes anterior
      </Button>
      <Button
        variant="secondary"
        disabled={month === '9999-12-01'}
        onPress={() => setMonth((value) => shiftMonth(value, 1))}
      >
        Mes siguiente
      </Button>
      <Button
        variant="secondary"
        onPress={() => setMonth(currentMonth(profile.timezone))}
      >
        Mes actual
      </Button>
      {query.isPending || (query.isFetching && !query.isFetchingNextPage) ? (
        <LoadingState label="Actualizando historial…" />
      ) : query.isError ? (
        <ErrorState
          message="No se pudo cargar el historial. Revisa tu conexión y sesión."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          {query.data.pages[0]?.items.length === 0 && (
            <AppText>
              {deleted
                ? 'No hay movimientos eliminados en este mes.'
                : 'No hay movimientos en este mes.'}
            </AppText>
          )}
          {query.data.pages
            .flatMap((page) => page.items)
            .map(({ transaction, categoryName }) => (
              <View key={transaction.id} style={{ gap: spacing.sm }}>
                <AppText variant="section">
                  {labels[transaction.type]} ·{' '}
                  {formatMoney(transactionMoney(transaction))}
                </AppText>
                <AppText>{transaction.transactionDate} · Personal</AppText>
                {categoryName && <AppText>Categoría: {categoryName}</AppText>}
                {deleted && <AppText>Eliminado</AppText>}
                <Button
                  variant="secondary"
                  disabled={pending !== null || busy}
                  onPress={() => select(transaction.id)}
                >
                  {deleted ? 'Ver y restaurar' : 'Ver y corregir'}
                </Button>
                {transaction.description && (
                  <AppText>{transaction.description}</AppText>
                )}
              </View>
            ))}
          {query.hasNextPage && (
            <Button
              loading={query.isFetchingNextPage}
              onPress={() => {
                void query.fetchNextPage();
              }}
            >
              Cargar más movimientos
            </Button>
          )}
        </>
      )}
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar historial
      </Button>
    </Screen>
  );
}
