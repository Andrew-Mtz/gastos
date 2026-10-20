import { useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { AppText } from '../../components/ui/AppText';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { formatMoney, type BudgetPeriod } from './budget-setup';
import {
  readSafeToSpend,
  safeToSpendErrorMessage,
  safeToSpendKey,
} from './safe-to-spend-data';

export function SafeToSpend({
  period,
  refreshingPlan = false,
}: {
  period: BudgetPeriod;
  refreshingPlan?: boolean;
}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: safeToSpendKey(period.profile_id, period.id),
    queryFn: ({ signal }) => readSafeToSpend(period, signal),
  });
  useFocusEffect(
    useCallback(() => {
      void client.invalidateQueries({
        queryKey: safeToSpendKey(period.profile_id, period.id),
      });
    }, [client, period.profile_id, period.id]),
  );
  if (query.isPending || query.isFetching || refreshingPlan)
    return <LoadingState label="Actualizando margen mensual…" />;
  if (query.isError)
    return (
      <ErrorState
        message={safeToSpendErrorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  const {
    components,
    commitments,
    confirmedMargin,
    estimatedMargin,
    configured,
  } = query.data;
  const money = (minor: number) =>
    formatMoney(createMoney(minor, period.base_currency));
  return (
    <>
      <AppText variant="section">Margen mensual para gastar</AppText>
      <AppText>
        Estado actual de {period.starts_on.slice(0, 7)}. Es presupuesto mensual,
        no saldo bancario ni garantía de solvencia.
      </AppText>
      {confirmedMargin ? (
        <AppText tone={confirmedMargin.amountMinor < 0 ? 'danger' : 'success'}>
          {commitments.estimatedCount > 0
            ? 'Margen antes de estimaciones'
            : 'Margen tras compromisos confirmados'}
          : {formatMoney(confirmedMargin)}
        </AppText>
      ) : (
        <AppText tone="warning">
          Margen no disponible: falta información para afirmar cuánto puedes
          gastar.
        </AppText>
      )}
      {estimatedMargin && (
        <AppText>
          Margen estimado tras estimaciones conocidas: aproximadamente{' '}
          {formatMoney(estimatedMargin)}. No es dinero garantizado.
        </AppText>
      )}
      {!configured && (
        <AppText tone="warning">
          Configura la distribución del presupuesto de este mes.
        </AppText>
      )}
      {commitments.unknownCount > 0 && (
        <AppText tone="warning">
          Hay {commitments.unknownCount} obligaciones del mes sin importe
          conocido. Revisa sus importes; no se tratarán como cero.
        </AppText>
      )}
      {commitments.priorUnresolvedCount > 0 && (
        <AppText tone="warning">
          Hay {commitments.priorUnresolvedCount} obligaciones pendientes de
          meses anteriores, posiblemente en otras monedas. Revisa esos meses. Un
          pago en otro mes aún no está soportado: no cambies su fecha real para
          quitar una obligación.
        </AppText>
      )}
      <AppText>
        Cómo se calcula, sin usar ingresos esperados ni ahorro protegido:
      </AppText>
      <AppText>
        Asignación gastable de ingresos recibidos:{' '}
        {money(components.spendable_allocated_minor)}
      </AppText>
      <AppText>
        Menos gastos registrados: {money(components.spent_minor)}
      </AppText>
      <AppText>
        Menos aportes adicionales a ahorro:{' '}
        {money(components.contributions_minor)}
      </AppText>
      <AppText>
        Más retiros explícitos de ahorro: {money(components.withdrawals_minor)}
      </AppText>
      <AppText>
        Menos compromisos confirmados pendientes:{' '}
        {formatMoney(commitments.confirmed)}
      </AppText>
      <AppText>
        Estimaciones conocidas aparte: aproximadamente{' '}
        {formatMoney(commitments.estimated)} · {commitments.estimatedCount}{' '}
        obligaciones, incluido cero.
      </AppText>
      <AppText>
        Los movimientos de metas ya están incluidos una sola vez. Un déficit no
        consume ahorro automáticamente. No incluye dinero sobrante de otros
        meses ni obligaciones no registradas.
      </AppText>
      <Button variant="secondary" onPress={() => router.push('/recurring')}>
        Revisar obligaciones recurrentes
      </Button>
    </>
  );
}
