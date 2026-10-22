import { HouseholdInvitations } from './HouseholdInvitations';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Screen, FormScreen } from '../../components/ui/Screen';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { useAuth } from '../auth/AuthProvider';
import { type Profile } from '../auth/auth-data';
import { CurrencySelect } from '../auth/CurrencySelect';
import { profileCurrencyOptions } from '../auth/profile-currencies';
import { colors, radius, spacing } from '../../theme/tokens';
import {
  createFirstHousehold,
  householdErrorMessage,
  householdFormSchema,
  householdKey,
  isRejectedHousehold,
  pendingHouseholdKey,
  readHouseholdMemberships,
  snapshotConfirmsRequest,
  type HouseholdForm,
  type HouseholdRequest,
  type PendingHousehold,
} from './household-data';

export function HouseholdScreen() {
  const { state } = useAuth();
  if (state.status !== 'AUTHENTICATED_READY') return null;
  return <HouseholdMemberships key={state.userId} profile={state.profile} />;
}
function HouseholdMemberships({ profile }: { profile: Profile }) {
  const auth = useAuth();
  const currentUser = useRef(auth.isCurrentUser);
  currentUser.current = auth.isCurrentUser;
  const client = useQueryClient();
  const active = useRef(false);
  const foreground = useRef(
    AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive',
  );
  const revision = useRef(0);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = householdKey(profile.id);
  const pendingKey = pendingHouseholdKey(profile.id);
  const pendingQuery = useQuery<PendingHousehold | null>({
    queryKey: pendingKey,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    gcTime: Infinity,
  });
  const pending = pendingQuery.data ?? null;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readHouseholdMemberships(profile.id, signal),
    // A settled shared request must refresh the current visible observer after remount.
    enabled: visible,
    retry: false,
  });
  const { refetch } = query;
  const refresh = useCallback(async () => {
    const attempt = ++revision.current;
    setReady(false);
    const result = await refetch();
    if (
      attempt !== revision.current ||
      !active.current ||
      !foreground.current ||
      !currentUser.current(profile.id)
    )
      return;
    if (result.isSuccess && result.data) setReady(true);
  }, [profile.id, refetch]);
  useEffect(() => {
    if (
      !visible ||
      !ready ||
      !query.isSuccess ||
      query.isFetching ||
      !active.current ||
      !foreground.current ||
      !currentUser.current(profile.id)
    )
      return;
    // The current consumer also reconciles automatic refetches after a request
    // outlives its original screen. Never settle from hidden, stale or failed reads.
    const request = client.getQueryData<PendingHousehold | null>(
      pendingHouseholdKey(profile.id),
    );
    if (request && snapshotConfirmsRequest(query.data, request)) {
      client.setQueryData(pendingHouseholdKey(profile.id), null);
      setNotice(
        'Hogar confirmado. Tus finanzas personales siguen siendo privadas.',
      );
    }
  }, [
    client,
    pending,
    profile.id,
    query.data,
    query.isFetching,
    query.isSuccess,
    ready,
    visible,
  ]);
  const suspend = useCallback(() => {
    revision.current++;
    setVisible(false);
    setReady(false);
    setEditorId(null);
    setNotice(null);
    void client.cancelQueries({ queryKey: householdKey(profile.id) });
  }, [client, profile.id]);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      if (foreground.current) {
        setVisible(true);
        void refresh();
      }
      return () => {
        active.current = false;
        suspend();
      };
    }, [refresh, suspend]),
  );
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (!foreground.current) suspend();
      else if (active.current) {
        setVisible(true);
        void refresh();
      }
    });
    return () => listener.remove();
  }, [refresh, suspend]);

  const submit = async (request: HouseholdRequest) => {
    const previous = client.getQueryData<PendingHousehold | null>(pendingKey);
    if (
      previous?.inFlight ||
      (previous && previous.id !== request.id) ||
      !active.current ||
      !foreground.current ||
      !currentUser.current(profile.id) ||
      (!previous && (!ready || query.data?.creation_status !== 'ELIGIBLE'))
    )
      return;
    client.setQueryData<PendingHousehold>(pendingKey, {
      ...request,
      inFlight: true,
    });
    const requestCache = client
      .getQueryCache()
      .find({ queryKey: pendingKey, exact: true });
    const isCurrentRequest = () =>
      currentUser.current(profile.id) &&
      client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
        requestCache &&
      client.getQueryData<PendingHousehold | null>(pendingKey)?.id ===
        request.id;
    setEditorId(null);
    setNotice(null);
    try {
      await createFirstHousehold(request);
      if (!isCurrentRequest()) return;
      client.setQueryData(pendingKey, null);
      if (active.current && foreground.current)
        setNotice(
          'Hogar creado. Tus finanzas personales siguen siendo privadas.',
        );
    } catch (error) {
      if (!isCurrentRequest()) return;
      client.setQueryData<PendingHousehold | null>(pendingKey, () =>
        isRejectedHousehold(error) ? null : { ...request, inFlight: false },
      );
      if (active.current && foreground.current)
        setNotice(householdErrorMessage(error));
    } finally {
      const current = client.getQueryData<PendingHousehold | null>(pendingKey);
      if (
        currentUser.current(profile.id) &&
        client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
          requestCache &&
        (current === null || current?.id === request.id)
      ) {
        await client.invalidateQueries({ queryKey: key });
        if (active.current && foreground.current) await refresh();
      }
    }
  };

  if (!visible)
    return (
      <Screen>
        <AppText variant="title">Hogar</AppText>
      </Screen>
    );
  if (editorId && ready && !pending)
    return (
      <HouseholdEditor
        key={editorId}
        requestId={editorId}
        initialCurrency={profile.base_currency}
        onCancel={() => setEditorId(null)}
        onSave={submit}
      />
    );
  return (
    <Screen scroll>
      <AppText variant="title">Hogar</AppText>
      <AppText>
        Solo se comparten el hogar y los nombres y roles de sus miembros
        activos. Tus ingresos, gastos, presupuesto y ahorro personales siguen
        privados.
      </AppText>
      {notice && <AppText role="status">{notice}</AppText>}
      {pending && (
        <>
          <AppText>
            {pending.inFlight
              ? 'Creación en curso. Cerrar esta pantalla no cancela la solicitud.'
              : 'Hay una creación sin confirmar. Comprueba el resultado antes de intentar otra; se conserva la misma solicitud.'}
          </AppText>
          <Button
            disabled={pending.inFlight || query.isFetching}
            onPress={() => {
              void submit(pending);
            }}
          >
            Comprobar creación pendiente
          </Button>
        </>
      )}
      {query.isFetching || query.isPending ? (
        <LoadingState label="Comprobando acceso al hogar…" />
      ) : query.isError || !ready ? (
        <ErrorState
          message="No pudimos comprobar tus membresías. No se muestran datos guardados sin confirmar el acceso."
          onRetry={() => {
            void refresh();
          }}
        />
      ) : (
        query.data && (
          <>
            {query.data.creation_status === 'ELIGIBLE' && (
              <>
                <AppText>Aún no tienes un hogar.</AppText>
                <AppText>
                  Puedes preparar tu primer hogar o aceptar una invitación
                  abajo.
                </AppText>
                <Button
                  disabled={!!pending}
                  onPress={() => setEditorId(randomUUID())}
                >
                  Crear hogar
                </Button>
              </>
            )}
            {query.data.creation_status === 'PREVIOUS_MEMBERSHIP' && (
              <AppText role="status">
                Tienes una membresía anterior, pero ninguna activa. Esta versión
                todavía no permite volver al mismo hogar ni crear otro después
                de una membresía anterior. Sí puedes aceptar una invitación a
                otro hogar. Tus finanzas personales siguen disponibles en las
                otras secciones.
              </AppText>
            )}
            {query.data.households.map((household) => (
              <View key={household.id} style={styles.card}>
                <AppText variant="section">{household.name}</AppText>
                <AppText>
                  Moneda del hogar: {household.default_currency}
                </AppText>
                <AppText variant="section">Miembros activos</AppText>
                {household.members.map((member) => (
                  <AppText key={member.id}>
                    {member.display_name}
                    {member.profile_id === profile.id ? ' (Tú)' : ''}:{' '}
                    {member.role === 'OWNER' ? 'Propietario' : 'Miembro'}
                  </AppText>
                ))}
              </View>
            ))}
            <HouseholdInvitations snapshot={query.data} />
          </>
        )
      )}
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onPress={() => {
          void refresh();
        }}
      >
        Actualizar hogar
      </Button>
    </Screen>
  );
}
function HouseholdEditor({
  requestId,
  initialCurrency,
  onCancel,
  onSave,
}: {
  requestId: string;
  initialCurrency: string;
  onCancel: () => void;
  onSave: (request: HouseholdRequest) => Promise<void>;
}) {
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<HouseholdForm>({
    resolver: zodResolver(householdFormSchema),
    defaultValues: {
      name: '',
      currency: profileCurrencyOptions.some(
        (option) => option.code === initialCurrency,
      )
        ? initialCurrency
        : '',
    },
  });
  return (
    <FormScreen>
      <AppText variant="title">Crear hogar</AppText>
      <AppText>
        El nombre, la moneda elegida y tu nombre visible formarán parte del
        hogar. No se compartirán tus finanzas personales ni se invitará a nadie.
      </AppText>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextField
            label="Nombre del hogar"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            error={errors.name?.message}
            editable={!isSubmitting}
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
            error={errors.currency?.message}
            disabled={isSubmitting}
          />
        )}
      />
      <Button
        loading={isSubmitting}
        onPress={handleSubmit((form) => onSave({ id: requestId, form }))}
      >
        Confirmar creación
      </Button>
      <Button variant="text" disabled={isSubmitting} onPress={onCancel}>
        Cancelar
      </Button>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius,
  },
});
