import { useQuery } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { formatMoney, type BudgetPeriod } from '../budget/budget-setup';
import {
  commitmentErrorMessage,
  commitmentKey,
  readCommittedMoney,
} from './commitment-data';

export function CommittedMoney({ period }: { period: BudgetPeriod }) {
  const query = useQuery({
    queryKey: commitmentKey(period.profile_id, period.id),
    queryFn: ({ signal }) => readCommittedMoney(period, signal),
  });
  return (
    <>
      <AppText variant="section">Dinero comprometido del mes</AppText>
      <AppText>
        Estado actual de {period.starts_on.slice(0, 7)}, incluidos los
        vencimientos ya pasados del mes. No es gasto realizado, saldo bancario
        ni dinero disponible.
      </AppText>
      {query.isPending || query.isFetching ? (
        <LoadingState label="Actualizando compromisos…" />
      ) : query.isError ? (
        <ErrorState
          message={commitmentErrorMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <AppText>
            Confirmado pendiente: {formatMoney(query.data.confirmed)} ·{' '}
            {query.data.confirmedCount} obligaciones fijas
          </AppText>
          <AppText>
            Estimado pendiente: aproximadamente{' '}
            {formatMoney(query.data.estimated)} · {query.data.estimatedCount}{' '}
            estimaciones conocidas, incluido cero
          </AppText>
          <AppText>
            Importe desconocido: {query.data.unknownCount} obligaciones
          </AppText>
          {query.data.unknownCount > 0 && (
            <AppText tone="warning">
              Faltan importes por conocer. La estimación mostrada no es el total
              de todos los gastos variables pendientes.
            </AppText>
          )}
          {query.data.priorUnresolvedCount > 0 && (
            <AppText tone="warning">
              Hay {query.data.priorUnresolvedCount} obligaciones pendientes de
              meses anteriores, no incluidas en los importes de este mes. Revisa
              esos meses; no se puede afirmar cuánto dinero queda disponible.
            </AppText>
          )}
          {query.data.buckets.map((bucket) => (
            <AppText key={bucket.budgetBucketId}>
              {bucket.name}: confirmado {formatMoney(bucket.confirmed)} ·
              estimado aproximadamente {formatMoney(bucket.estimated)} · sin
              importe {bucket.unknownCount}
            </AppText>
          ))}
          <AppText>
            Los gastos confirmados o cancelados no se cuentan otra vez. Un pago
            hecho en otro mes todavía no está soportado: no cambies su fecha
            real para quitar una obligación anterior.
          </AppText>
        </>
      )}
    </>
  );
}
