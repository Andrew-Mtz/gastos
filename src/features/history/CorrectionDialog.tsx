import { useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormScreen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { formatMoney } from '../budget/budget-setup';
import {
  amountInput,
  buildCorrectionRequest,
  correctionErrorMessage,
  correctionKey,
  readCorrectionContext,
  readRevisionPage,
  revisionsKey,
  type CorrectionAction,
  type CorrectionContext,
  type CorrectionForm,
  type CorrectionRequest,
  type CorrectionTarget,
} from './correction-data';
import { spacing } from '../../theme/tokens';

export function CorrectionDialog({
  owner,
  transactionId,
  pending,
  busy,
  onCancel,
  onSave,
}: {
  owner: string;
  transactionId: string;
  pending: CorrectionRequest | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (request: CorrectionRequest) => Promise<void>;
}) {
  const query = useQuery({
    queryKey: correctionKey(owner, transactionId),
    queryFn: ({ signal }) =>
      readCorrectionContext(owner, transactionId, signal),
  });
  // An uncertain mutation can always be reconciled using its original payload,
  // even when current reads fail or show a later revision/closed period.
  if (pending)
    return (
      <CorrectionReview
        request={pending}
        onCancel={onCancel}
        onSave={onSave}
        pending
        context={query.data}
        busy={busy}
      />
    );
  if (query.isPending || query.isFetching)
    return (
      <FormScreen>
        <LoadingState label="Actualizando movimiento…" />
        <Button onPress={onCancel}>Volver al historial</Button>
      </FormScreen>
    );
  if (query.isError)
    return (
      <FormScreen>
        <ErrorState
          message="No se pudo cargar el movimiento."
          onRetry={() => {
            void query.refetch();
          }}
        />
        <Button onPress={onCancel}>Volver al historial</Button>
      </FormScreen>
    );
  return (
    <CorrectionEditor
      key={`${transactionId}:${query.data.target.revision}`}
      context={query.data}
      onCancel={onCancel}
      onSave={onSave}
    />
  );
}
function CorrectionEditor({
  context,
  onCancel,
  onSave,
}: {
  context: CorrectionContext;
  onCancel: () => void;
  onSave: (request: CorrectionRequest) => Promise<void>;
}) {
  const target = context.target;
  const [form, setForm] = useState<CorrectionForm>({
    amount: amountInput(target),
    date: target.transaction_date,
    description: target.description ?? '',
    categoryId: target.category_id,
  });
  const [review, setReview] = useState<CorrectionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revisions = useInfiniteQuery({
    queryKey: revisionsKey(target.owner_profile_id, target.id),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam, signal }) =>
      readRevisionPage(target.owner_profile_id, target.id, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor,
  });
  const prepare = (action: CorrectionAction) => {
    try {
      setReview(buildCorrectionRequest(randomUUID(), context, action, form));
      setError(null);
    } catch {
      setError(
        'Revisa el importe positivo, la fecha dentro del mes, la categoría y la descripción de hasta 500 caracteres.',
      );
    }
  };
  if (review)
    return (
      <CorrectionReview
        request={review}
        context={context}
        onCancel={() => setReview(null)}
        onSave={onSave}
      />
    );
  return (
    <FormScreen>
      <AppText variant="title">Corregir movimiento</AppText>
      <AppText>
        Versión {target.revision} · {target.currency} ·{' '}
        {context.period.starts_on.slice(0, 7)}
      </AppText>
      <AppText>
        La moneda, el tipo y el mes no cambian. No registres una fecha falsa
        para resolver una obligación anterior.
      </AppText>
      {target.savings_goal_id && (
        <AppText>Este movimiento conserva su meta original.</AppText>
      )}
      {target.recurring_template_id && (
        <AppText>
          El gasto conserva su obligación recurrente y categoría originales.
          Puedes corregir el importe real sin crear otro pago.
        </AppText>
      )}
      {context.period.status === 'CLOSED' ? (
        <AppText>
          Este período está cerrado. No se permiten correcciones hasta su
          reapertura explícita.
        </AppText>
      ) : target.deleted_at ? (
        <>
          <AppText>
            Movimiento eliminado. No participa en los cálculos actuales.
          </AppText>
          <Button onPress={() => prepare('RESTORE')}>
            Revisar restauración
          </Button>
        </>
      ) : (
        <>
          <TextField
            label="Importe corregido"
            value={form.amount}
            onChangeText={(amount) => setForm((f) => ({ ...f, amount }))}
            keyboardType="decimal-pad"
          />
          <TextField
            label="Fecha corregida (AAAA-MM-DD)"
            value={form.date}
            onChangeText={(date) => setForm((f) => ({ ...f, date }))}
          />
          <TextField
            label="Descripción corregida"
            value={form.description}
            onChangeText={(description) =>
              setForm((f) => ({ ...f, description }))
            }
          />
          {target.type === 'EXPENSE' && !target.recurring_template_id && (
            <>
              <AppText>
                Categoría:{' '}
                {context.allCategories.find((c) => c.id === form.categoryId)
                  ?.name ?? 'Sin categoría'}
              </AppText>
              {context.categories.map((category) => (
                <Button
                  key={category.id}
                  variant="secondary"
                  aria-pressed={form.categoryId === category.id}
                  onPress={() =>
                    setForm((f) => ({ ...f, categoryId: category.id }))
                  }
                >{`Usar ${category.name}`}</Button>
              ))}
            </>
          )}
          {error && <AppText role="alert">{error}</AppText>}
          <Button onPress={() => prepare('EDIT')}>Revisar corrección</Button>
          <Button variant="secondary" onPress={() => prepare('DELETE')}>
            Revisar eliminación
          </Button>
        </>
      )}
      <Button variant="secondary" onPress={onCancel}>
        Volver al historial
      </Button>
      <AppText variant="section">Historial de correcciones</AppText>
      {revisions.isPending ||
      (revisions.isFetching && !revisions.isFetchingNextPage) ? (
        <LoadingState label="Actualizando correcciones…" />
      ) : revisions.isError ? (
        <ErrorState
          message="No se pudo cargar el historial de correcciones."
          onRetry={() => {
            void revisions.refetch();
          }}
        />
      ) : (
        <>
          {revisions.data.pages[0]?.items.length === 0 && (
            <AppText>Sin correcciones registradas.</AppText>
          )}
          {revisions.data.pages
            .flatMap((p) => p.items)
            .map((event) => (
              <View key={event.revision} style={{ gap: spacing.sm }}>
                <AppText>
                  Versión {event.revision} · {actionLabels[event.action]} ·{' '}
                  {event.recorded_at}
                </AppText>
                <Snapshot
                  label="Antes"
                  target={event.before_state}
                  context={context}
                />
                <Snapshot
                  label="Después"
                  target={event.after_state}
                  context={context}
                />
              </View>
            ))}
          {revisions.hasNextPage && (
            <Button
              loading={revisions.isFetchingNextPage}
              onPress={() => {
                void revisions.fetchNextPage();
              }}
            >
              Cargar más correcciones
            </Button>
          )}
        </>
      )}
    </FormScreen>
  );
}
const actionLabels = {
  EDIT: 'Corrección',
  DELETE: 'Eliminación',
  RESTORE: 'Restauración',
};
function Snapshot({
  label,
  target,
  context,
}: {
  label: string;
  target: CorrectionTarget;
  context?: CorrectionContext;
}) {
  const category = context?.allCategories.find(
    (c) => c.id === target.category_id,
  )?.name;
  return (
    <AppText>
      {label}: {formatMoney(createMoney(target.amount_minor, target.currency))}{' '}
      · {target.transaction_date}
      {category ? ` · ${category}` : ''} ·{' '}
      {target.description ?? 'Sin descripción'}
      {target.deleted_at ? ' · Eliminado' : ''}
    </AppText>
  );
}
function CorrectionReview({
  request,
  pending = false,
  context,
  busy = false,
  onCancel,
  onSave,
}: {
  request: CorrectionRequest;
  pending?: boolean;
  context?: CorrectionContext;
  busy?: boolean;
  onCancel: () => void;
  onSave: (request: CorrectionRequest) => Promise<void>;
}) {
  const mutation = useMutation({ mutationFn: onSave, retry: false });
  return (
    <FormScreen>
      <AppText variant="title">
        {pending ? 'Comprobar operación pendiente' : 'Confirmar cambio'}
      </AppText>
      <AppText>
        {actionLabels[request.action]} · Versión {request.target.revision}
      </AppText>
      <Snapshot label="Original" target={request.target} context={context} />
      {request.changes && (
        <Snapshot
          label="Corrección"
          target={{ ...request.target, ...request.changes }}
          context={context}
        />
      )}
      {request.action === 'EDIT' &&
        request.changes?.category_id !== request.target.category_id && (
          <AppText>
            La categoría y el consumo del fondo se corregirán según tu
            selección.
          </AppText>
        )}
      {request.action === 'DELETE' && (
        <AppText>
          Se quitará su efecto de los cálculos. Se conservará el historial y
          podrás restaurarlo si el mes está abierto y los fondos lo permiten.
        </AppText>
      )}
      {request.action === 'DELETE' && request.target.recurring_template_id && (
        <AppText>
          Eliminar este gasto CANCELA la obligación recurrente de este mes, no
          solo su pago. No volverá a aparecer como pendiente ni como compromiso.
        </AppText>
      )}
      {request.action === 'RESTORE' && (
        <AppText>
          Se restaurará el mismo movimiento con su importe corregido, sin crear
          otro. Volverá a afectar los cálculos.
        </AppText>
      )}
      {request.target.type.startsWith('SAVINGS_') && (
        <AppText>
          Este cambio modifica el ahorro general o la meta original y la
          disponibilidad del mes. No realiza una transferencia bancaria. Los
          fondos históricos deben seguir siendo suficientes.
        </AppText>
      )}
      {pending && (
        <AppText>
          Se comprobará exactamente la misma solicitud. Un resultado anterior no
          reemplaza correcciones posteriores.
        </AppText>
      )}
      {mutation.isError && (
        <AppText role="alert">{correctionErrorMessage(mutation.error)}</AppText>
      )}
      <Button
        loading={busy || mutation.isPending}
        onPress={() => mutation.mutate(request)}
      >
        {pending ? 'Comprobar la misma operación' : 'Confirmar cambio'}
      </Button>
      <Button variant="secondary" onPress={onCancel}>
        {pending ? 'Volver al historial' : 'Cancelar cambio'}
      </Button>
    </FormScreen>
  );
}
