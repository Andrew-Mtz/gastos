import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney, subtractMoney } from '../../domain/money/money';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import {
  bucketLabels,
  currentMonth,
  formatMoney,
} from '../budget/budget-setup';
import { budgetKey } from '../budget/budget-data';
import { consumptionOwnerKey } from '../budget/consumption-data';
import { incomeOwnerKey } from '../income/income-data';
import { expenseOwnerKey } from '../expense/expense-data';
import {
  historyOwnerKey,
  monthSchema,
  shiftMonth,
} from '../history/history-data';
import { savingsOwnerKey } from '../savings/savings-data';
import { recurringOwnerKey } from '../recurring/recurring-data';
import {
  buildCloseRequest,
  closePeriod,
  closeErrorMessage,
  isRejectedClose,
  periodCloseKey,
  readPeriodClose,
  type CloseRequest,
  type PeriodCloseContext,
} from './period-close-data';

export function PeriodCloseScreen() {
  const auth = useAuth(),
    params = useLocalSearchParams<{ month?: string }>();
  const requested = monthSchema.safeParse(params.month);
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalPeriodClose
      key={auth.state.userId}
      profile={auth.state.profile}
      requestedMonth={requested.success ? requested.data : undefined}
    />
  );
}
function PersonalPeriodClose({
  profile,
  requestedMonth,
}: {
  profile: Profile;
  requestedMonth?: string;
}) {
  const auth = useAuth(),
    client = useQueryClient();
  const [month, setMonth] = useState(
    () => requestedMonth ?? currentMonth(profile.timezone),
  );
  const selected = useRef(month),
    active = useRef(false),
    inFlight = useRef(false);
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false);
  const [review, setReview] = useState<PeriodCloseContext | null>(null);
  const [pending, setPending] = useState<CloseRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = periodCloseKey(profile.id, month);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readPeriodClose(profile.id, month, signal),
    enabled: visible,
  });
  const refresh = useCallback(
    () => client.invalidateQueries({ queryKey: recurringOwnerKey(profile.id) }),
    [client, profile.id],
  );
  useEffect(() => {
    selected.current = month;
  }, [month]);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      setVisible(true);
      setMonth(requestedMonth ?? selected.current);
      void refresh();
      return () => {
        active.current = false;
        setVisible(false);
        setReview(null);
        setNotice(null);
        void client.cancelQueries({ queryKey: recurringOwnerKey(profile.id) });
      };
    }, [client, profile.id, requestedMonth, refresh]),
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setReview(null);
      if (state !== 'active') {
        setVisible(false);
        void client.cancelQueries({ queryKey: recurringOwnerKey(profile.id) });
      } else if (active.current) {
        setVisible(true);
        void refresh();
      }
    });
    return () => listener.remove();
  }, [client, profile.id, refresh]);
  const submit = async (request: CloseRequest) => {
    if (inFlight.current || !active.current || !auth.isCurrentUser(profile.id))
      return;
    inFlight.current = true;
    setBusy(true);
    setPending(request);
    setReview(null);
    setNotice(null);
    try {
      await closePeriod(request);
      if (!auth.isCurrentUser(profile.id)) return;
      setPending(null);
      if (active.current && selected.current === request.month)
        setNotice(
          'Cierre confirmado. El resumen histórico se conserva sin mover dinero.',
        );
    } catch (error) {
      if (!auth.isCurrentUser(profile.id)) return;
      if (isRejectedClose(error)) setPending(null);
      if (active.current) setNotice(closeErrorMessage(error));
    } finally {
      inFlight.current = false;
      if (auth.isCurrentUser(profile.id)) {
        setBusy(false);
        await Promise.all(
          [
            recurringOwnerKey(profile.id),
            savingsOwnerKey(profile.id),
            historyOwnerKey(profile.id),
            incomeOwnerKey(profile.id),
            expenseOwnerKey(profile.id),
            consumptionOwnerKey(profile.id),
            budgetKey(profile.id, request.month),
          ].map((queryKey) => client.invalidateQueries({ queryKey })),
        );
      }
    }
  };
  const data = query.data;
  return (
    <Screen scroll>
      <AppText variant="title">Cierre e historial de meses</AppText>
      <AppText variant="section">{month.slice(0, 7)}</AppText>
      {notice && <AppText role="status">{notice}</AppText>}
      {pending && (
        <>
          <AppText>
            Hay una solicitud sin confirmar para {pending.month.slice(0, 7)}. No
            se creará otra.
          </AppText>
          <Button
            loading={busy}
            onPress={() => {
              void submit(pending);
            }}
          >
            Comprobar cierre pendiente
          </Button>
        </>
      )}
      <Button
        variant="secondary"
        disabled={month === '0001-01-01'}
        onPress={() => {
          setReview(null);
          setMonth((value) => shiftMonth(value, -1));
        }}
      >
        Mes anterior
      </Button>
      <Button
        variant="secondary"
        disabled={month === '9999-12-01'}
        onPress={() => {
          setReview(null);
          setMonth((value) => shiftMonth(value, 1));
        }}
      >
        Mes siguiente
      </Button>
      {!visible || query.isPending || query.isFetching ? (
        <LoadingState label="Actualizando estado del mes…" />
      ) : query.isError ? (
        <ErrorState
          message="No se pudo cargar un resumen válido. No se puede cerrar con datos anteriores."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : !data?.period ? (
        <AppText>No hay presupuesto registrado en este mes.</AppText>
      ) : (
        <>
          <AppText>
            {data.period.status === 'CLOSED'
              ? 'Período cerrado · solo lectura'
              : 'Período abierto'}
          </AppText>
          <CloseSummary context={data} />
          {data.period.status === 'OPEN' && !data.can_close && (
            <AppText role="alert">
              {month >= data.financial_month
                ? 'Este mes aún no terminó según la fecha del servidor en tu zona financiera.'
                : 'No se puede cerrar mientras existan obligaciones pendientes de este mes o anteriores. Revisa los registros reales; no cambies fechas para omitir pendientes.'}
            </AppText>
          )}
          {data.can_close && !review && (
            <Button
              disabled={!!pending || busy}
              onPress={() => setReview(data)}
            >
              Revisar cierre
            </Button>
          )}
          {review &&
            'snapshot_hash' in review &&
            data.snapshot_hash === review.snapshot_hash && (
              <>
                <AppText variant="section">
                  Confirmar cierre de {month.slice(0, 7)}
                </AppText>
                <AppText>
                  Los movimientos y la configuración del mes quedarán
                  bloqueados. El resumen será una copia histórica, no un saldo
                  actual. No se moverá dinero ni se trasladará el remanente.
                  Reabrir aún no está disponible.
                </AppText>
                <Button
                  loading={busy}
                  onPress={() => {
                    void submit(buildCloseRequest(randomUUID(), review));
                  }}
                >
                  Confirmar cierre
                </Button>
                <Button variant="secondary" onPress={() => setReview(null)}>
                  Cancelar
                </Button>
              </>
            )}
          <Button
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/history', params: { month } })
            }
          >
            Ver movimientos de este mes
          </Button>
          <Button
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/recurring', params: { month } })
            }
          >
            Revisar obligaciones
          </Button>
        </>
      )}
      <Button
        variant="secondary"
        onPress={() => {
          setReview(null);
          void refresh();
        }}
      >
        Actualizar mes
      </Button>
    </Screen>
  );
}
export function CloseSummary({ context }: { context: PeriodCloseContext }) {
  if (!context.period || !('summary' in context)) return null;
  const data = context.summary;
  if (!data?.period)
    return (
      <AppText>
        No hay una copia histórica disponible para este cierre anterior.
      </AppText>
    );
  const { availability } = data;
  const money = (amount: number) =>
    formatMoney(createMoney(amount, data.period.base_currency));
  return (
    <>
      <AppText variant="section">
        {context.closure
          ? 'Resumen conservado al cierre'
          : 'Resumen para revisar'}
      </AppText>
      {context.closure && (
        <AppText>
          Cerrado: {context.closure.closed_at} · Zona:{' '}
          {context.closure.financial_timezone}. Las correcciones de otros meses
          no reescriben esta copia.
        </AppText>
      )}
      <AppText>
        Ingresos recibidos del mes: {formatMoney(data.receivedIncome)}
      </AppText>
      <AppText>
        Gastos del mes: {money(availability.components.spent_minor)}
      </AppText>
      <AppText>
        Asignación a ahorro del mes:{' '}
        {money(availability.components.allocated_savings_minor)}
      </AppText>
      <AppText>
        Aportes adicionales del mes:{' '}
        {money(availability.components.contributions_minor)} · Retiros del mes:{' '}
        {money(availability.components.withdrawals_minor)}
      </AppText>
      <AppText>
        Ahorro protegido acumulado hasta el mes,{' '}
        {context.closure ? 'registrado al cierre' : 'según esta consulta'}:{' '}
        {formatMoney(availability.savings.protectedSavings)}. No es saldo
        bancario ni dinero disponible.
      </AppText>
      {data.usage.map((bucket) => (
        <AppText key={bucket.budgetBucketId}>
          {bucket.systemKey ? bucketLabels[bucket.systemKey] : bucket.name}:
          gastado {formatMoney(bucket.spentAmount)} · asignado{' '}
          {bucket.allocatedAmount
            ? formatMoney(bucket.allocatedAmount)
            : 'Sin distribución'}{' '}
          · diferencia{' '}
          {bucket.allocatedAmount
            ? formatMoney(
                subtractMoney(bucket.allocatedAmount, bucket.spentAmount),
              )
            : 'Sin calcular'}
        </AppText>
      ))}
      <AppText>
        Las diferencias por fondo no son dinero libre; no incluyen todos los
        movimientos ni compromisos.
      </AppText>
      <AppText>
        Obligaciones pendientes del mes:{' '}
        {availability.commitments.unresolvedCount} · Anteriores:{' '}
        {availability.commitments.priorUnresolvedCount}
      </AppText>
      <AppText>
        Compromisos confirmados:{' '}
        {formatMoney(availability.commitments.confirmed)} · Estimados:
        aproximadamente {formatMoney(availability.commitments.estimated)} · Sin
        importe conocido: {availability.commitments.unknownCount}
      </AppText>
      <AppText>
        {availability.confirmedMargin
          ? `Margen mensual antes de estimaciones: ${formatMoney(availability.confirmedMargin)}. Un importe negativo es déficit, no una retirada de ahorro.`
          : 'Margen mensual no disponible: faltan datos o hay obligaciones sin resolver.'}
      </AppText>
      <AppText>
        El cierre no convierte el margen en un remanente transferido ni
        arrastrado al siguiente mes.
      </AppText>
    </>
  );
}
