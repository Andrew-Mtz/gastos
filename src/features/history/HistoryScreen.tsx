import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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
  readHistory,
  shiftMonth,
  type HistoryCursor,
} from './history-data';
import { spacing } from '../../theme/tokens';

const labels: Record<Transaction['type'], string> = {
  INCOME: 'Ingreso',
  EXPENSE: 'Gasto',
  SAVINGS_CONTRIBUTION: 'Aporte a ahorro',
  SAVINGS_WITHDRAWAL: 'Retiro de ahorro',
};
export function HistoryScreen() {
  const auth = useAuth();
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalHistory key={auth.state.userId} profile={auth.state.profile} />
  );
}
function PersonalHistory({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const query = useInfiniteQuery({
    queryKey: historyKey(profile.id, month),
    initialPageParam: null as HistoryCursor | null,
    queryFn: ({ pageParam, signal }) =>
      readHistory(profile.id, month, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
  });
  useFocusEffect(
    useCallback(() => {
      void client.invalidateQueries({
        queryKey: historyKey(profile.id, month),
      });
    }, [client, profile.id, month]),
  );
  return (
    <Screen scroll>
      <AppText variant="title">Historial personal</AppText>
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
            <AppText>No hay movimientos en este mes.</AppText>
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
