import { useRef } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormScreen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { CurrencySelect } from '../auth/CurrencySelect';
import { type ExpenseCategory } from '../expense/expense-data';
import { type BudgetPeriod } from '../budget/budget-setup';
import {
  isRejectedIncome,
  validateIncomeForm,
  type IncomeForm,
  type IncomeRequest,
} from '../income/income-form';
import {
  recurringErrorMessage,
  recurringMonthSchema,
  templateFormSchema,
  type TemplateForm,
  type TemplateRequest,
} from './recurring-form';

export function TemplateEditor({
  id,
  month,
  currency,
  categories,
  pending,
  onSave,
  onCancel,
}: {
  id: string;
  month: string;
  currency: string;
  categories: ExpenseCategory[];
  pending: TemplateRequest | null;
  onSave: (request: TemplateRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const requestRef = useRef<TemplateRequest | null>(pending),
    submitting = useRef(false);
  const mutation = useMutation({ mutationFn: onSave, retry: false });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<TemplateForm>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: pending?.form ?? {
      name: '',
      categoryId: '',
      amountMode: 'VARIABLE',
      amount: '',
      currency,
      dueDay: '1',
      activeFrom: month,
      activeUntil: '',
    },
  });
  const mode = useWatch({ control, name: 'amountMode' });
  const locked = mutation.isPending || pending !== null;
  const fields = [
    ['name', 'Nombre'],
    [
      'amount',
      mode === 'FIXED'
        ? 'Importe fijo'
        : 'Estimación opcional (vacío = desconocida)',
    ],
    ['dueDay', 'Día de vencimiento (1–31)'],
    ['activeFrom', 'Primer mes (AAAA-MM-01)'],
    ['activeUntil', 'Último mes inclusive (opcional)'],
  ] as const;
  return (
    <FormScreen>
      <AppText variant="title">Crear gasto recurrente</AppText>
      <AppText>
        Es una obligación mensual, no un gasto realizado. El importe variable se
        confirma por separado; los fijos no se generan automáticamente.
      </AppText>
      <Controller
        control={control}
        name="amountMode"
        render={({ field }) => (
          <>
            {(['VARIABLE', 'FIXED'] as const).map((value) => (
              <Button
                key={value}
                disabled={locked}
                variant={field.value === value ? 'primary' : 'secondary'}
                accessibilityState={{ selected: field.value === value }}
                onPress={() => field.onChange(value)}
              >
                {value === 'VARIABLE' ? 'Variable' : 'Fijo'}
              </Button>
            ))}
          </>
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
      {fields.map(([name, label]) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <TextField
              label={label}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              editable={!locked}
              error={errors[name]?.message}
            />
          )}
        />
      ))}
      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => (
          <>
            <AppText variant="section">Categoría</AppText>
            {categories.map((c) => (
              <Button
                key={c.id}
                disabled={locked}
                variant={field.value === c.id ? 'primary' : 'secondary'}
                accessibilityState={{ selected: field.value === c.id }}
                onPress={() => field.onChange(c.id)}
              >
                {c.name}
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
      {pending && (
        <AppText>
          Resultado pendiente. Se comprobará el mismo intento sin modificarlo.
        </AppText>
      )}
      {mutation.isError && (
        <AppText role="alert" tone="danger">
          {recurringErrorMessage(mutation.error)}
        </AppText>
      )}
      <Button
        loading={mutation.isPending}
        onPress={() => {
          void handleSubmit(async (form) => {
            if (submitting.current) return;
            submitting.current = true;
            const request = pending ?? requestRef.current ?? { id, form };
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
        {pending ? 'Comprobar misma plantilla' : 'Guardar plantilla'}
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
export function ResolveEditor({
  id,
  name,
  period,
  date,
  pending,
  onSave,
  onCancel,
}: {
  id: string;
  name: string;
  period: BudgetPeriod;
  date: string;
  pending: IncomeRequest | null;
  onSave: (request: IncomeRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const requestRef = useRef<IncomeRequest | null>(pending),
    submitting = useRef(false);
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
      <AppText variant="title">Confirmar {name}</AppText>
      <AppText>
        Registrarás un único gasto real de {period.starts_on.slice(0, 7)} en{' '}
        {period.base_currency}. La estimación no se usa como importe real ni se
        retira ahorro.
      </AppText>
      {(
        [
          ['amount', `Importe real (${period.base_currency})`],
          ['date', 'Fecha real (AAAA-MM-DD)'],
          ['description', 'Descripción (opcional)'],
        ] as const
      ).map(([name, label]) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <TextField
              label={label}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              editable={!locked}
              error={errors[name]?.message}
              keyboardType={name === 'amount' ? 'decimal-pad' : 'default'}
            />
          )}
        />
      ))}
      {pending && (
        <AppText>
          Resultado pendiente. Comprobar mantiene el mismo mes, importe e
          identidad.
        </AppText>
      )}
      {mutation.isError && (
        <AppText role="alert" tone="danger">
          {recurringErrorMessage(mutation.error)}
        </AppText>
      )}
      <Button
        loading={mutation.isPending}
        onPress={() => {
          void handleSubmit(async (form) => {
            if (submitting.current) return;
            submitting.current = true;
            const request = pending ?? requestRef.current ?? { id, form };
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
        {pending ? 'Comprobar mismo gasto' : 'Confirmar importe real'}
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
const stopSchema = z.object({ month: recurringMonthSchema });
export function StopEditor({
  name,
  month,
  pending,
  onSave,
  onCancel,
}: {
  name: string;
  month: string;
  pending: boolean;
  onSave: (month: string) => Promise<void>;
  onCancel: () => void;
}) {
  const submitting = useRef(false),
    requestRef = useRef<string | null>(pending ? month : null);
  const mutation = useMutation({ mutationFn: onSave, retry: false });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<{ month: string }>({
    resolver: zodResolver(stopSchema),
    defaultValues: { month },
  });
  return (
    <FormScreen>
      <AppText variant="title">Detener {name}</AppText>
      <AppText>
        No habrá nuevas obligaciones desde el mes indicado. Los gastos ya
        confirmados o cancelados se conservan. No se puede reactivar ni extender
        esta plantilla.
      </AppText>
      <Controller
        control={control}
        name="month"
        render={({ field }) => (
          <TextField
            label="Detener desde (AAAA-MM-01)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            editable={!mutation.isPending && !pending}
            error={errors.month?.message}
          />
        )}
      />
      {mutation.isError && (
        <AppText role="alert" tone="danger">
          {recurringErrorMessage(mutation.error)}
        </AppText>
      )}
      <Button
        loading={mutation.isPending}
        onPress={() => {
          void handleSubmit(async (form) => {
            if (submitting.current) return;
            submitting.current = true;
            const value = requestRef.current ?? form.month;
            requestRef.current = value;
            try {
              await mutation.mutateAsync(value);
            } catch (error) {
              if (isRejectedIncome(error)) requestRef.current = null;
            } finally {
              submitting.current = false;
            }
          })();
        }}
      >
        {pending ? 'Comprobar misma detención' : 'Confirmar detención'}
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
