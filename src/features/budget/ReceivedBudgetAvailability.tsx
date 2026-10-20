import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import {
  calculateActualBudgetAllocation,
  type BudgetAllocationPlan,
} from '../../domain/budget/budget-allocation';
import { createMoney } from '../../domain/money/money';
import { readReceivedIncome, receivedIncomeKey } from '../income/income-data';
import { incomeErrorMessage } from '../income/income-form';
import { bucketLabels, formatMoney, type BudgetBucket } from './budget-setup';
import { spacing } from '../../theme/tokens';

export function ReceivedBudgetAvailability({
  profileId,
  plan,
  buckets,
  refreshingPlan = false,
}: {
  profileId: string;
  plan: BudgetAllocationPlan;
  buckets: readonly BudgetBucket[];
  refreshingPlan?: boolean;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: receivedIncomeKey(profileId, plan.budgetPeriodId),
    queryFn: ({ signal }) => readReceivedIncome(plan.budgetPeriodId, signal),
  });
  useFocusEffect(
    useCallback(() => {
      void client.invalidateQueries({
        queryKey: receivedIncomeKey(profileId, plan.budgetPeriodId),
      });
    }, [client, profileId, plan.budgetPeriodId]),
  );
  if (query.isPending || query.isFetching || refreshingPlan)
    return (
      <AppText role="progressbar" aria-busy>
        Actualizando distribución de ingresos recibidos…
      </AppText>
    );
  if (query.isError)
    return (
      <View style={{ gap: spacing.sm }}>
        <AppText role="alert" tone="danger">
          No se pudo calcular la distribución recibida.{' '}
          {incomeErrorMessage(query.error)}
        </AppText>
        <Button
          onPress={() => {
            void query.refetch();
          }}
        >
          Reintentar disponibilidad
        </Button>
      </View>
    );
  const actual = calculateActualBudgetAllocation(plan, query.data);
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="section">Distribución de ingresos recibidos</AppText>
      <AppText>
        Total recibido:{' '}
        {formatMoney(createMoney(query.data, plan.baseCurrency))}
      </AppText>
      {actual.map((item) => {
        const bucket = buckets.find(
          (entry) => entry.id === item.budgetBucketId,
        );
        const label = bucket?.system_key
          ? bucketLabels[bucket.system_key]
          : bucket?.name;
        return (
          <AppText key={item.budgetBucketId}>
            {label}: {formatMoney(item.allocatedAmount)}
            {bucket?.type === 'SAVINGS'
              ? ' · Asignado a ahorro, no a gasto libre'
              : ''}
          </AppText>
        );
      })}
      <AppText>
        Importes asignados por ingresos reales, antes de descontar gastos y
        compromisos. No son un saldo restante ni un cálculo de dinero seguro
        para gastar. El ahorro no se usa automáticamente para gastos.
      </AppText>
    </View>
  );
}
