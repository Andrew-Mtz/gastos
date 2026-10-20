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
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import { historyOwnerKey } from '../history/history-data';
import { budgetKey } from '../budget/budget-data';
import { currentMonth, type BudgetPeriod } from '../budget/budget-setup';
import {
  expenseKey,
  expenseOwnerKey,
  type ExpenseCategory,
  readExpenseMonth,
  registerExpense,
} from './expense-data';
import {
  expenseErrorMessage,
  validateExpenseForm,
  type ExpenseForm,
  type ExpenseRequest,
} from './expense-form';
import {
  financialDate,
  isRejectedIncome as isRejectedExpense,
} from '../income/income-form';
import { CategoryCreator } from './CategoryCreator';

export function ExpenseScreen() {
  const auth = useAuth();
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalExpense key={auth.state.userId} profile={auth.state.profile} />
  );
}
function PersonalExpense({ profile }: { profile: Profile }) {
  const auth = useAuth();
  const client = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    request: ExpenseRequest;
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
        queryKey: expenseKey(profile.id, nextMonth),
      });
      return () => {
        active.current = false;

        setEditing(null);
        activeEditor.current = null;
      };
    }, [client, profile.id, profile.timezone]),
  );
  const key = expenseKey(profile.id, month);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readExpenseMonth(profile.id, month, signal),
  });
  if (query.isPending) return <LoadingState label="Cargando gastos…" />;
  if (query.isError)
    return (
      <ErrorState
        message={expenseErrorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  const { period, categories, buckets } = query.data;
  const targetPeriod = pending?.period ?? period;
  if (editing && targetPeriod)
    return (
      <ExpenseEditor
        key={editing}
        requestId={editing}
        categories={categories}
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
            await registerExpense(targetPeriod, request);
          } catch (error) {
            if (isRejectedExpense(error) && auth.isCurrentUser(profile.id))
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
                queryKey: historyOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: expenseOwnerKey(profile.id),
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
      <AppText variant="title">Gastos personales</AppText>
      <AppText variant="section">Gastos · {month.slice(0, 7)}</AppText>
      {period ? (
        <>
          <AppText>
            Solo gastos en {period.base_currency}. La categoría determina el
            fondo disponible; el ahorro nunca se usa automáticamente.
          </AppText>
          {period.status === 'CLOSED' && (
            <AppText>Este período está cerrado.</AppText>
          )}
        </>
      ) : (
        <AppText>
          Configura el presupuesto de este mes en Presupuesto antes de registrar
          gastos.
        </AppText>
      )}
      {period?.status === 'OPEN' && (
        <CategoryCreator
          profileId={profile.id}
          buckets={buckets}
          isCurrent={() => active.current && auth.isCurrentUser(profile.id)}
          onCreated={async () => {
            if (auth.isCurrentUser(profile.id))
              await client.invalidateQueries({
                queryKey: expenseOwnerKey(profile.id),
              });
          }}
        />
      )}
      {(pending || (period?.status === 'OPEN' && categories.length > 0)) && (
        <Button
          onPress={() => {
            const id = pending?.request.id ?? randomUUID();
            activeEditor.current = id;
            setEditing(id);
          }}
        >
          {pending ? 'Comprobar registro pendiente' : 'Registrar gasto'}
        </Button>
      )}
      <Button
        variant="secondary"
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar gastos
      </Button>
    </Screen>
  );
}

export function ExpenseEditor({
  requestId,
  categories,
  period,
  date,
  pending,
  onSave,
  onCancel,
}: {
  requestId: string;
  categories: ExpenseCategory[];
  period: BudgetPeriod;
  date: string;
  pending: ExpenseRequest | null;
  onSave: (request: ExpenseRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const requestRef = useRef<ExpenseRequest | null>(pending);
  const submitting = useRef(false);
  const mutation = useMutation({ mutationFn: onSave, retry: false });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ExpenseForm>({
    resolver: zodResolver(validateExpenseForm(period)),
    defaultValues: pending?.form ?? {
      amount: '',
      date,
      description: '',
      categoryId: '',
    },
  });
  const locked = mutation.isPending || pending !== null;
  return (
    <FormScreen>
      <AppText variant="title">Registrar gasto</AppText>
      <AppText>Gasto personal · {period.base_currency}</AppText>
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
        name="categoryId"
        render={({ field }) => (
          <>
            <AppText variant="section">Categoría</AppText>
            {categories.map((category) => (
              <Button
                key={category.id}
                variant={field.value === category.id ? 'primary' : 'secondary'}
                disabled={locked}
                accessibilityState={{ selected: field.value === category.id }}
                onPress={() => field.onChange(category.id)}
              >
                {category.name}
              </Button>
            ))}
            {errors.categoryId && (
              <AppText role="alert" tone="danger">
                {errors.categoryId.message}
              </AppText>
            )}
          </>
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
          {expenseErrorMessage(mutation.error)}
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
              if (isRejectedExpense(error)) requestRef.current = null;
            } finally {
              submitting.current = false;
            }
          })();
        }}
      >
        {pending ? 'Comprobar mismo gasto' : 'Guardar gasto'}
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
