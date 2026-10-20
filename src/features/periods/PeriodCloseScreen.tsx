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
import { mapDashboard } from '../dashboard/dashboard-data';
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
  buildReopenRequest,
  reopenPeriod,
  reopenErrorMessage,
  pendingLifecycleKey,
  type PendingLifecycle,
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
    active = useRef(false);
  const [visible, setVisible] = useState(false);
  const [review, setReview] = useState<PeriodCloseContext | null>(null);
  const pendingKey = pendingLifecycleKey(profile.id);
  const pendingQuery = useQuery<PendingLifecycle | null>({
    queryKey: pendingKey,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    gcTime: Infinity,
  });
  const pending = pendingQuery.data ?? null;
  const busy = pending?.inFlight ?? false;
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
  const submit = async (request: CloseRequest, kind: 'close' | 'reopen') => {
    const previous = client.getQueryData<PendingLifecycle | null>(pendingKey);
    if (
      previous?.inFlight ||
      (previous && previous.request.id !== request.id) ||
      !active.current ||
      !auth.isCurrentUser(profile.id)
    )
      return;
    client.setQueryData<PendingLifecycle>(pendingKey, {
      kind,
      request,
      inFlight: true,
    });
    const requestCache = client
      .getQueryCache()
      .find({ queryKey: pendingKey, exact: true });
    setReview(null);
    setNotice(null);
    // QueryClient auth clear invalidates even a late response after same-owner re-login.
    const isCurrentRequest = () =>
      auth.isCurrentUser(profile.id) &&
      client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
        requestCache &&
      client.getQueryData<PendingLifecycle | null>(pendingKey)?.request.id ===
        request.id;
    try {
      if (kind === 'close') await closePeriod(request);
      else await reopenPeriod(request);
      if (!isCurrentRequest()) return;
      client.setQueryData(pendingKey, null);
      if (active.current && selected.current === request.month)
        setNotice(
          kind === 'close'
            ? 'Cierre confirmado. El resumen histórico se conserva sin mover dinero.'
            : 'Reapertura confirmada para esta solicitud. Revisa el estado actualizado del mes antes de corregir; una acción posterior puede haberlo cerrado de nuevo. Los cierres anteriores se conservan. No se movió dinero.',
        );
    } catch (error) {
      if (!isCurrentRequest()) return;
      client.setQueryData<PendingLifecycle | null>(pendingKey, () =>
        isRejectedClose(error) ? null : { kind, request, inFlight: false },
      );
      if (active.current && selected.current === request.month)
        setNotice(
          kind === 'close'
            ? closeErrorMessage(error)
            : reopenErrorMessage(error),
        );
    } finally {
      // Do not reintroduce auth-cleared private cache. A settled request is null;
      // a different request belongs to a later screen lifecycle.
      const current = client.getQueryData<PendingLifecycle | null>(pendingKey);
      if (
        auth.isCurrentUser(profile.id) &&
        client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
          requestCache &&
        (current === null || current?.request.id === request.id)
      ) {
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
            Hay una solicitud sin confirmar para{' '}
            {pending.request.month.slice(0, 7)}. No se creará otra.
          </AppText>
          <Button
            loading={busy}
            onPress={() => {
              void submit(pending.request, pending.kind);
            }}
          >
            {pending.kind === 'close'
              ? 'Comprobar cierre pendiente'
              : 'Comprobar reapertura pendiente'}
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
          {review?.period?.status === 'OPEN' &&
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
                  Para corregirlo luego deberás reabrirlo explícitamente.
                </AppText>
                <Button
                  loading={busy}
                  onPress={() => {
                    void submit(
                      buildCloseRequest(randomUUID(), review),
                      'close',
                    );
                  }}
                >
                  Confirmar cierre
                </Button>
                <Button variant="secondary" onPress={() => setReview(null)}>
                  Cancelar
                </Button>
              </>
            )}
          {data.period.status === 'CLOSED' && !review && (
            <Button
              disabled={!!pending || busy}
              onPress={() => setReview(data)}
            >
              Revisar reapertura
            </Button>
          )}
          {review?.period?.status === 'CLOSED' &&
            'reopen_hash' in review &&
            data.reopen_hash === review.reopen_hash && (
              <>
                <AppText variant="section">
                  Confirmar reapertura de {month.slice(0, 7)}
                </AppText>
                <AppText>
                  Volverás a permitir correcciones y cambios de configuración en
                  este mes. Todos los cierres anteriores y sus resúmenes
                  seguirán conservados. No se moverá dinero ni se trasladará un
                  remanente. Deberás cerrar el mes otra vez cuando termines.
                </AppText>
                <Button
                  loading={busy}
                  onPress={() => {
                    void submit(
                      buildReopenRequest(randomUUID(), review),
                      'reopen',
                    );
                  }}
                >
                  Confirmar reapertura
                </Button>
                <Button variant="secondary" onPress={() => setReview(null)}>
                  Cancelar
                </Button>
              </>
            )}
          <LifecycleHistory context={data} />
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

function LifecycleHistory({ context }: { context: PeriodCloseContext }) {
  if (!context.period || !('history' in context)) return null;
  const events = [
    ...context.history.closures.map((event) => ({
      kind: 'close' as const,
      event,
    })),
    ...context.history.reopenings.map((event) => ({
      kind: 'reopen' as const,
      event,
    })),
  ].sort((a, b) => b.event.lifecycle_version - a.event.lifecycle_version);
  if (!events.length) return null;
  return (
    <>
      <AppText variant="section">Historial de cierres y reaperturas</AppText>
      {events.map((entry) =>
        entry.kind === 'reopen' ? (
          <AppText key={`reopen-${entry.event.id}`}>
            Reapertura · versión {entry.event.lifecycle_version} ·{' '}
            {entry.event.reopened_at}. Cierre anterior:{' '}
            {entry.event.previous_closed_at}
            {entry.event.closure_id ? '' : ' · Sin copia histórica disponible'}.
          </AppText>
        ) : (
          <HistoricalClose
            key={`close-${entry.event.id}`}
            context={context}
            event={entry.event}
          />
        ),
      )}
    </>
  );
}
function HistoricalClose({
  context,
  event,
}: {
  context: PeriodCloseContext;
  event: import('./period-close-data').LifecycleHistory['closures'][number];
}) {
  const [expanded, setExpanded] = useState(false);
  if (!context.period || !('history' in context)) return null;
  const summary = mapDashboard(
    context.owner_profile_id,
    context.month,
    event.summary,
  );
  if (!summary.period) return null;
  return (
    <>
      <Button variant="secondary" onPress={() => setExpanded(!expanded)}>
        {`${expanded ? 'Ocultar' : 'Ver'} cierre versión ${event.lifecycle_version} · ${event.closed_at}`}
      </Button>
      {expanded && (
        <CloseSummary
          context={{
            ...context,
            closure: event,
            summary,
          }}
        />
      )}
    </>
  );
}
