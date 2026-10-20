import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { spacing } from '../../theme/tokens';
import { bucketLabels, formatMoney } from './budget-setup';
import {
  consumptionErrorMessage,
  consumptionKey,
  readBucketConsumption,
} from './consumption-data';

export function BucketConsumption({
  profileId,
  periodId,
  currency,
  refreshingPlan = false,
}: {
  profileId: string;
  periodId: string;
  currency: string;
  refreshingPlan?: boolean;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: consumptionKey(profileId, periodId),
    queryFn: ({ signal }) => readBucketConsumption(periodId, currency, signal),
  });
  useFocusEffect(
    useCallback(() => {
      void client.invalidateQueries({
        queryKey: consumptionKey(profileId, periodId),
      });
    }, [client, profileId, periodId]),
  );
  if (query.isPending || query.isFetching || refreshingPlan)
    return (
      <AppText role="progressbar" aria-label="Actualizando consumo" aria-busy>
        Actualizando gastos por fondo…
      </AppText>
    );
  if (query.isError)
    return (
      <View style={{ gap: spacing.sm }}>
        <AppText role="alert" tone="danger">
          {consumptionErrorMessage(query.error)}
        </AppText>
        <Button
          onPress={() => {
            void query.refetch();
          }}
        >
          Reintentar consumo
        </Button>
      </View>
    );
  return (
    <View style={{ gap: spacing.sm }}>
      <AppText variant="section">Gastos por fondo</AppText>
      <AppText>Total gastado: {formatMoney(query.data.totalSpent)}</AppText>
      {query.data.buckets.map((item) => (
        <AppText key={item.budgetBucketId}>
          {item.systemKey ? bucketLabels[item.systemKey] : item.name}: gastado{' '}
          {formatMoney(item.spentAmount)}
        </AppText>
      ))}
      {query.data.buckets.length === 0 && (
        <AppText>Aún no hay fondos con gastos en este período.</AppText>
      )}
      <AppText>
        Solo gastos personales registrados, sin movimientos de ahorro ni
        registros eliminados. No es un saldo restante ni dinero seguro para
        gastar.
      </AppText>
    </View>
  );
}
