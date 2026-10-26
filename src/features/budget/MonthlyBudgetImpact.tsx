import { useCallback, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { dashboardKey, readDashboard } from '../dashboard/dashboard-data';
import { bucketLabels, formatMoney } from './budget-setup';
import { safeToSpendErrorMessage } from './safe-to-spend-data';
import { SafeToSpendSummary } from './SafeToSpend';
import {
  SharedResponsibilities,
  SharedResponsibilitiesSummary,
} from './SharedResponsibilities';

export function MonthlyBudgetImpact(props: {
  owner: string;
  month: string;
  refreshingPlan?: boolean;
}) {
  return <MonthlyImpact key={`${props.owner}/${props.month}`} {...props} />;
}
function MonthlyImpact({
  owner,
  month,
  refreshingPlan,
}: {
  owner: string;
  month: string;
  refreshingPlan?: boolean;
}) {
  const client = useQueryClient();
  const [visible, setVisible] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const resume = () => {
        void client.invalidateQueries({
          queryKey: dashboardKey(owner, month),
          exact: true,
        });
        setVisible(true);
      };
      const hide = () => {
        setVisible(false);
        void client.cancelQueries({
          queryKey: dashboardKey(owner, month),
          exact: true,
        });
      };
      if (
        AppState.currentState !== 'background' &&
        AppState.currentState !== 'inactive'
      )
        resume();
      const listener = AppState.addEventListener('change', (state) =>
        state === 'active' ? resume() : hide(),
      );
      return () => {
        listener.remove();
        hide();
      };
    }, [client, owner, month]),
  );
  const query = useQuery({
    queryKey: dashboardKey(owner, month),
    queryFn: ({ signal }) => readDashboard(owner, month, signal),
    enabled: visible,
    retry: false,
    refetchOnMount: 'always',
  });
  if (!visible) return null;
  if (
    query.isPending ||
    query.isFetching ||
    !query.isFetchedAfterMount ||
    refreshingPlan
  )
    return <LoadingState label="Actualizando consumo y margen…" />;
  if (query.isError)
    return (
      <View>
        <ErrorState
          message={safeToSpendErrorMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
        <SharedResponsibilities owner={owner} month={month} />
      </View>
    );
  const data = query.data;
  return (
    <View style={{ gap: 8 }}>
      {data.sharedResponsibilities && (
        <SharedResponsibilitiesSummary
          data={data.sharedResponsibilities}
          onRefresh={() => {
            void query.refetch();
          }}
        />
      )}
      {data.period && (
        <>
          <AppText variant="section">Gastos por fondo</AppText>
          {data.usage.map((bucket) => (
            <AppText key={bucket.budgetBucketId}>
              {bucket.systemKey ? bucketLabels[bucket.systemKey] : bucket.name}:
              gastado {formatMoney(bucket.spentAmount)}
            </AppText>
          ))}
          <AppText>
            Incluye gastos personales y tu responsabilidad del hogar, sin
            duplicarla. No incluye movimientos de ahorro ni registros
            eliminados.
          </AppText>
          <SafeToSpendSummary period={data.period} data={data.availability} />
        </>
      )}
      <Button
        variant="text"
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar consumo y margen
      </Button>
    </View>
  );
}
