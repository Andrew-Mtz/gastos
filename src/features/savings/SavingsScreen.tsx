import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen, FormScreen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { LoadingState, ErrorState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { currencyDigits, parseDecimal } from '../budget/budget-setup';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import { historyOwnerKey } from '../history/history-data';
import { budgetKey } from '../budget/budget-data';
import {
  currentMonth,
  formatMoney,
  type BudgetPeriod,
} from '../budget/budget-setup';
import {
  savingsKey,
  savingsOwnerKey,
  readSavingsMonth,
  registerSavings,
} from './savings-data';
import {
  savingsErrorMessage,
  type SavingsRequest,
  type SavingsType,
} from './savings-form';
import {
  financialDate,
  isRejectedIncome as isRejectedSavings,
  validateIncomeForm as validateSavingsForm,
  type IncomeForm as SavingsForm,
} from '../income/income-form';

export function SavingsScreen() {
  const auth = useAuth();
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalSavings key={auth.state.userId} profile={auth.state.profile} />
  );
}
function PersonalSavings({ profile }: { profile: Profile }) {
  const auth = useAuth();
  const client = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const [editing, setEditing] = useState<string | null>(null);
  const [movementType, setMovementType] = useState<SavingsType>(
    'SAVINGS_CONTRIBUTION',
  );
  const [pending, setPending] = useState<{
    request: SavingsRequest;
    period: BudgetPeriod;
  } | null>(null);
  const active = useRef(false);
  const activeEditor = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = true;

      const nextMonth = currentMonth(profile.timezone);
      setMonth(nextMonth);
      void client.invalidateQueries({
        queryKey: savingsKey(profile.id, nextMonth),
      });
      return () => {
        active.current = false;

        setEditing(null);
        activeEditor.current = null;
      };
    }, [client, profile.id, profile.timezone]),
  );
  const key = savingsKey(profile.id, month);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readSavingsMonth(profile.id, month, signal),
  });
  if (query.isPending) return <LoadingState label="Cargando ahorro…" />;
  if (query.isError)
    return (
      <ErrorState
        message={savingsErrorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  const { period, availability, configured, goalReserved, unassignedSavings } =
    query.data;
  const targetPeriod = pending?.period ?? period;
  if (editing && targetPeriod)
    return (
      <SavingsEditor
        key={editing}
        requestId={editing}
        type={pending?.request.type ?? movementType}
        period={targetPeriod}
        date={financialDate(profile.timezone)}
        pending={pending?.request ?? null}
        onCancel={() => {
          setEditing(null);
          activeEditor.current = null;
        }}
        onSave={async (request) => {
          if (!active.current || !auth.isCurrentUser(profile.id))
            throw { code: '42501' };
          setPending({ request, period: targetPeriod });
          try {
            await registerSavings(targetPeriod, request);
          } catch (error) {
            if (isRejectedSavings(error) && auth.isCurrentUser(profile.id))
              setPending((current) =>
                current?.request.id === request.id ? null : current,
              );
            throw error;
          }
          if (auth.isCurrentUser(profile.id)) {
            setPending((current) =>
              current?.request.id === request.id ? null : current,
            );
            if (active.current && activeEditor.current === request.id) {
              setEditing(null);
              activeEditor.current = null;
            }
            await Promise.all([
              client.invalidateQueries({
                queryKey: recurringOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: historyOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: savingsOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: budgetKey(profile.id, targetPeriod.starts_on),
              }),
            ]);
          }
        }}
      />
    );
  return (
    <Screen scroll>
      <AppText variant="title">Ahorro personal</AppText>
      <AppText variant="section">Ahorro · {month.slice(0, 7)}</AppText>
      {query.isFetching ? (
        <LoadingState label="Actualizando ahorro…" />
      ) : period && availability ? (
        <>
          <AppText>
            Ahorro protegido acumulado hasta este mes:{' '}
            {formatMoney(availability.protectedSavings)}
          </AppText>
          {goalReserved && unassignedSavings && (
            <>
              <AppText>
                Reservado para metas (incluido en el total):{' '}
                {formatMoney(goalReserved)}
              </AppText>
              <AppText>
                Ahorro general disponible para retiro:{' '}
                {formatMoney(unassignedSavings)}
              </AppText>
            </>
          )}
          <AppText>
            Resto ordinario del mes antes de compromisos:{' '}
            {formatMoney(availability.ordinaryRemainderBeforeCommitments)}
          </AppText>
          <AppText>
            Los aportes son adicionales al porcentaje ya reservado. Los retiros
            devuelven disponibilidad a este mes. No son gastos, ingresos ni
            transferencias bancarias.
          </AppText>
          <AppText>
            El resto no es dinero seguro para gastar: todavía no descuenta
            compromisos. Las monedas se mantienen separadas.
          </AppText>
          {period.status === 'CLOSED' && (
            <AppText>Este período está cerrado.</AppText>
          )}
        </>
      ) : (
        <AppText>
          Configura el presupuesto de este mes en Presupuesto antes de registrar
          movimientos.
        </AppText>
      )}
      {pending ? (
        <Button
          onPress={() => {
            activeEditor.current = pending.request.id;
            setEditing(pending.request.id);
          }}
        >
          Comprobar movimiento pendiente
        </Button>
      ) : (
        period?.status === 'OPEN' &&
        !query.isFetching && (
          <>
            <Button
              disabled={!configured}
              onPress={() => {
                const id = randomUUID();
                setMovementType('SAVINGS_CONTRIBUTION');
                activeEditor.current = id;
                setEditing(id);
              }}
            >
              Aportar a ahorro
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                const id = randomUUID();
                setMovementType('SAVINGS_WITHDRAWAL');
                activeEditor.current = id;
                setEditing(id);
              }}
            >
              Retirar de ahorro
            </Button>
          </>
        )
      )}
      <Button variant="secondary" onPress={() => router.push('/savings-goals')}>
        Metas personales
      </Button>
      <Button variant="secondary" onPress={() => router.push('/history')}>
        Historial personal
      </Button>
      <Button
        variant="secondary"
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar ahorro
      </Button>
    </Screen>
  );
}

export function SavingsEditor({
  requestId,
  type,
  period,
  date,
  pending,
  goal,
  onSave,
  onCancel,
}: {
  requestId: string;
  type: SavingsType;
  period: BudgetPeriod;
  date: string;
  pending: SavingsRequest | null;
  goal?: { id: string; name: string };
  onSave: (request: SavingsRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const requestRef = useRef<SavingsRequest | null>(pending);
  const submitting = useRef(false);
  const [confirmation, setConfirmation] = useState<SavingsRequest | null>(null);
  const mutation = useMutation({ mutationFn: onSave, retry: false });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SavingsForm>({
    resolver: zodResolver(validateSavingsForm(period)),
    defaultValues: pending?.form ?? { amount: '', date, description: '' },
  });
  const locked = mutation.isPending || pending !== null;
  const submit = async (request: SavingsRequest) => {
    if (submitting.current) return;
    submitting.current = true;
    requestRef.current = request;
    try {
      await mutation.mutateAsync(request);
    } catch (error) {
      if (isRejectedSavings(error)) {
        requestRef.current = null;
        setConfirmation(null);
      }
    } finally {
      submitting.current = false;
    }
  };
  if (confirmation && !pending)
    return (
      <FormScreen>
        <AppText variant="title">Confirmar retiro</AppText>
        {goal && (
          <AppText>Meta: {goal.name}. Este retiro reduce su progreso.</AppText>
        )}
        <AppText>
          Retirar{' '}
          {formatMoney(
            createMoney(
              parseDecimal(
                confirmation.form.amount,
                currencyDigits(period.base_currency),
              )!,
              period.base_currency,
            ),
          )}{' '}
          del ahorro protegido.
        </AppText>
        <AppText>
          Fecha: {confirmation.form.date}. Quedará disponible para gasto
          ordinario en {period.starts_on.slice(0, 7)}. Esto solo registra una
          decisión; no mueve dinero en el banco.
        </AppText>
        <Button
          loading={mutation.isPending}
          onPress={() => {
            void submit(confirmation);
          }}
        >
          Confirmar retiro de ahorro
        </Button>
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onPress={() => setConfirmation(null)}
        >
          Volver sin retirar
        </Button>
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onPress={onCancel}
        >
          Cancelar
        </Button>
      </FormScreen>
    );
  return (
    <FormScreen>
      <AppText variant="title">
        {type === 'SAVINGS_WITHDRAWAL'
          ? 'Retirar de ahorro'
          : 'Aportar a ahorro'}
      </AppText>
      {goal && (
        <AppText>
          Meta: {goal.name}. El aporte es adicional, no reasigna ahorro
          existente.
        </AppText>
      )}
      <AppText>
        Movimiento conceptual de ahorro · {period.base_currency}
      </AppText>
      <Controller
        control={control}
        name="amount"
        render={({ field }) => (
          <TextField
            label={`Importe (${period.base_currency})`}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            keyboardType="decimal-pad"
            editable={!locked}
            error={errors.amount?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="date"
        render={({ field }) => (
          <TextField
            label="Fecha (AAAA-MM-DD)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            editable={!locked}
            error={errors.date?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <TextField
            label="Descripción (opcional)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            editable={!locked}
          />
        )}
      />
      {pending && (
        <AppText>
          El resultado anterior aún no está confirmado. Comprobar reutiliza el
          mismo registro, sin duplicarlo. Si sales, quedará pendiente de
          comprobar.
        </AppText>
      )}
      {mutation.isError && (
        <AppText role="alert" tone="danger">
          {savingsErrorMessage(mutation.error)}
        </AppText>
      )}
      <Button
        loading={mutation.isPending}
        onPress={() => {
          void handleSubmit(async (form) => {
            const existing = pending ?? requestRef.current;
            if (existing) {
              await submit(existing);
              return;
            }
            const request: SavingsRequest = {
              id: requestId,
              form,
              type,
              withdrawalConfirmed: type === 'SAVINGS_WITHDRAWAL',
              ...(goal ? { savingsGoalId: goal.id } : {}),
            };
            if (type === 'SAVINGS_WITHDRAWAL') setConfirmation(request);
            else await submit(request);
          })();
        }}
      >
        {pending
          ? 'Comprobar mismo movimiento'
          : type === 'SAVINGS_WITHDRAWAL'
            ? 'Revisar retiro'
            : 'Guardar aporte'}
      </Button>
      <Button
        variant="secondary"
        disabled={mutation.isPending}
        onPress={onCancel}
      >
        Cancelar
      </Button>
    </FormScreen>
  );
}
