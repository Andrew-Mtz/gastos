import { useRef, useState } from 'react';
import { z } from 'zod';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { type BudgetBucket } from '../budget/budget-setup';
import { createExpenseCategory } from './expense-data';

const schema = z.object({
  name: z.string().trim().min(1, 'Ingresa un nombre.').max(120),
  bucketId: z.uuid('Selecciona un fondo disponible.'),
});
export function CategoryCreator({
  profileId,
  buckets,
  isCurrent,
  onCreated,
}: {
  profileId: string;
  buckets: BudgetBucket[];
  isCurrent: () => boolean;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', bucketId: '' },
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (form: z.infer<typeof schema>) => {
      if (!isCurrent()) throw new Error('Inactive identity');
      await createExpenseCategory(profileId, form.bucketId, form.name);
      if (isCurrent()) {
        reset();
        setOpen(false);
      }
      await onCreated();
    },
  });
  if (!open)
    return (
      <Button variant="secondary" onPress={() => setOpen(true)}>
        Crear categoría
      </Button>
    );
  return (
    <>
      <AppText variant="section">Nueva categoría personal</AppText>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextField
            label="Nombre de categoría"
            value={field.value}
            onChangeText={field.onChange}
            editable={!mutation.isPending}
            error={errors.name?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="bucketId"
        render={({ field }) => (
          <>
            {buckets
              .filter(
                (b) =>
                  b.profile_id === profileId &&
                  b.type === 'SPENDABLE' &&
                  b.archived_at === null,
              )
              .map((b) => (
                <Button
                  key={b.id}
                  variant={b.id === field.value ? 'primary' : 'secondary'}
                  disabled={mutation.isPending}
                  accessibilityState={{ selected: b.id === field.value }}
                  onPress={() => field.onChange(b.id)}
                >
                  {b.name}
                </Button>
              ))}
            {errors.bucketId && (
              <AppText role="alert" tone="danger">
                {errors.bucketId.message}
              </AppText>
            )}
          </>
        )}
      />
      {mutation.isError && (
        <AppText role="alert" tone="danger">
          No se confirmó la categoría. Actualiza los gastos antes de volver a
          crearla, por si ya se guardó.
        </AppText>
      )}
      <Button
        loading={mutation.isPending}
        onPress={() => {
          void handleSubmit(async (form) => {
            if (submitting.current) return;
            submitting.current = true;
            try {
              await mutation.mutateAsync(form);
            } catch {
              await onCreated();
            } finally {
              submitting.current = false;
            }
          })();
        }}
      >
        Guardar categoría
      </Button>
      <Button
        variant="secondary"
        disabled={mutation.isPending}
        onPress={() => {
          setOpen(false);
          reset();
          mutation.reset();
        }}
      >
        Cancelar categoría
      </Button>
    </>
  );
}
