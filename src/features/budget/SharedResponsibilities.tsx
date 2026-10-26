import { useCallback, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { sharedBudgetLabels } from '../household/shared-expense-data';
import { formatMoney } from './budget-setup';
import {
  readSharedResponsibilities,
  sharedResponsibilityKey,
  type SharedResponsibilities as Responsibilities,
} from './shared-responsibility-data';

type Props = { owner: string; month: string };
export function SharedResponsibilities(props: Props) {
  return (
    <MonthlyResponsibilities key={`${props.owner}/${props.month}`} {...props} />
  );
}
function MonthlyResponsibilities({ owner, month }: Props) {
  const client = useQueryClient();
  const [visible, setVisible] = useState(false);
  const key = sharedResponsibilityKey(owner, month);
  useFocusEffect(
    useCallback(() => {
      const resume = () => {
        void client.invalidateQueries({
          queryKey: sharedResponsibilityKey(owner, month),
          exact: true,
        });
        setVisible(true);
      };
      const hide = () => {
        setVisible(false);
        void client.cancelQueries({
          queryKey: sharedResponsibilityKey(owner, month),
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
    queryKey: key,
    queryFn: ({ signal }) => readSharedResponsibilities(owner, month, signal),
    enabled: visible,
    retry: false,
    refetchOnMount: 'always',
  });
  if (!visible) return null;
  if (query.isPending || query.isFetching || !query.isFetchedAfterMount)
    return <LoadingState label="Comprobando tu consumo del hogar…" />;
  if (query.isError)
    return (
      <ErrorState
        message="No pudimos comprobar tu responsabilidad del hogar. No se muestra como cero ni como un saldo disponible."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <SharedResponsibilitiesSummary
      data={query.data}
      onRefresh={() => {
        void query.refetch();
      }}
    />
  );
}

/** Render only with the financial snapshot that supplied these sources. */
export function SharedResponsibilitiesSummary({
  data,
  onRefresh,
}: {
  data: Responsibilities;
  onRefresh?: () => void;
}) {
  const month = data.month;
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="section">
        Tu consumo del hogar · {month.slice(0, 7)}
      </AppText>
      <AppText>
        Solo tu responsabilidad, no lo que pagaste ni una deuda. No vuelvas a
        registrarla como gasto personal.
      </AppText>
      {!data.period && data.entries.length > 0 && (
        <AppText>
          Este consumo ya está registrado, aunque todavía no tengas presupuesto
          o ingresos. Al configurar el mes se vinculará sin duplicarlo.
        </AppText>
      )}
      {data.entries.map((entry) => (
        <View key={entry.expense_id} style={{ gap: 4 }}>
          <AppText>
            {entry.budget_classification
              ? sharedBudgetLabels[entry.budget_classification]
              : 'Sin clasificación histórica'}
            :{' '}
            {formatMoney(
              createMoney(-entry.responsibility_amount_minor, entry.currency),
            )}
          </AppText>
          <AppText>
            {entry.transaction_date} ·{' '}
            {entry.household_name
              ? `Del hogar ${entry.household_name}`
              : `De un hogar anterior (${entry.household_id})`}
          </AppText>
          {entry.description && <AppText>{entry.description}</AppText>}
          {entry.application_status === 'UNCLASSIFIED' && (
            <AppText tone="warning">
              El gasto anterior no tiene clasificación. No se supone Necesidades
              u Ocio ni se presenta una disponibilidad incompleta.
            </AppText>
          )}
          {entry.responsibility_amount_minor > 0 &&
            data.period &&
            entry.currency !== data.period.base_currency && (
              <AppText tone="warning">
                Se mantiene en {entry.currency}, separado del presupuesto en{' '}
                {data.period.base_currency}. Sin conversión.{' '}
                {data.period.status === 'CLOSED'
                  ? 'Las cifras mostradas corresponden al consumo reconocido en el cierre; esta responsabilidad queda fuera y pendiente de aplicación.'
                  : 'El saldo, margen y remanente del mes están incompletos y no se muestran como disponibles.'}
              </AppText>
            )}
          {entry.application_status === 'NO_BUCKET' && (
            <AppText tone="warning">
              Tu consumo ya está registrado. Falta configurar el apartado
              personal correspondiente; no se supone que sea cero ni se asigna a
              un fondo personalizado.
            </AppText>
          )}
          {entry.included_in_closed_period === false &&
            entry.responsibility_amount_minor > 0 && (
              <AppText tone="warning">
                Pendiente de aplicar: el mes está cerrado. Solo una reapertura
                explícita permite revisar su aplicación, sin resolver por sí
                sola una moneda distinta o clasificación ausente. No se mueve a
                otro mes.
              </AppText>
            )}
          {entry.application_status === 'NO_IMPACT' && (
            <AppText>
              Responsabilidad cero: no consume presupuesto ni bloquea tu
              disponibilidad.
            </AppText>
          )}
          {entry.included_in_closed_period === true && (
            <AppText>Ya incluido en el cierre guardado.</AppText>
          )}
        </View>
      ))}
      {data.entries.length === 0 && (
        <AppText>
          No hay responsabilidades del hogar registradas para este mes.
        </AppText>
      )}
      {onRefresh && (
        <Button variant="text" onPress={onRefresh}>
          Actualizar consumo del hogar
        </Button>
      )}
    </View>
  );
}
