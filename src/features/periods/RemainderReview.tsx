import {
  SharedResponsibilities,
  SharedResponsibilitiesSummary,
} from '../budget/SharedResponsibilities';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { randomUUID } from 'expo-crypto';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { createMoney } from '../../domain/money/money';
import { formatMoney } from '../budget/budget-setup';
import type { PeriodOperation } from './period-close-data';
import {
  buildDisposeRequest,
  buildReverseRequest,
  readRemainder,
  readReversal,
  remainderKey,
  reversalKey,
  type DisposeRequest,
} from './remainder-data';
import { dispositionActionSchema } from './remainder-schema';

const formSchema = z.object({
  amount: z.string().trim().min(1, 'Ingresa un importe.'),
  action: dispositionActionSchema.nullable(),
  bucketId: z.string().nullable(),
});
type Form = z.infer<typeof formSchema>;
type Actions = {
  disabled: boolean;
  onSubmit: (operation: PeriodOperation) => void;
  onCancel: () => void;
};
export function RemainderReview({
  owner,
  month,
  disabled,
  onSubmit,
  onCancel,
}: Actions & { owner: string; month: string }) {
  const query = useQuery({
    queryKey: remainderKey(owner, month),
    queryFn: ({ signal }) => readRemainder(owner, month, signal),
    staleTime: 0,
  });
  const [review, setReview] = useState<DisposeRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Form>({
    resolver: zodResolver(formSchema),
    defaultValues: { amount: '', action: null, bucketId: null },
  });
  const action = useWatch({ control: form.control, name: 'action' }),
    bucketId = useWatch({ control: form.control, name: 'bucketId' });
  const row = query.data;
  const prepare = form.handleSubmit((values) => {
    if (!row || query.isFetching || query.isError || disabled) return;
    try {
      if (!values.action) throw new Error('Elige qué hacer con el remanente.');
      setReview(
        buildDisposeRequest(
          randomUUID(),
          row,
          values.action,
          values.amount,
          values.bucketId,
        ),
      );
      setError(null);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Revisa los datos.',
      );
    }
  });
  const changeAction = (next: DisposeRequest['action']) => {
    form.setValue('action', next);
    form.setValue('bucketId', null);
    setReview(null);
    setError(null);
  };
  return (
    <>
      <AppText variant="section">Disponer del remanente y cerrar</AppText>
      {!query.isPending &&
        !query.isFetching &&
        (query.isError ? (
          <SharedResponsibilities owner={owner} month={month} />
        ) : (
          row?.close.sharedResponsibilities && (
            <SharedResponsibilitiesSummary
              data={row.close.sharedResponsibilities}
              onRefresh={() => {
                setReview(null);
                void query.refetch();
              }}
            />
          )
        ))}
      {query.isPending || query.isFetching ? (
        <LoadingState label="Revisando remanente actual…" />
      ) : query.isError || !row ? (
        <ErrorState
          message="No se pudo revisar el remanente completo. No se usarán cifras anteriores."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : !row.cap || row.cap.amountMinor <= 0 ? (
        <AppText>
          No hay un remanente neto positivo elegible. Revisa la distribución,
          los déficits y las obligaciones antes de cerrar con una disposición.
        </AppText>
      ) : (
        <>
          <AppText>
            Máximo neto del mes: {formatMoney(row.cap)}. Incluye los déficits,
            aportes y retiros; no es la suma de fondos positivos ni un saldo
            bancario.
          </AppText>
          <AppText>
            El ahorro por porcentaje ya está protegido y acumulado. No se
            volverá a trasladar. Lo que no dispongas quedará como historia, no
            disponible automáticamente el mes siguiente.
          </AppText>
          <Button
            variant="secondary"
            disabled={disabled}
            onPress={() => changeAction('SAVINGS')}
          >
            Aportar a ahorro general
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            onPress={() => changeAction('CARRY_BUCKET')}
          >
            Arrastrar a un fondo del mes siguiente
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            onPress={() => changeAction('CARRY_UNALLOCATED')}
          >
            Mantener disponible sin asignar el mes siguiente
          </Button>
          {action && (
            <AppText>
              Elegido:{' '}
              {action === 'SAVINGS'
                ? 'Ahorro general'
                : action === 'CARRY_BUCKET'
                  ? 'Fondo de destino explícito'
                  : 'Crédito de arrastre sin asignar'}
              .
            </AppText>
          )}
          {action !== null && action !== 'SAVINGS' && (
            <AppText>
              Destino:{' '}
              {row.destination?.starts_on.slice(0, 7) ??
                'Sin presupuesto configurado'}
              . Debe estar abierto, configurado al 100% y en{' '}
              {row.close.period.base_currency}. Este crédito no es ingreso y no
              vuelve a repartirse por porcentajes.
            </AppText>
          )}
          {action === 'CARRY_BUCKET' &&
            row.destination_buckets.map((b) => (
              <Button
                key={b.id}
                variant="secondary"
                disabled={disabled}
                onPress={() => {
                  form.setValue('bucketId', b.id);
                  setReview(null);
                }}
              >{`${bucketId === b.id ? '✓ ' : ''}${b.name}`}</Button>
            ))}
          <Controller
            control={form.control}
            name="amount"
            render={({ field, fieldState }) => (
              <TextField
                label="Importe del remanente"
                value={field.value}
                onChangeText={(value) => {
                  field.onChange(value);
                  setReview(null);
                }}
                onBlur={field.onBlur}
                keyboardType="decimal-pad"
                editable={!disabled}
                error={fieldState.error?.message}
              />
            )}
          />
          {error && <AppText role="alert">{error}</AppText>}
          {!review && (
            <Button
              disabled={disabled}
              onPress={() => {
                void prepare();
              }}
            >
              Revisar disposición y cierre
            </Button>
          )}
          {review && review.hash === row.preview_hash && (
            <>
              <AppText variant="section">Confirmar ambos efectos</AppText>
              <AppText>
                {formatMoney(createMoney(review.amount, review.currency))} de{' '}
                {month.slice(0, 7)} irá a{' '}
                {review.action === 'SAVINGS'
                  ? `ahorro general como aporte adicional con fecha ${row.close.period.ends_on}`
                  : review.action === 'CARRY_UNALLOCATED'
                    ? `crédito disponible sin asignar de ${row.destination?.starts_on.slice(0, 7)}`
                    : `${row.destination_buckets.find((b) => b.id === review.destinationBucketId)?.name}, ${row.destination?.starts_on.slice(0, 7)}`}
                . El mes de origen quedará cerrado con evidencia posterior a
                esta acción. No se hará una transferencia bancaria.
              </AppText>
              {review.action !== 'SAVINGS' && (
                <AppText>
                  Para reabrir el origen tendrás que revertir explícitamente
                  este arrastre y reabrirlo a la vez. El destino deberá estar
                  abierto, conservar fondos netos suficientes y no tener
                  obligaciones pendientes.
                </AppText>
              )}
              <Button
                disabled={disabled}
                onPress={() => onSubmit({ kind: 'dispose', request: review })}
              >
                Confirmar disposición y cierre
              </Button>
            </>
          )}
        </>
      )}
      <Button variant="secondary" onPress={onCancel}>
        Cancelar disposición
      </Button>
    </>
  );
}
export function ReversalReview({
  owner,
  dispositionId,
  disabled,
  onSubmit,
  onCancel,
}: Actions & { owner: string; dispositionId: string }) {
  const query = useQuery({
    queryKey: reversalKey(owner, dispositionId),
    queryFn: ({ signal }) => readReversal(owner, dispositionId, signal),
    staleTime: 0,
  });
  const row = query.data;
  return (
    <>
      <AppText variant="section">Revertir arrastre y reabrir origen</AppText>
      {!query.isPending && !query.isFetching && !query.isError && row && (
        <>
          {row.source.sharedResponsibilities && (
            <SharedResponsibilitiesSummary
              data={row.source.sharedResponsibilities}
              onRefresh={() => {
                void query.refetch();
              }}
            />
          )}
          {row.destination.sharedResponsibilities && (
            <SharedResponsibilitiesSummary
              data={row.destination.sharedResponsibilities}
              onRefresh={() => {
                void query.refetch();
              }}
            />
          )}
        </>
      )}
      {query.isPending || query.isFetching ? (
        <LoadingState label="Revisando ambos períodos…" />
      ) : query.isError || !row ? (
        <ErrorState
          message="No se pudo verificar la reversión. No se usarán datos históricos como fondos actuales."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <>
          <AppText>
            Se quitarán{' '}
            {formatMoney(
              createMoney(
                row.disposition.amount_minor,
                row.disposition.currency,
              ),
            )}{' '}
            del arrastre de {row.destinationPeriod.starts_on.slice(0, 7)} y se
            devolverán al origen {row.source.month.slice(0, 7)}. El origen se
            reabrirá para correcciones en la misma acción. Ambos efectos y el
            cierre anterior quedarán registrados.
          </AppText>
          <AppText>
            El destino conserva un remanente neto de{' '}
            {formatMoney(
              row.destination.availability.savings
                .ordinaryRemainderBeforeCommitments,
            )}{' '}
            antes de compromisos. No es un saldo bancario. No se retirarán
            ahorros ni se resolverán o cancelarán obligaciones automáticamente.
          </AppText>
          {row.can_reverse ? (
            <Button
              disabled={disabled}
              onPress={() =>
                onSubmit({
                  kind: 'reverse',
                  request: buildReverseRequest(randomUUID(), row),
                })
              }
            >
              Confirmar reversión y reapertura
            </Button>
          ) : (
            <AppText role="alert">
              No se puede revertir ahora: el origen debe estar cerrado y el
              destino abierto y configurado, sin obligaciones actuales o
              anteriores, y con fondos netos suficientes. Si hay otro arrastre
              posterior, revísalo primero; no se deshará automáticamente.
            </AppText>
          )}
        </>
      )}
      <Button variant="secondary" onPress={onCancel}>
        Cancelar reversión
      </Button>
    </>
  );
}
