import { sharedExpenseHistoryKey } from './shared-expense-history-data';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createMoney } from '../../domain/money/money';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { useAuth } from '../auth/AuthProvider';
import { decimalText, formatMoney } from '../budget/budget-setup';
import { financialDate } from '../income/income-form';
import { readDefaultSplit } from './split-data';
import {
  createSharedExpense,
  mapSharedExpenseReceipt,
  readSharedExpense,
} from './shared-expense-data';
import {
  isRejectedSharedExpense,
  pendingSharedExpenseKey,
  prepareSharedExpense,
  sameSharedExpenseRequest,
  sharedExpenseContextKey,
  sharedExpenseErrorMessage,
  sharedExpenseFormSchema,
  sharedExpenseReceiptKey,
  templateConfirmsSharedExpense,
  type PendingSharedExpense,
  type SharedExpenseForm,
  type SharedExpenseReview,
} from './shared-expense-entry';

type Props = {
  profileId: string;
  householdId: string;
  householdName: string;
  currency: string;
  timezone: string;
};
// Hogar mounts this only after fresh focus/foreground membership validation.
// A scope/currency change discards drafts; submitted exact requests live in auth-cleared cache.
export function HouseholdSharedExpense(props: Props) {
  return (
    <SharedExpenseEntry
      key={`${props.profileId}:${props.householdId}:${props.currency}`}
      {...props}
    />
  );
}
function SharedExpenseEntry({
  profileId,
  householdId,
  householdName,
  currency,
  timezone,
}: Props) {
  const auth = useAuth();
  const currentUser = useRef(auth.isCurrentUser);
  useLayoutEffect(() => {
    currentUser.current = auth.isCurrentUser;
  }, [auth.isCurrentUser]);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const client = useQueryClient();
  const pendingKey = pendingSharedExpenseKey(profileId, householdId);
  const contextKey = sharedExpenseContextKey(profileId, householdId);
  const pendingQuery = useQuery<PendingSharedExpense | null>({
    queryKey: pendingKey,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    gcTime: Infinity,
  });
  const pending = pendingQuery.data ?? null;
  const context = useQuery({
    queryKey: contextKey,
    queryFn: ({ signal }) => readDefaultSplit(profileId, householdId, signal),
    retry: false,
    refetchOnMount: 'always',
  });
  const ready =
    context.isSuccess && !context.isFetching && context.isFetchedAfterMount;
  const receipt = useQuery({
    queryKey: sharedExpenseReceiptKey(
      profileId,
      householdId,
      pending?.request.id ?? null,
    ),
    queryFn: async ({ signal }) => {
      if (!pending) throw new Error('A pending expense is required.');
      const value = await readSharedExpense(
        profileId,
        householdId,
        pending.request.id,
        signal,
      );
      return mapSharedExpenseReceipt(profileId, pending.request, value);
    },
    enabled: !!pending && !pending.inFlight && ready,
    retry: false,
    refetchOnMount: 'always',
  });
  const confirmed =
    pending &&
    !pending.inFlight &&
    ready &&
    receipt.isSuccess &&
    !receipt.isFetching &&
    receipt.isFetchedAfterMount
      ? receipt.data
      : null;
  const confirmedId = confirmed?.expense_id;
  useEffect(() => {
    if (confirmedId)
      void client.invalidateQueries({
        queryKey: sharedExpenseHistoryKey(profileId, householdId),
      });
  }, [client, confirmedId, profileId, householdId]);
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState<SharedExpenseReview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SharedExpenseForm>({
    resolver: zodResolver(sharedExpenseFormSchema(currency)),
    defaultValues: {
      amount: '',
      date: financialDate(timezone),
      payerMemberId: '',
      description: '',
    },
  });
  const resetDraft = () => {
    setEditing(false);
    setReview(null);
    reset({
      amount: '',
      date: financialDate(timezone),
      payerMemberId: '',
      description: '',
    });
  };
  const currentCache = () =>
    client.getQueryCache().find({ queryKey: pendingKey, exact: true });
  const refresh = async () => {
    setReview(null);
    await context.refetch();
  };
  const prepare = async (form: SharedExpenseForm) => {
    if (busy.current || pending || !ready || !currentUser.current(profileId))
      return;
    busy.current = true;
    const cache = currentCache();
    setNotice(null);
    const result = await context.refetch();
    busy.current = false;
    if (
      !mounted.current ||
      !currentUser.current(profileId) ||
      currentCache() !== cache
    )
      return;
    if (!result.isSuccess || !result.data) return;
    try {
      setReview(
        prepareSharedExpense(
          profileId,
          householdId,
          currency,
          result.data,
          randomUUID(),
          form,
        ),
      );
    } catch {
      setReview(null);
      setNotice(
        'No hay un reparto vigente o el pagador ya no está activo. Actualiza y revisa el gasto.',
      );
    }
  };
  const submit = async (request: SharedExpenseReview['request']) => {
    const previous = client.getQueryData<PendingSharedExpense | null>(
      pendingKey,
    );
    if (
      !mounted.current ||
      !currentUser.current(profileId) ||
      busy.current ||
      previous?.inFlight ||
      (previous && !sameSharedExpenseRequest(previous.request, request)) ||
      (!previous && !ready)
    )
      return;
    busy.current = true;
    const cache = currentCache();
    const currentSession = () =>
      currentUser.current(profileId) && currentCache() === cache;
    setNotice(null);
    if (!previous) {
      // Recheck immediately before the new write. The RPC repeats this under locks.
      const result = await context.refetch();
      if (!mounted.current || !currentSession()) {
        busy.current = false;
        return;
      }
      if (
        !result.isSuccess ||
        !result.data ||
        !templateConfirmsSharedExpense(request, result.data)
      ) {
        busy.current = false;
        setReview(null);
        setNotice(
          result.isSuccess
            ? sharedExpenseErrorMessage({ code: '40001' })
            : 'No pudimos validar el reparto antes de confirmar. No se envió el gasto.',
        );
        return;
      }
    }
    client.setQueryData<PendingSharedExpense>(pendingKey, {
      request,
      inFlight: true,
    });
    setEditing(false);
    setReview(null);
    const isCurrent = () => {
      const latest = client.getQueryData<PendingSharedExpense | null>(
        pendingKey,
      );
      return (
        currentSession() &&
        !!latest &&
        sameSharedExpenseRequest(latest.request, request)
      );
    };
    try {
      await createSharedExpense(profileId, request);
      if (isCurrent())
        client.setQueryData<PendingSharedExpense>(pendingKey, {
          request,
          inFlight: false,
        });
    } catch (error) {
      if (!isCurrent()) return;
      // An unknown earlier outcome remains unresolved even if a later retry is denied.
      // Never unlock a new request based on a failed retry or a failed point read.
      client.setQueryData(
        pendingKey,
        !previous && isRejectedSharedExpense(error)
          ? null
          : { request, inFlight: false },
      );
      if (mounted.current)
        setNotice(
          previous
            ? 'La solicitud original sigue sin confirmar. Actualiza el hogar o comprueba otra vez; no se creará un gasto distinto.'
            : sharedExpenseErrorMessage(error),
        );
      if (!previous && isRejectedSharedExpense(error))
        await client.invalidateQueries({ queryKey: contextKey });
    } finally {
      busy.current = false;
      if (previous && isCurrent()) {
        // A fast retry can batch inFlight true/false into one render. Fetch
        // explicitly rather than relying on an enabled transition to read back.
        try {
          await client.fetchQuery({
            queryKey: sharedExpenseReceiptKey(
              profileId,
              householdId,
              request.id,
            ),
            queryFn: async ({ signal }) =>
              mapSharedExpenseReceipt(
                profileId,
                request,
                await readSharedExpense(
                  profileId,
                  householdId,
                  request.id,
                  signal,
                ),
              ),
            staleTime: 0,
            retry: false,
          });
        } catch {
          // Point-read failure is uncertain, never proof that the write failed.
        }
      }
    }
  };
  const name = (memberId: string) =>
    context.data?.roster.find((member) => member.id === memberId)
      ?.display_name ?? `Miembro ${memberId}`;
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="section">Gasto compartido</AppText>
      <AppText>
        Cualquier miembro activo puede registrar gastos. Se aplica el reparto
        del propietario, sin cambios por gasto ni por quién pagó.
      </AppText>
      {notice && ready && !confirmed && (
        <AppText role="status">{notice}</AppText>
      )}
      {context.isPending || context.isFetching ? (
        <LoadingState label="Comprobando datos para el gasto…" />
      ) : context.isError || !ready ? (
        <ErrorState
          message="No pudimos comprobar el acceso y el reparto. No se muestran datos guardados sin validar."
          onRetry={() => {
            void refresh();
          }}
        />
      ) : pending ? (
        <>
          {confirmed ? (
            <>
              <AppText variant="section">Gasto registrado</AppText>
              <AppText>Comprobante: {confirmed.expense_id}</AppText>
              <AppText>
                Total:{' '}
                {formatMoney(
                  createMoney(confirmed.amount_minor, confirmed.currency),
                )}
              </AppText>
              <AppText>Fecha: {confirmed.transaction_date}</AppText>
              <AppText>Pagó: {name(confirmed.payer_member_id)}</AppText>
              {!!confirmed.description && (
                <AppText>{confirmed.description}</AppText>
              )}
              <AppText>
                Reparto guardado, versión {confirmed.template_version}. No
                cambia con repartos posteriores.
              </AppText>
              {confirmed.splits.map((share) => (
                <AppText key={share.member_id}>
                  {name(share.member_id)}: {decimalText(share.basis_points, 2)}%
                  ·{' '}
                  {formatMoney(
                    createMoney(
                      share.responsibility_amount_minor,
                      confirmed.currency,
                    ),
                  )}
                </AppText>
              ))}
              <Button
                onPress={() => {
                  client.setQueryData(pendingKey, null);
                  client.removeQueries({
                    queryKey: sharedExpenseReceiptKey(
                      profileId,
                      householdId,
                      pending.request.id,
                    ),
                    exact: true,
                  });
                  setNotice(null);
                  resetDraft();
                }}
              >
                Cerrar comprobante
              </Button>
            </>
          ) : (
            <>
              <AppText role="status">
                {pending.inFlight
                  ? 'Registro en curso. Salir no cancela la solicitud.'
                  : receipt.isFetching
                    ? 'Comprobando el comprobante guardado…'
                    : 'Resultado pendiente de confirmación. Conservamos exactamente el mismo gasto; no ingreses otro para reemplazarlo.'}
              </AppText>
              <Button
                disabled={pending.inFlight || receipt.isFetching}
                onPress={() => {
                  void submit(pending.request);
                }}
              >
                Comprobar gasto pendiente
              </Button>
            </>
          )}
        </>
      ) : context.data.status !== 'READY' ? (
        <AppText role="status">
          {context.data.status === 'UNCONFIGURED'
            ? 'El propietario debe configurar el reparto antes de registrar gastos.'
            : 'Cambió la composición del hogar. El propietario debe revisar el reparto antes de registrar gastos.'}
        </AppText>
      ) : review ? (
        <>
          <AppText variant="section">
            Confirmar gasto en {householdName}
          </AppText>
          <AppText>
            Total:{' '}
            {formatMoney(
              createMoney(review.request.amountMinor, review.request.currency),
            )}
          </AppText>
          <AppText>Fecha: {review.request.transactionDate}</AppText>
          <AppText>Pagó: {name(review.request.payerMemberId)}</AppText>
          {!!review.request.description && (
            <AppText>{review.request.description}</AppText>
          )}
          <AppText>
            Reparto automático, versión {review.request.templateVersion}
          </AppText>
          {review.responsibilities.map((share) => (
            <AppText key={share.memberId}>
              {name(share.memberId)}: {decimalText(share.basisPoints, 2)}% ·{' '}
              {formatMoney(share.responsibilityAmount)}
            </AppText>
          ))}
          <AppText>
            Se guardará este gasto y su reparto. Esta etapa todavía no calcula
            saldos ni afecta presupuestos personales.
          </AppText>
          <Button
            onPress={() => {
              void submit(review.request);
            }}
          >
            Confirmar y registrar gasto
          </Button>
          <Button variant="text" onPress={() => setReview(null)}>
            Volver al gasto
          </Button>
          <Button variant="text" onPress={resetDraft}>
            Cancelar gasto
          </Button>
        </>
      ) : editing ? (
        <>
          <AppText>Moneda fija del hogar: {currency}. Sin conversión.</AppText>
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <TextField
                label={`Importe del gasto (${currency})`}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                keyboardType="decimal-pad"
                error={errors.amount?.message}
                editable={!isSubmitting}
              />
            )}
          />
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <TextField
                label="Fecha del gasto (AAAA-MM-DD)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                error={errors.date?.message}
                editable={!isSubmitting}
              />
            )}
          />
          <AppText>¿Quién pagó?</AppText>
          <Controller
            control={control}
            name="payerMemberId"
            render={({ field }) => (
              <>
                {context.data.roster.map((member) => (
                  <Button
                    key={member.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`Pagó ${member.display_name}`}
                    accessibilityState={{ checked: field.value === member.id }}
                    variant="secondary"
                    disabled={isSubmitting}
                    onPress={() => {
                      field.onChange(member.id);
                      field.onBlur();
                    }}
                  >
                    {`Pagó ${member.display_name}${field.value === member.id ? ' (seleccionado)' : ''}`}
                  </Button>
                ))}
              </>
            )}
          />
          {errors.payerMemberId?.message && (
            <AppText role="alert" tone="danger">
              {errors.payerMemberId.message}
            </AppText>
          )}
          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <TextField
                label="Descripción del gasto (opcional)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                error={errors.description?.message}
                editable={!isSubmitting}
                multiline
              />
            )}
          />
          <Button
            loading={isSubmitting}
            onPress={() => {
              void handleSubmit(prepare)();
            }}
          >
            Revisar gasto
          </Button>
          <Button variant="text" disabled={isSubmitting} onPress={resetDraft}>
            Cancelar gasto
          </Button>
        </>
      ) : (
        <Button
          accessibilityLabel={`Registrar gasto en ${householdName}`}
          onPress={() => {
            setNotice(null);
            setEditing(true);
          }}
        >
          Registrar gasto compartido
        </Button>
      )}
    </View>
  );
}
