import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { AppText } from '../../components/ui/AppText';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { spacing } from '../../theme/tokens';
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
  return <SafeToSpendSummary period={period} data={query.data} />;
}

export function SafeToSpendSummary({
  period,
  data,
  compact = false,
}: {
  period: BudgetPeriod;
  data: Awaited<ReturnType<typeof readSafeToSpend>>;
  compact?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const {
    components,
    commitments,
    confirmedMargin,
    estimatedMargin,
    configured,
  } = data;
  const money = (minor: number) =>
    formatMoney(createMoney(minor, period.base_currency));
  const marginLabel =
    commitments.estimatedCount > 0
      ? 'Margen antes de estimaciones'
      : 'Margen tras compromisos confirmados';
  return (
    <>
      <AppText variant="section">Margen mensual para gastar</AppText>
      {!compact && (
        <AppText>
          Estado actual de {period.starts_on.slice(0, 7)}. Es presupuesto
          mensual, no saldo bancario ni garantía de solvencia.
        </AppText>
      )}
      {confirmedMargin ? (
        compact ? (
          <View style={styles.margin}>
            <AppText variant="caption" tone="secondary">
              {marginLabel}
            </AppText>
            <AppText
              variant="title"
              accessibilityRole="text"
              accessibilityLabel={`${marginLabel}: ${formatMoney(confirmedMargin)}`}
              tone={confirmedMargin.amountMinor < 0 ? 'danger' : 'success'}
            >
              {formatMoney(confirmedMargin)}
            </AppText>
          </View>
        ) : (
          <AppText
            tone={confirmedMargin.amountMinor < 0 ? 'danger' : 'success'}
          >
            {marginLabel}: {formatMoney(confirmedMargin)}
          </AppText>
        )
      ) : (
        <AppText tone="warning" role="alert">
          Margen no disponible: falta información para afirmar cuánto puedes
          gastar.
        </AppText>
      )}
      {compact && confirmedMargin && confirmedMargin.amountMinor < 0 && (
        <AppText tone="danger">
          Déficit mensual. No se toma dinero del ahorro automáticamente.
        </AppText>
      )}
      {estimatedMargin && (
        <AppText tone={estimatedMargin.amountMinor < 0 ? 'danger' : 'primary'}>
          Margen estimado tras estimaciones conocidas: aproximadamente{' '}
          {formatMoney(estimatedMargin)}. No es dinero garantizado.
        </AppText>
      )}
      {compact && estimatedMargin && estimatedMargin.amountMinor < 0 && (
        <AppText tone="danger">
          Las estimaciones indican un posible déficit.
        </AppText>
      )}
      {!configured && (
        <AppText tone="warning" role="alert">
          Configura la distribución del presupuesto de este mes.
        </AppText>
      )}
      {commitments.unknownCount > 0 && (
        <AppText tone="warning" role="alert">
          Hay {commitments.unknownCount} obligaciones del mes sin importe
          conocido. Revisa sus importes; no se tratarán como cero.
        </AppText>
      )}
      {commitments.priorUnresolvedCount > 0 && (
        <AppText tone="warning" role="alert">
          Hay {commitments.priorUnresolvedCount} obligaciones pendientes de
          meses anteriores, posiblemente en otras monedas. Revisa esos meses. Un
          pago en otro mes aún no está soportado: no cambies su fecha real para
          quitar una obligación.
        </AppText>
      )}
      {compact && (
        <>
          <AppText tone="secondary">
            Cuenta lo recibido, no los ingresos esperados. El ahorro protegido
            queda fuera del dinero para gastar.
          </AppText>
          <AppText variant="caption" tone="secondary">
            Es presupuesto mensual, no saldo bancario ni garantía de solvencia.
            No incluye gastos futuros no registrados.
          </AppText>
          <Button
            variant="text"
            aria-expanded={showDetails}
            onPress={() => setShowDetails((shown) => !shown)}
          >
            {showDetails
              ? 'Ocultar cálculo del margen'
              : 'Ver cálculo del margen'}
          </Button>
        </>
      )}
      {(!compact || showDetails) && (
        <View style={styles.details}>
          <AppText>
            Cómo se calcula, sin usar ingresos esperados ni ahorro protegido:
          </AppText>
          <AppText>
            Asignación gastable de ingresos recibidos:{' '}
            {money(components.spendable_allocated_minor)}
          </AppText>
          <AppText>
            Más arrastre recibido: {money(components.carry.incoming_minor)} ·
            menos arrastre enviado: {money(components.carry.outgoing_minor)}
          </AppText>
          <AppText>
            De lo recibido, sin fondo asignado:{' '}
            {money(components.carry.unallocated_minor)}. No es ingreso nuevo ni
            se reparte por porcentajes.
          </AppText>
          <AppText>
            Menos gastos registrados: {money(components.spent_minor)}
          </AppText>
          <AppText>
            Menos aportes adicionales a ahorro:{' '}
            {money(components.contributions_minor)}
          </AppText>
          <AppText>
            Más retiros explícitos de ahorro:{' '}
            {money(components.withdrawals_minor)}
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
            Los movimientos de metas ya están incluidos una sola vez. Un déficit
            no consume ahorro automáticamente. Solo incluye sobrantes de otros
            meses arrastrados explícitamente. No incluye obligaciones no
            registradas.
          </AppText>
        </View>
      )}
      {(!compact ||
        commitments.unknownCount > 0 ||
        commitments.priorUnresolvedCount > 0) && (
        <Button
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/recurring',
              params: { month: period.starts_on },
            })
          }
        >
          Revisar obligaciones recurrentes
        </Button>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  margin: { gap: spacing.xs },
  details: { gap: spacing.sm },
});
