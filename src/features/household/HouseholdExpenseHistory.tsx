import { sharedBudgetLabels } from './shared-expense-data';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { useAuth } from '../auth/AuthProvider';
import { decimalText, formatMoney } from '../budget/budget-setup';
import {
  readSharedExpensePage,
  readSharedExpenseHistoryDetail,
  sharedExpenseHistoryDetailKey,
  sharedExpenseHistoryKey,
  sharedExpenseHistoryListKey,
  sharedExpenseHistoryRows,
} from './shared-expense-history-data';

type Props = {
  profileId: string;
  householdId: string;
  householdName: string;
};
// The parent unmounts household children on focus/background/access revalidation.
// History is separate from the submitted-entry receipt and never settles a write.
export function HouseholdExpenseHistory(props: Props) {
  return (
    <HistorySection
      key={`${props.profileId}:${props.householdId}`}
      {...props}
    />
  );
}
function HistorySection(props: Props) {
  const [open, setOpen] = useState(false);
  const { isCurrentUser } = useAuth();
  if (!isCurrentUser(props.profileId)) return null;
  return open ? (
    <History {...props} onClose={() => setOpen(false)} />
  ) : (
    <Button
      variant="secondary"
      accessibilityLabel={`Ver historial de ${props.householdName}`}
      onPress={() => setOpen(true)}
    >
      Ver gastos compartidos
    </Button>
  );
}
function History({
  profileId,
  householdId,
  householdName,
  onClose,
}: Props & { onClose: () => void }) {
  const client = useQueryClient();
  const { isCurrentUser } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const listKey = sharedExpenseHistoryListKey(profileId, householdId);
  const query = useInfiniteQuery({
    queryKey: listKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      readSharedExpensePage(profileId, householdId, pageParam, signal),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    select: (data) => ({ ...data, rows: sharedExpenseHistoryRows(data.pages) }),
    retry: false,
    refetchOnMount: 'always',
  });
  useEffect(
    () => () => {
      // Removing an observer is not enough: explicitly abort and remove scoped data.
      // Destroyed queries cannot be restored by a late response after auth clear.
      const key = sharedExpenseHistoryKey(profileId, householdId);
      void client.cancelQueries({ queryKey: key });
      client.removeQueries({ queryKey: key });
    },
    [client, profileId, householdId],
  );
  const name = (id: string) =>
    query.data?.pages.at(-1)?.members.find((member) => member.id === id)
      ?.display_name ?? `Miembro histórico (${id})`;
  const refresh = () => {
    setSelected(null);
    // A refresh starts from the beginning, not a concatenation of old pages.
    void client.resetQueries({ queryKey: listKey, exact: true });
  };
  if (!isCurrentUser(profileId)) return null;
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="section">Gastos compartidos de {householdName}</AppText>
      <AppText>
        Del más reciente al más antiguo por fecha del gasto. Cada importe
        conserva su moneda original; no se suman monedas distintas.
      </AppText>
      {selected ? (
        <ExpenseDetail
          key={selected}
          profileId={profileId}
          householdId={householdId}
          expenseId={selected}
          onBack={refresh}
        />
      ) : query.isPending || query.isFetching ? (
        <LoadingState
          label={
            query.isFetchingNextPage
              ? 'Comprobando más gastos…'
              : 'Comprobando historial del hogar…'
          }
        />
      ) : query.isError || !query.isFetchedAfterMount || !query.data ? (
        <ErrorState
          message="No pudimos comprobar el historial. No se muestran gastos guardados sin confirmar el acceso."
          onRetry={refresh}
        />
      ) : (
        <>
          {query.data.rows.length === 0 ? (
            <AppText>Aún no hay gastos compartidos en este hogar.</AppText>
          ) : (
            query.data.rows.map((expense) => (
              <View key={expense.expense_id} style={{ gap: 4 }}>
                <AppText>
                  {expense.transaction_date} ·{' '}
                  {formatMoney(
                    createMoney(expense.amount_minor, expense.currency),
                  )}
                </AppText>
                <AppText>
                  {expense.description || 'Gasto compartido sin descripción'}
                </AppText>
                <AppText>
                  Clasificación:{' '}
                  {expense.budget_classification
                    ? sharedBudgetLabels[expense.budget_classification]
                    : 'Sin clasificación histórica'}
                </AppText>
                <AppText>Pagó: {name(expense.payer_member_id)}</AppText>
                <Button
                  variant="secondary"
                  accessibilityLabel={`Ver gasto ${expense.expense_id}`}
                  onPress={() => setSelected(expense.expense_id)}
                >
                  Ver detalle
                </Button>
              </View>
            ))
          )}
          {query.hasNextPage ? (
            <Button
              onPress={() => {
                if (!query.isFetching)
                  void query.fetchNextPage({ cancelRefetch: false });
              }}
            >
              Cargar más gastos
            </Button>
          ) : query.data.rows.length > 0 ? (
            <AppText>Fin del historial.</AppText>
          ) : null}
        </>
      )}
      {!selected && (
        <Button
          variant="secondary"
          disabled={query.isFetching}
          onPress={refresh}
        >
          Actualizar historial
        </Button>
      )}
      <Button variant="text" onPress={onClose}>
        Cerrar historial
      </Button>
    </View>
  );
}
function ExpenseDetail({
  profileId,
  householdId,
  expenseId,
  onBack,
}: {
  profileId: string;
  householdId: string;
  expenseId: string;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const { isCurrentUser } = useAuth();
  const query = useQuery({
    queryKey: sharedExpenseHistoryDetailKey(profileId, householdId, expenseId),
    queryFn: ({ signal }) =>
      readSharedExpenseHistoryDetail(profileId, householdId, expenseId, signal),
    retry: false,
    refetchOnMount: 'always',
  });
  useEffect(
    () => () => {
      const key = sharedExpenseHistoryDetailKey(
        profileId,
        householdId,
        expenseId,
      );
      void client.cancelQueries({ queryKey: key, exact: true });
      client.removeQueries({ queryKey: key, exact: true });
    },
    [client, profileId, householdId, expenseId],
  );
  if (!isCurrentUser(profileId)) return null;
  const expense = query.data?.expense;
  const name = (id: string) =>
    query.data?.members.find((member) => member.id === id)?.display_name ??
    `Miembro histórico (${id})`;
  return (
    <View style={{ gap: 8 }}>
      {query.isFetching || query.isPending ? (
        <LoadingState label="Comprobando detalle del gasto…" />
      ) : query.isError || !query.isFetchedAfterMount || !expense ? (
        <ErrorState
          message="No pudimos comprobar este gasto. Actualiza o vuelve a iniciar sesión."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <AppText variant="section">Detalle del gasto compartido</AppText>
          <AppText>Comprobante: {expense.expense_id}</AppText>
          <AppText>
            Total:{' '}
            {formatMoney(createMoney(expense.amount_minor, expense.currency))}
          </AppText>
          <AppText>Fecha: {expense.transaction_date}</AppText>
          <AppText>
            Clasificación:{' '}
            {expense.budget_classification
              ? sharedBudgetLabels[expense.budget_classification]
              : 'Sin clasificación histórica'}
          </AppText>
          <AppText>Pagó: {name(expense.payer_member_id)}</AppText>
          {!!expense.description && <AppText>{expense.description}</AppText>}
          <AppText>
            Responsabilidades guardadas, versión {expense.template_version}. No
            cambian con el reparto ni los miembros actuales.
          </AppText>
          {expense.splits.map((share) => (
            <AppText key={share.member_id}>
              {name(share.member_id)}: {decimalText(share.basis_points, 2)}% ·{' '}
              {formatMoney(
                createMoney(
                  share.responsibility_amount_minor,
                  expense.currency,
                ),
              )}
            </AppText>
          ))}
          <AppText>
            Solo consulta. Sin saldos, deudas ni efectos en presupuestos
            personales.
          </AppText>
        </>
      )}
      <Button variant="secondary" onPress={onBack}>
        Volver al historial
      </Button>
    </View>
  );
}
