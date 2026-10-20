import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { type RecurringExpense } from '../../domain/recurring/recurring-expense';
import { createMoney } from '../../domain/money/money';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import {
  currentMonth,
  formatMoney,
  type BudgetPeriod,
} from '../budget/budget-setup';
import { budgetKey } from '../budget/budget-data';
import { consumptionOwnerKey } from '../budget/consumption-data';
import { savingsOwnerKey } from '../savings/savings-data';
import { expenseOwnerKey, type ExpenseCategory } from '../expense/expense-data';
import { historyOwnerKey, shiftMonth } from '../history/history-data';
import {
  financialDate,
  isRejectedIncome,
  type IncomeRequest,
} from '../income/income-form';
import {
  createTemplate,
  readRecurringMonth,
  recurringKey,
  recurringOwnerKey,
  resolveRecurring,
  stopTemplate,
} from './recurring-data';
import { recurringErrorMessage, type TemplateRequest } from './recurring-form';
import { TemplateEditor, ResolveEditor, StopEditor } from './RecurringEditors';

type Editor =
  | { kind: 'create'; id: string; categories: ExpenseCategory[]; month: string }
  | {
      kind: 'resolve';
      id: string;
      template: RecurringExpense;
      period: BudgetPeriod;
      date: string;
    }
  | { kind: 'stop'; id: string; template: RecurringExpense; month: string };
type Pending =
  | {
      kind: 'create';
      request: TemplateRequest;
      editor: Extract<Editor, { kind: 'create' }>;
    }
  | {
      kind: 'resolve';
      request: IncomeRequest;
      editor: Extract<Editor, { kind: 'resolve' }>;
    }
  | {
      kind: 'stop';
      request: { id: string; month: string };
      editor: Extract<Editor, { kind: 'stop' }>;
    };
export function RecurringScreen() {
  const auth = useAuth();
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalRecurring key={auth.state.userId} profile={auth.state.profile} />
  );
}
function PersonalRecurring({ profile }: { profile: Profile }) {
  const auth = useAuth(),
    client = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const [editor, setEditor] = useState<Editor | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const active = useRef(false),
    activeEditor = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      void client.invalidateQueries({
        queryKey: recurringOwnerKey(profile.id),
      });
      return () => {
        active.current = false;
        activeEditor.current = null;
        setEditor(null);
      };
    }, [client, profile.id]),
  );
  const query = useQuery({
    queryKey: recurringKey(profile.id, month),
    queryFn: ({ signal }) => readRecurringMonth(profile.id, month, signal),
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
        await createTemplate(profile.id, operation.request);
      else if (operation.kind === 'stop')
        await stopTemplate(
          profile.id,
          operation.editor.template,
          operation.request.month,
        );
      else
        await resolveRecurring(
          operation.editor.period,
          operation.editor.template,
          operation.request,
        );
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
        client.invalidateQueries({ queryKey: recurringOwnerKey(profile.id) }),
        ...(operation.kind === 'resolve'
          ? [
              client.invalidateQueries({
                queryKey: savingsOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: consumptionOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: historyOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: expenseOwnerKey(profile.id),
              }),
              client.invalidateQueries({
                queryKey: budgetKey(
                  profile.id,
                  operation.editor.period.starts_on,
                ),
              }),
            ]
          : []),
      ]);
    }
  };
  if (editor?.kind === 'create')
    return (
      <TemplateEditor
        key={editor.id}
        id={editor.id}
        month={editor.month}
        currency={profile.base_currency}
        categories={editor.categories}
        pending={pending?.kind === 'create' ? pending.request : null}
        onCancel={cancel}
        onSave={(request) => save({ kind: 'create', request, editor })}
      />
    );
  if (editor?.kind === 'resolve')
    return (
      <ResolveEditor
        key={editor.id}
        id={editor.id}
        name={editor.template.name}
        period={editor.period}
        date={editor.date}
        pending={pending?.kind === 'resolve' ? pending.request : null}
        onCancel={cancel}
        onSave={(request) => save({ kind: 'resolve', request, editor })}
      />
    );
  if (editor?.kind === 'stop')
    return (
      <StopEditor
        key={editor.id}
        name={editor.template.name}
        month={pending?.kind === 'stop' ? pending.request.month : editor.month}
        pending={pending?.kind === 'stop'}
        onCancel={cancel}
        onSave={(month) =>
          save({ kind: 'stop', request: { id: editor.id, month }, editor })
        }
      />
    );
  return (
    <Screen scroll>
      <AppText variant="title">Gastos recurrentes</AppText>
      <AppText variant="section">Obligaciones · {month.slice(0, 7)}</AppText>
      <AppText>
        Las plantillas y estimaciones no son gastos reales. Solo confirmar un
        importe variable crea un gasto.
      </AppText>
      <Button
        variant="secondary"
        onPress={() => setMonth(shiftMonth(month, -1))}
      >
        Mes anterior
      </Button>
      <Button
        variant="secondary"
        onPress={() => setMonth(currentMonth(profile.timezone))}
      >
        Mes actual
      </Button>
      <Button
        variant="secondary"
        onPress={() => setMonth(shiftMonth(month, 1))}
      >
        Mes siguiente
      </Button>
      {pending && (
        <Button onPress={() => open(pending.editor)}>
          Comprobar operación pendiente
        </Button>
      )}
      {query.isPending || query.isFetching ? (
        <LoadingState label="Actualizando obligaciones…" />
      ) : query.isError ? (
        <ErrorState
          message={recurringErrorMessage(query.error)}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          {!pending && (
            <Button
              disabled={query.data.categories.length === 0}
              onPress={() =>
                open({
                  kind: 'create',
                  id: randomUUID(),
                  categories: query.data.categories,
                  month: currentMonth(profile.timezone),
                })
              }
            >
              Crear plantilla
            </Button>
          )}
          {query.data.categories.length === 0 && (
            <AppText>
              Crea una categoría de un fondo disponible en Gastos personales
              antes de crear una plantilla.
            </AppText>
          )}
          {!query.data.period && (
            <AppText>
              Configura el presupuesto del mes para confirmar gastos reales.
              Puedes crear plantillas sin presupuesto.
            </AppText>
          )}
          {query.data.period?.status === 'CLOSED' && (
            <AppText>
              Este mes está cerrado; las obligaciones y gastos se muestran sin
              permitir nuevos gastos.
            </AppText>
          )}
          {query.data.items.length === 0 && (
            <AppText>Aún no hay plantillas personales.</AppText>
          )}
          {query.data.items.map(({ template, actual, dueDate, status }) => (
            <RecurringCard
              key={template.id}
              template={template}
              status={status}
              dueDate={dueDate}
              actual={actual}
              canResolve={
                !pending &&
                status === 'PENDING' &&
                template.amountMode === 'VARIABLE' &&
                query.data.period?.status === 'OPEN' &&
                query.data.period.base_currency === template.currency &&
                query.data.categories.some((c) => c.id === template.categoryId)
              }
              onResolve={() => {
                const period = query.data.period;
                if (period) {
                  const today = financialDate(profile.timezone);
                  open({
                    kind: 'resolve',
                    id: randomUUID(),
                    template,
                    period,
                    date:
                      today >= period.starts_on && today <= period.ends_on
                        ? today
                        : (dueDate ?? period.starts_on),
                  });
                }
              }}
              canStop={
                !pending &&
                (!template.stoppedFrom ||
                  template.stoppedFrom > currentMonth(profile.timezone))
              }
              onStop={() =>
                open({
                  kind: 'stop',
                  id: randomUUID(),
                  template,
                  month: currentMonth(profile.timezone),
                })
              }
            />
          ))}
        </>
      )}
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onPress={() => {
          void query.refetch();
        }}
      >
        Actualizar obligaciones
      </Button>
      <Button variant="secondary" onPress={() => router.push('/expenses')}>
        Gastos personales
      </Button>
    </Screen>
  );
}
function RecurringCard({
  template,
  actual,
  status,
  dueDate,
  canResolve,
  onResolve,
  canStop,
  onStop,
}: {
  template: RecurringExpense;
  actual: Awaited<
    ReturnType<typeof readRecurringMonth>
  >['items'][number]['actual'];
  status: string;
  dueDate: string | null;
  canResolve: boolean;
  onResolve: () => void;
  canStop: boolean;
  onStop: () => void;
}) {
  return (
    <>
      <AppText variant="section">{template.name}</AppText>
      <AppText>
        {template.amountMode === 'VARIABLE' ? 'Variable' : 'Fijo'} ·{' '}
        {template.currency} · desde {template.activeFrom.slice(0, 7)}
        {template.activeUntil
          ? ' hasta ' + template.activeUntil.slice(0, 7)
          : ''}
      </AppText>
      {template.stoppedFrom && (
        <AppText>
          Detenida desde {template.stoppedFrom.slice(0, 7)}. El historial se
          conserva.
        </AppText>
      )}
      {dueDate && <AppText>Vencimiento: {dueDate}</AppText>}
      {actual ? (
        <AppText>
          {status === 'CANCELLED'
            ? 'Cancelada: gasto eliminado; no vuelve a pendiente. Restaurar el mismo gasto recuperará esta obligación.'
            : 'Resuelta: gasto real'}{' '}
          · {formatMoney(createMoney(actual.amountMinor, actual.currency))} ·{' '}
          {actual.transactionDate}
        </AppText>
      ) : (
        <AppText>
          {status === 'INACTIVE'
            ? 'No vigente en este mes'
            : template.amountMode === 'FIXED'
              ? 'Fijo pendiente; confirmación aún no disponible.'
              : 'Pendiente de importe real.'}{' '}
          {template.defaultAmountMinor === null
            ? 'Estimación desconocida.'
            : `Referencia, no gasto: ${formatMoney(createMoney(template.defaultAmountMinor, template.currency))}`}
        </AppText>
      )}
      {status === 'PENDING' && template.amountMode === 'VARIABLE' && (
        <Button disabled={!canResolve} onPress={onResolve}>
          {'Confirmar ' + template.name}
        </Button>
      )}
      {status === 'PENDING' &&
        template.amountMode === 'VARIABLE' &&
        !canResolve && (
          <AppText>
            Para confirmar se necesita un mes abierto, la misma moneda y una
            categoría activa disponible.
          </AppText>
        )}
      {canStop && (
        <Button variant="secondary" onPress={onStop}>
          {'Detener ' + template.name}
        </Button>
      )}
    </>
  );
}
