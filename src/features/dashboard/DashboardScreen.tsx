import { useCallback, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { colors, radius, spacing } from '../../theme/tokens';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import {
  bucketLabels,
  currentMonth,
  formatMoney,
} from '../budget/budget-setup';
import { SafeToSpendSummary } from '../budget/SafeToSpend';
import { safeToSpendErrorMessage } from '../budget/safe-to-spend-data';
import {
  dashboardKey,
  dashboardOwnerKey,
  readDashboard,
} from './dashboard-data';

export function DashboardScreen() {
  const { state } = useAuth();
  if (state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <CurrentDashboard
      key={`${state.userId}/${state.profile.timezone}`}
      profile={state.profile}
    />
  );
}
function CurrentDashboard({ profile }: { profile: Profile }) {
  const client = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const [visible, setVisible] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const resume = () => {
        const nextMonth = currentMonth(profile.timezone);
        setMonth(nextMonth);
        void client.invalidateQueries({
          queryKey: dashboardKey(profile.id, nextMonth),
        });
        setVisible(true);
      };
      if (
        AppState.currentState !== 'background' &&
        AppState.currentState !== 'inactive'
      )
        resume();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') resume();
        else {
          setVisible(false);
          void client.cancelQueries({
            queryKey: dashboardOwnerKey(profile.id),
          });
        }
      });
      // Also notice a month rollover while the screen remains foregrounded.
      const timer = setInterval(
        () => setMonth(currentMonth(profile.timezone)),
        60000,
      );
      return () => {
        subscription.remove();
        clearInterval(timer);
        setVisible(false);
        void client.cancelQueries({ queryKey: dashboardOwnerKey(profile.id) });
      };
    }, [client, profile.id, profile.timezone]),
  );
  const query = useQuery({
    queryKey: dashboardKey(profile.id, month),
    queryFn: ({ signal }) => readDashboard(profile.id, month, signal),
    enabled: visible,
  });
  if (!visible) return null;
  if (query.isPending || query.isFetching)
    return <LoadingState label="Actualizando tu resumen mensual…" />;
  if (query.isError)
    return (
      <ErrorState
        message={safeToSpendErrorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  const data = query.data;
  const heading = (
    <AppText variant="title">Tu mes · {month.slice(0, 7)}</AppText>
  );
  if (!data.period)
    return (
      <Screen scroll>
        {heading}
        <AppText>
          Aún no tienes un presupuesto para este mes. Configúralo para ver un
          resumen fiable, no un saldo supuesto de cero.
        </AppText>
        <Button onPress={() => router.push('/budget')}>
          Configurar presupuesto
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            void query.refetch();
          }}
        >
          Actualizar resumen
        </Button>
      </Screen>
    );
  const { period, availability } = data;
  const money = (amount: number) =>
    formatMoney(createMoney(amount, period.base_currency));
  return (
    <Screen scroll>
      {heading}
      <AppText variant="caption" tone="secondary">
        {period.base_currency} ·{' '}
        {period.status === 'CLOSED' ? 'Período cerrado' : 'Período abierto'}
      </AppText>
      <View style={[styles.card, styles.primaryCard]}>
        <SafeToSpendSummary period={period} data={availability} compact />
        {!availability.configured && (
          <Button onPress={() => router.push('/budget')}>
            Configurar presupuesto
          </Button>
        )}
      </View>
      <View style={styles.actions}>
        {period.status === 'CLOSED' && (
          <AppText tone="warning">
            Este período está cerrado. Para modificarlo, revísalo en
            Presupuesto.
          </AppText>
        )}
        <Button
          disabled={period.status === 'CLOSED'}
          onPress={() => router.push('/expenses')}
        >
          Registrar gasto
        </Button>
        <Button
          variant="secondary"
          disabled={period.status === 'CLOSED'}
          onPress={() => router.push('/transactions')}
        >
          Registrar ingreso
        </Button>
      </View>
      <View style={styles.card}>
        <AppText variant="section">Ingresos del mes</AppText>
        <AppText>
          Ingresos recibidos: {formatMoney(data.receivedIncome)}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Ingresos esperados:{' '}
          {data.expectedIncome
            ? formatMoney(data.expectedIncome)
            : 'Sin estimación'}
          . No disponibles para gastar.
        </AppText>
        <AppText variant="caption" tone="secondary">
          Asignado a ahorro este mes:{' '}
          {money(availability.components.allocated_savings_minor)}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Asignado a fondos gastables:{' '}
          {money(availability.components.spendable_allocated_minor)}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Las asignaciones son anteriores a los gastos, aportes y compromisos.
          No son fondos restantes.
        </AppText>
        <Button variant="text" onPress={() => router.push('/budget')}>
          Ver presupuesto
        </Button>
      </View>
      <View style={styles.card}>
        <AppText variant="section">Ahorro protegido acumulado</AppText>
        <AppText variant="section" accessibilityRole="text">
          {formatMoney(availability.savings.protectedSavings)}
        </AppText>
        <AppText variant="caption" tone="secondary">
          Hasta este mes, solo en {period.base_currency}. Incluye el ahorro
          asignado y movimientos explícitos, no un saldo bancario ni dinero
          gastable.
        </AppText>
        <AppText variant="caption" tone="secondary">
          Reservado en metas:{' '}
          {money(availability.components.goal_reserved_minor)} · Sin meta:{' '}
          {money(availability.components.unassigned_savings_minor)}
        </AppText>
        <Button variant="text" onPress={() => router.push('/savings')}>
          Ver ahorro
        </Button>
        <Button variant="text" onPress={() => router.push('/savings-goals')}>
          Ver metas
        </Button>
      </View>
      <View style={styles.card}>
        <AppText variant="section">Uso de fondos gastables</AppText>
        {data.usage.map((bucket) => (
          <AppText key={bucket.budgetBucketId}>
            {bucket.systemKey ? bucketLabels[bucket.systemKey] : bucket.name}:
            gastado {formatMoney(bucket.spentAmount)} · asignado{' '}
            {bucket.allocatedAmount
              ? formatMoney(bucket.allocatedAmount)
              : 'Sin distribución'}{' '}
            · arrastre recibido {formatMoney(bucket.carriedAmount)} · remanente
            bruto{' '}
            {bucket.grossRemainder
              ? formatMoney(bucket.grossRemainder)
              : 'Sin distribución'}
          </AppText>
        ))}
        {data.usage.length === 0 && (
          <AppText>
            Aún no hay fondos gastables configurados ni gastos registrados.
          </AppText>
        )}
        <AppText variant="caption" tone="secondary">
          Comparación de asignaciones de ingresos, arrastres y gastos, no
          disponibilidad transferible por fondo. Los positivos no compensan por
          sí solos el déficit global. El margen mensual de arriba incluye ahorro
          adicional y compromisos.
        </AppText>
        <Button
          variant="text"
          onPress={() =>
            router.push({ pathname: '/history', params: { month } })
          }
        >
          Ver historial
        </Button>
      </View>
      <View style={styles.card}>
        <AppText variant="section">Obligaciones pendientes del mes</AppText>
        <AppText variant="caption" tone="secondary">
          Por vencer y vencidas, ordenadas por fecha.{' '}
          {availability.commitments.unresolvedCount} pendientes en total; vista
          previa de {data.upcoming.length}.
        </AppText>
        {data.upcoming.map((item) => (
          <AppText key={item.template_id}>
            {item.due_date} · {item.name} ·{' '}
            {item.amount_mode === 'FIXED'
              ? `Confirmado: ${money(item.default_amount_minor!)}`
              : item.default_amount_minor === null
                ? 'Importe por conocer'
                : `Estimado: aproximadamente ${money(item.default_amount_minor)}`}
          </AppText>
        ))}
        {data.upcoming.length === 0 && (
          <AppText>
            No hay obligaciones pendientes registradas para este mes. No
            significa que no existan gastos futuros.
          </AppText>
        )}
        <Button
          variant="text"
          onPress={() =>
            router.push({ pathname: '/recurring', params: { month } })
          }
        >
          Ver todas las obligaciones
        </Button>
      </View>
      <AppText variant="caption" tone="secondary">
        Mes actual según {profile.timezone}. Los accesos abren este mes.
      </AppText>
      <Button
        variant="secondary"
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar resumen
      </Button>
    </Screen>
  );
}
const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  primaryCard: { borderWidth: 1, borderColor: colors.action },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius,
  },
});
