import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen, FormScreen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { LoadingState, ErrorState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import { budgetKey } from '../budget/budget-data';
import {
  currentMonth,
  formatMoney,
  type BudgetPeriod,
} from '../budget/budget-setup';
import { incomeKey, readIncomeMonth, registerIncome } from './income-data';
import {
  financialDate,
  incomeErrorMessage,
  isRejectedIncome,
  validateIncomeForm,
  type IncomeForm,
  type IncomeRequest,
} from './income-form';

export function IncomeScreen() {
  const auth = useAuth();
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalIncome key={auth.state.userId} profile={auth.state.profile} />
  );
}
function PersonalIncome({ profile }: { profile: Profile }) {
  const auth = useAuth();
  const client = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    request: IncomeRequest;
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
        queryKey: incomeKey(profile.id, nextMonth),
      });
      return () => {
        active.current = false;

        setEditing(null);
        activeEditor.current = null;
      };
    }, [client, profile.id, profile.timezone]),
  );
  const key = incomeKey(profile.id, month);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readIncomeMonth(profile.id, month, signal),
  });
  if (query.isPending) return <LoadingState label="Cargando ingresos…" />;
  if (query.isError)
    return (
      <ErrorState
        message={incomeErrorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  const { period, receivedMinor } = query.data;
  const targetPeriod = pending?.period ?? period;
  if (editing && targetPeriod)
    return (
      <IncomeEditor
        key={editing}
        requestId={editing}
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
            await registerIncome(targetPeriod, request);
          } catch (error) {
            if (isRejectedIncome(error) && auth.isCurrentUser(profile.id))
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
                queryKey: incomeKey(profile.id, targetPeriod.starts_on),
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
      <AppText variant="title">Transacciones</AppText>
      <AppText variant="section">Ingresos · {month.slice(0, 7)}</AppText>
      {period ? (
        <>
          <AppText>
            Recibido:{' '}
            {formatMoney(createMoney(receivedMinor, period.base_currency))}
          </AppText>
          <AppText>
            Esperado:{' '}
            {period.expected_income_minor === null
              ? 'Sin estimación'
              : formatMoney(
                  createMoney(
                    period.expected_income_minor,
                    period.base_currency,
                  ),
                )}
          </AppText>
          <AppText>
            El ingreso esperado no se cuenta como dinero recibido.
          </AppText>
          <AppText>
            Solo se admiten ingresos en {period.base_currency}. La conversión
            entre monedas se añadirá más adelante.
          </AppText>
          {period.status === 'CLOSED' && (
            <AppText>Este período está cerrado.</AppText>
          )}
        </>
      ) : (
        <AppText>
          Configura el presupuesto de este mes en Presupuesto antes de registrar
          ingresos.
        </AppText>
      )}
      {(pending || period?.status === 'OPEN') && (
        <Button
          onPress={() => {
            const id = pending?.request.id ?? randomUUID();
            activeEditor.current = id;
            setEditing(id);
          }}
        >
          {pending ? 'Comprobar registro pendiente' : 'Registrar ingreso'}
        </Button>
      )}
      <Button
        variant="secondary"
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar ingresos
      </Button>
    </Screen>
  );
}

export function IncomeEditor({
  requestId,
  period,
  date,
  pending,
  onSave,
  onCancel,
}: {
  requestId: string;
  period: BudgetPeriod;
  date: string;
  pending: IncomeRequest | null;
  onSave: (request: IncomeRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const requestRef = useRef<IncomeRequest | null>(pending);
  const submitting = useRef(false);
  const mutation = useMutation({ mutationFn: onSave, retry: false });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<IncomeForm>({
    resolver: zodResolver(validateIncomeForm(period)),
    defaultValues: pending?.form ?? { amount: '', date, description: '' },
  });
  const locked = mutation.isPending || pending !== null;
  return (
    <FormScreen>
      <AppText variant="title">Registrar ingreso</AppText>
      <AppText>Dinero efectivamente recibido · {period.base_currency}</AppText>
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
          {incomeErrorMessage(mutation.error)}
        </AppText>
      )}
      <Button
        loading={mutation.isPending}
        onPress={() => {
          void handleSubmit(async (form) => {
            if (submitting.current) return;
            submitting.current = true;
            const request = pending ??
              requestRef.current ?? { id: requestId, form };
            requestRef.current = request;
            try {
              await mutation.mutateAsync(request);
            } catch (error) {
              if (isRejectedIncome(error)) requestRef.current = null;
            } finally {
              submitting.current = false;
            }
          })();
        }}
      >
        {pending ? 'Comprobar mismo ingreso' : 'Guardar ingreso'}
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
