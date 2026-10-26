import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { recurringOwnerKey } from '../recurring/recurring-data';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen, FormScreen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { useAuth } from '../auth/AuthProvider';
import { CurrencySelect } from '../auth/CurrencySelect';
import { type Profile } from '../auth/auth-data';
import { type SavingsGoal } from '../../domain/savings/savings-goal';
import { transactionMoney } from '../../domain/transaction/transaction';
import {
  currentMonth,
  formatMoney,
  type BudgetPeriod,
} from '../budget/budget-setup';
import { budgetKey } from '../budget/budget-data';
import { historyOwnerKey, type HistoryCursor } from '../history/history-data';
import { financialDate, isRejectedIncome } from '../income/income-form';
import { SavingsEditor } from './SavingsScreen';
import {
  readSavingsMonth,
  registerSavings,
  savingsOwnerKey,
} from './savings-data';
import {
  savingsErrorMessage,
  type SavingsRequest,
  type SavingsType,
} from './savings-form';
import {
  createSavingsGoal,
  goalsKey,
  readSavingsGoals,
  readGoalHistory,
  goalHistoryKey,
} from './goals-data';
import { goalFormSchema, type GoalForm, type GoalRequest } from './goals-form';

type Editor =
  | { kind: 'create'; id: string }
  | {
      kind: 'movement';
      id: string;
      goal: SavingsGoal;
      period: BudgetPeriod;
      type: SavingsType;
    };
type Pending =
  | { kind: 'create'; request: GoalRequest }
  | {
      kind: 'movement';
      request: SavingsRequest;
      goal: SavingsGoal;
      period: BudgetPeriod;
    };

export function SavingsGoalsScreen() {
  const auth = useAuth();
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return <PersonalGoals key={auth.state.userId} profile={auth.state.profile} />;
}
function PersonalGoals({ profile }: { profile: Profile }) {
  const auth = useAuth();
  const client = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const active = useRef(false);
  const activeEditor = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      const next = currentMonth(profile.timezone);
      setMonth(next);
      void client.invalidateQueries({ queryKey: savingsOwnerKey(profile.id) });
      return () => {
        active.current = false;
        activeEditor.current = null;
        setEditor(null);
      };
    }, [client, profile.id, profile.timezone]),
  );
  const query = useQuery({
    queryKey: goalsKey(profile.id, month),
    queryFn: async ({ signal }) => {
      const [goals, savings] = await Promise.all([
        readSavingsGoals(profile.id, month, signal),
        readSavingsMonth(profile.id, month, signal),
      ]);
      return { goals, ...savings };
    },
  });
  const open = (next: Editor) => {
    activeEditor.current = next.id;
    setEditor(next);
  };
  const cancel = () => {
    activeEditor.current = null;
    setEditor(null);
  };
  const save = async (operation: Pending) => {
    if (!active.current || !auth.isCurrentUser(profile.id))
      throw { code: '42501' };
    setPending(operation);
    try {
      if (operation.kind === 'create')
        await createSavingsGoal(profile.id, operation.request);
      else await registerSavings(operation.period, operation.request);
    } catch (error) {
      if (isRejectedIncome(error) && auth.isCurrentUser(profile.id))
        setPending((current) =>
          current?.request.id === operation.request.id ? null : current,
        );
      throw error;
    }
    if (auth.isCurrentUser(profile.id)) {
      setPending((current) =>
        current?.request.id === operation.request.id ? null : current,
      );
      if (active.current && activeEditor.current === operation.request.id)
        cancel();
      await Promise.all([
        client.invalidateQueries({ queryKey: savingsOwnerKey(profile.id) }),
        ...(operation.kind === 'movement'
          ? [
              client.invalidateQueries({
                queryKey: recurringOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: historyOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: budgetKey(profile.id, operation.period.starts_on),
              }),
            ]
          : []),
      ]);
    }
  };
  // A pending exact operation remains recoverable even when the fresh summary fails.
  if (editor?.kind === 'create')
    return (
      <GoalEditor
        key={editor.id}
        requestId={editor.id}
        currency={profile.base_currency}
        pending={pending?.kind === 'create' ? pending.request : null}
        onCancel={cancel}
        onSave={(request) => save({ kind: 'create', request })}
      />
    );
  if (editor?.kind === 'movement')
    return (
      <SavingsEditor
        key={editor.id}
        requestId={editor.id}
        type={editor.type}
        goal={editor.goal}
        period={editor.period}
        date={financialDate(profile.timezone)}
        pending={pending?.kind === 'movement' ? pending.request : null}
        onCancel={cancel}
        onSave={(request) =>
          save({
            kind: 'movement',
            request,
            goal: editor.goal,
            period: editor.period,
          })
        }
      />
    );
  return (
    <Screen scroll>
      <AppText variant="title">Metas personales</AppText>
      <AppText>
        Progreso acumulado hasta {month.slice(0, 7)}. Las metas son parte del
        ahorro protegido, no saldos bancarios adicionales.
      </AppText>
      <AppText>
        Los aportes reservan dinero adicional del resto ordinario. El ahorro del
        porcentaje permanece general; no se reasigna automáticamente.
      </AppText>
      {pending ? (
        <Button
          onPress={() =>
            open(
              pending.kind === 'create'
                ? { kind: 'create', id: pending.request.id }
                : {
                    kind: 'movement',
                    id: pending.request.id,
                    goal: pending.goal,
                    period: pending.period,
                    type: pending.request.type,
                  },
            )
          }
        >
          Comprobar operación pendiente
        </Button>
      ) : (
        <Button onPress={() => open({ kind: 'create', id: randomUUID() })}>
          Crear meta
        </Button>
      )}
      {query.isPending || query.isFetching ? (
        <LoadingState label="Actualizando metas…" />
      ) : query.isError ? (
        <ErrorState
          message={savingsErrorMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          {query.data.goals.length === 0 && (
            <AppText>Aún no tienes metas personales.</AppText>
          )}
          {!query.data.period && (
            <AppText>
              Configura el presupuesto del mes para aportar o retirar. Puedes
              crear metas sin un presupuesto.
            </AppText>
          )}
          {query.data.goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              month={month}
              selected={selected === goal.id}
              onSelect={() =>
                setSelected(selected === goal.id ? null : goal.id)
              }
              profileId={profile.id}
              canContribute={
                !pending &&
                query.data.period?.status === 'OPEN' &&
                query.data.period.base_currency === goal.currency &&
                query.data.configured &&
                !!query.data.availability
              }
              canWithdraw={
                !pending &&
                query.data.period?.status === 'OPEN' &&
                query.data.period.base_currency === goal.currency &&
                goal.balance_minor > 0
              }
              onMovement={(type) => {
                const period = query.data.period;
                if (period)
                  open({
                    kind: 'movement',
                    id: randomUUID(),
                    goal,
                    period,
                    type,
                  });
              }}
            />
          ))}
          {query.data.period && (
            <AppText>
              Los movimientos de este mes usan {query.data.period.base_currency}
              . No hay conversión entre monedas. Un período cerrado no admite
              movimientos nuevos.
            </AppText>
          )}
        </>
      )}
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar metas
      </Button>
      <Button variant="secondary" onPress={() => router.push('/savings')}>
        Ahorro general
      </Button>
    </Screen>
  );
}
function GoalCard({
  goal,
  month,
  selected,
  onSelect,
  profileId,
  canContribute,
  canWithdraw,
  onMovement,
}: {
  goal: Awaited<ReturnType<typeof readSavingsGoals>>[number];
  month: string;
  selected: boolean;
  onSelect: () => void;
  profileId: string;
  canContribute: boolean;
  canWithdraw: boolean;
  onMovement: (type: SavingsType) => void;
}) {
  return (
    <>
      <AppText variant="section">{goal.name}</AppText>
      <AppText>
        Reservado: {formatMoney(goal.progress.balance)} de{' '}
        {formatMoney(goal.progress.target)}
      </AppText>
      <AppText>
        {goal.progress.attained
          ? 'Objetivo alcanzado'
          : 'Falta: ' + formatMoney(goal.progress.remaining)}
      </AppText>
      {goal.target_date && (
        <AppText>Fecha objetivo: {goal.target_date}</AppText>
      )}
      <Button
        disabled={!canContribute}
        onPress={() => onMovement('SAVINGS_CONTRIBUTION')}
      >
        {'Aportar a ' + goal.name}
      </Button>
      <Button
        variant="secondary"
        disabled={!canWithdraw}
        onPress={() => onMovement('SAVINGS_WITHDRAWAL')}
      >
        {'Retirar de ' + goal.name}
      </Button>
      <Button variant="text" onPress={onSelect}>
        {selected
          ? 'Ocultar movimientos de ' + goal.name
          : 'Ver movimientos de ' + goal.name}
      </Button>
      {selected && (
        <GoalHistory profileId={profileId} goalId={goal.id} month={month} />
      )}
    </>
  );
}
function GoalHistory({
  profileId,
  goalId,
  month,
}: {
  profileId: string;
  goalId: string;
  month: string;
}) {
  const query = useInfiniteQuery({
    queryKey: goalHistoryKey(profileId, goalId, month),
    initialPageParam: null as HistoryCursor | null,
    queryFn: ({ pageParam, signal }) =>
      readGoalHistory(profileId, goalId, month, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
  });
  if (query.isPending || (query.isFetching && !query.isFetchingNextPage))
    return <LoadingState label="Actualizando movimientos de la meta…" />;
  if (query.isError)
    return (
      <ErrorState
        message="No se pudieron cargar los movimientos de esta meta."
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <>
      <AppText>Movimientos hasta {month.slice(0, 7)}.</AppText>
      {query.data.pages[0]?.items.length === 0 && (
        <AppText>Esta meta todavía no tiene movimientos.</AppText>
      )}
      {query.data.pages
        .flatMap((page) => page.items)
        .map((item) => (
          <AppText key={item.id}>
            {item.transactionDate} ·{' '}
            {item.type === 'SAVINGS_CONTRIBUTION' ? 'Aporte' : 'Retiro'} ·{' '}
            {formatMoney(transactionMoney(item))}
            {item.description ? ' · ' + item.description : ''}
          </AppText>
        ))}
      {query.hasNextPage && (
        <Button
          loading={query.isFetchingNextPage}
          onPress={() => {
            void query.fetchNextPage();
          }}
        >
          Cargar más movimientos de la meta
        </Button>
      )}
    </>
  );
}
export function GoalEditor({
  requestId,
  currency,
  pending,
  onSave,
  onCancel,
}: {
  requestId: string;
  currency: string;
  pending: GoalRequest | null;
  onSave: (request: GoalRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const requestRef = useRef<GoalRequest | null>(pending);
  const submitting = useRef(false);
  const mutation = useMutation({ mutationFn: onSave, retry: false });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<GoalForm>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: pending?.form ?? {
      name: '',
      target: '',
      currency,
      targetDate: '',
    },
  });
  const selectedCurrency = useWatch({ control, name: 'currency' });
  const locked = mutation.isPending || pending !== null;
  return (
    <FormScreen>
      <AppText variant="title">Crear meta personal</AppText>
      <AppText>
        Crear una meta no reserva dinero ni realiza transferencias.
      </AppText>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextField
            label="Nombre de la meta"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            editable={!locked}
            error={errors.name?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="currency"
        render={({ field }) => (
          <CurrencySelect
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            disabled={locked}
            error={errors.currency?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="target"
        render={({ field }) => (
          <TextField
            label={`Objetivo (${selectedCurrency})`}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            keyboardType="decimal-pad"
            editable={!locked}
            error={errors.target?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="targetDate"
        render={({ field }) => (
          <TextField
            label="Fecha objetivo (AAAA-MM-DD, opcional)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            editable={!locked}
            error={errors.targetDate?.message}
          />
        )}
      />
      {pending && (
        <AppText>
          El resultado anterior aún no está confirmado. Comprobar reutiliza la
          misma meta sin duplicarla.
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
        {pending ? 'Comprobar misma meta' : 'Guardar meta'}
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
