import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormScreen, Screen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import {
  calculatePlannedBudgetAllocation,
  createBudgetAllocationPlan,
} from '../../domain/budget/budget-allocation';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import {
  budgetErrorMessage,
  budgetKey,
  prepareBudgetBuckets,
  readBudget,
  saveInitialBudget,
} from './budget-data';
import {
  bucketKeys,
  bucketLabels,
  currencyDigits,
  currentMonth,
  decimalText,
  formatMoney,
  setupPreview,
  strategies,
  validateSetupForm,
  type BudgetBucket,
  type SetupForm,
  type Strategy,
} from './budget-setup';
import { spacing } from '../../theme/tokens';
import { ReceivedBudgetAvailability } from './ReceivedBudgetAvailability';
import { incomeOwnerKey } from '../income/income-data';
import { BucketConsumption } from './BucketConsumption';
import { consumptionOwnerKey } from './consumption-data';

export function BudgetScreen() {
  const auth = useAuth();
  if (auth.state.status !== 'AUTHENTICATED_READY') return null;
  return (
    <PersonalBudget key={auth.state.userId} profile={auth.state.profile} />
  );
}
function PersonalBudget({ profile }: { profile: Profile }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => currentMonth(profile.timezone));
  const [buckets, setBuckets] = useState<BudgetBucket[] | null>(null);
  const active = useRef(false);
  const focusRevision = useRef(0);
  const preparing = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      focusRevision.current += 1;
      const nextMonth = currentMonth(profile.timezone);
      setMonth(nextMonth);
      void queryClient.invalidateQueries({
        queryKey: budgetKey(profile.id, nextMonth),
      });
      return () => {
        active.current = false;
        focusRevision.current += 1;
        setBuckets(null);
      };
    }, [queryClient, profile.id, profile.timezone]),
  );
  const key = budgetKey(profile.id, month);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readBudget(profile.id, month, signal),
  });
  const prepare = useMutation({
    mutationFn: prepareBudgetBuckets,
    retry: false,
  });
  if (query.isPending) return <LoadingState label="Cargando presupuesto…" />;
  if (query.isError)
    return (
      <ErrorState
        message={budgetErrorMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  const { period, allocations, buckets: savedBuckets } = query.data;
  const currency = period?.base_currency ?? profile.base_currency;
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  if (buckets)
    return (
      <SetupEditor
        key={month}
        month={month}
        currency={currency}
        buckets={buckets}
        expectedIncome={period?.expected_income_minor ?? null}
        onCancel={() => {
          setBuckets(null);
          refresh();
        }}
        onSave={async (form) => {
          if (!auth.isCurrentUser(profile.id)) return;
          const revision = focusRevision.current;
          await saveInitialBudget(month, currency, buckets, form);
          if (auth.isCurrentUser(profile.id)) {
            await refresh();
            if (
              active.current &&
              revision === focusRevision.current &&
              auth.isCurrentUser(profile.id)
            )
              setBuckets(null);
          }
        }}
      />
    );
  const allocationPlan =
    period && allocations.length > 0
      ? createBudgetAllocationPlan(
          period.id,
          currency,
          allocations.map((item) => ({
            budgetBucketId: item.budget_bucket_id,
            percentageBasisPoints: item.percentage_basis_points,
          })),
        )
      : null;
  const plan =
    allocationPlan && period
      ? calculatePlannedBudgetAllocation(
          allocationPlan,
          period.expected_income_minor,
        )
      : null;
  return (
    <Screen scroll>
      <AppText variant="title">Presupuesto</AppText>
      <AppText variant="section">
        {month.slice(0, 7)} · {currency}
      </AppText>
      {plan ? (
        <>
          <AppText tone="success">Presupuesto guardado</AppText>
          <AppText variant="section">Planificación esperada</AppText>
          {plan.map((item) => {
            const bucket = savedBuckets.find(
              (entry) => entry.id === item.budgetBucketId,
            );
            return (
              <AppText key={item.budgetBucketId}>
                {bucket?.system_key
                  ? bucketLabels[bucket.system_key]
                  : bucket?.name}
                : {decimalText(item.percentageBasisPoints, 2)}% ·{' '}
                {item.plannedAmount
                  ? formatMoney(item.plannedAmount)
                  : 'Sin estimación'}
              </AppText>
            );
          })}
          <AppText>
            Importes esperados, no dinero recibido ni disponible para gastar.
          </AppText>
        </>
      ) : (
        <AppText>
          Elige cómo distribuir tus ingresos esperados entre necesidades, ocio y
          ahorro.
        </AppText>
      )}
      {allocationPlan && (
        <ReceivedBudgetAvailability
          profileId={profile.id}
          plan={allocationPlan}
          buckets={savedBuckets}
          refreshingPlan={query.isFetching}
        />
      )}
      {period && (
        <BucketConsumption
          profileId={profile.id}
          periodId={period.id}
          currency={period.base_currency}
          refreshingPlan={query.isFetching}
        />
      )}
      {period?.status === 'CLOSED' ? (
        <AppText>Este período está cerrado.</AppText>
      ) : (
        !plan && (
          <Button
            loading={prepare.isPending}
            onPress={async () => {
              if (preparing.current || !auth.isCurrentUser(profile.id)) return;
              preparing.current = true;
              const revision = focusRevision.current;
              try {
                const result = await prepare.mutateAsync();
                if (
                  active.current &&
                  revision === focusRevision.current &&
                  auth.isCurrentUser(profile.id)
                )
                  setBuckets(result);
              } catch {
                /* Mutation state supplies the sanitized retry message. */
              } finally {
                preparing.current = false;
              }
            }}
          >
            Configurar presupuesto
          </Button>
        )
      )}
      {prepare.isError && (
        <AppText role="alert" tone="danger">
          {budgetErrorMessage(prepare.error)}
        </AppText>
      )}
      <Button
        variant="secondary"
        onPress={() => {
          void query.refetch();
          void queryClient.invalidateQueries({
            queryKey: consumptionOwnerKey(profile.id),
          });
          void queryClient.invalidateQueries({
            queryKey: incomeOwnerKey(profile.id),
          });
        }}
      >
        Actualizar
      </Button>
    </Screen>
  );
}

export function SetupEditor({
  month,
  currency,
  buckets,
  expectedIncome,
  onCancel,
  onSave,
}: {
  month: string;
  currency: string;
  buckets: BudgetBucket[];
  expectedIncome: number | null;
  onCancel: () => void;
  onSave: (form: SetupForm) => Promise<void>;
}) {
  const [strategy, setStrategy] = useState<Strategy>('BALANCED');
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SetupForm>({
    resolver: zodResolver(validateSetupForm(currency)),
    defaultValues: {
      expectedIncome:
        expectedIncome === null
          ? ''
          : decimalText(expectedIncome, currencyDigits(currency)),
      NEEDS: '50',
      LEISURE: '30',
      SAVINGS: '20',
    },
  });
  const form = useWatch({ control });
  const parsed = validateSetupForm(currency).safeParse(form);
  const preview = parsed.success
    ? setupPreview(currency, buckets, parsed.data)
    : null;
  return (
    <FormScreen>
      <AppText variant="title">Configurar presupuesto</AppText>
      <AppText>
        {month.slice(0, 7)} · {currency}
      </AppText>
      <AppText>
        Estas distribuciones son sugerencias, no una recomendación universal.
      </AppText>
      {([...Object.keys(strategies), 'CUSTOM'] as Strategy[]).map((option) => (
        <Button
          key={option}
          variant={strategy === option ? 'primary' : 'secondary'}
          accessibilityState={{ selected: strategy === option }}
          disabled={isSubmitting}
          onPress={() => {
            setStrategy(option);
            if (option !== 'CUSTOM')
              bucketKeys.forEach((key, index) =>
                setValue(key, strategies[option].shares[index], {
                  shouldValidate: true,
                }),
              );
          }}
        >
          {option === 'CUSTOM' ? 'Personalizado' : strategies[option].label}
        </Button>
      ))}
      <Controller
        control={control}
        name="expectedIncome"
        render={({ field }) => (
          <TextField
            label={`Ingreso esperado (${currency}, opcional)`}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            error={errors.expectedIncome?.message}
            keyboardType="decimal-pad"
            editable={!isSubmitting}
            placeholder="Sin estimación"
          />
        )}
      />
      <AppText variant="caption">
        Usa punto o coma decimal, sin separadores de miles. Vacío significa que
        aún no tienes una estimación.
      </AppText>
      {bucketKeys.map((key) => (
        <Controller
          key={key}
          control={control}
          name={key}
          render={({ field }) => (
            <TextField
              label={`${bucketLabels[key]} (%)`}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              error={errors[key]?.message}
              keyboardType="decimal-pad"
              editable={strategy === 'CUSTOM' && !isSubmitting}
            />
          )}
        />
      ))}
      <View style={{ gap: spacing.sm }}>
        <AppText variant="section">Vista previa</AppText>
        {preview ? (
          bucketKeys.map((key) => {
            const item = preview.allocations.find(
              (allocation) =>
                allocation.budgetBucketId ===
                buckets.find((bucket) => bucket.system_key === key)?.id,
            )!;
            return (
              <AppText key={key}>
                {bucketLabels[key]}:{' '}
                {decimalText(item.percentageBasisPoints, 2)}% ·{' '}
                {item.plannedAmount
                  ? formatMoney(item.plannedAmount)
                  : 'Sin estimación'}
              </AppText>
            );
          })
        ) : (
          <AppText>
            Completa importes válidos y porcentajes que sumen 100% para ver la
            distribución.
          </AppText>
        )}
        <AppText>
          Es una planificación: no registra ingresos recibidos ni dinero
          disponible. El ahorro no se usa automáticamente para gastos.
        </AppText>
      </View>
      {error && (
        <AppText role="alert" tone="danger">
          {error}
        </AppText>
      )}
      <Button
        loading={isSubmitting}
        disabled={!preview}
        onPress={() => {
          void handleSubmit(async (values) => {
            if (submitting.current) return;
            submitting.current = true;
            setError(null);
            try {
              await onSave(values);
            } catch (err) {
              setError(budgetErrorMessage(err));
            } finally {
              submitting.current = false;
            }
          })();
        }}
      >
        Guardar presupuesto
      </Button>
      <Button variant="secondary" disabled={isSubmitting} onPress={onCancel}>
        Cancelar
      </Button>
    </FormScreen>
  );
}
