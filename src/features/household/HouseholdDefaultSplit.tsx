import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { useAuth } from '../auth/AuthProvider';
import { decimalText } from '../budget/budget-setup';
import {
  initialSplitForm,
  isRejectedSplit,
  pendingSplitKey,
  readDefaultSplit,
  sameSplitRequest,
  saveDefaultSplit,
  splitErrorMessage,
  splitFormSchema,
  splitKey,
  splitRequestFromForm,
  type PendingSplit,
  type SplitForm,
  type SplitRequest,
  type SplitSnapshot,
} from './split-data';

// Parent mounts only after focus/foreground access revalidation. Submitted
// requests survive remount in its auth-cleared QueryClient; unsent forms do not.
export function HouseholdDefaultSplit({
  profileId,
  householdId,
}: {
  profileId: string;
  householdId: string;
}) {
  const auth = useAuth();
  const currentUser = useRef(auth.isCurrentUser);
  useLayoutEffect(() => {
    currentUser.current = auth.isCurrentUser;
  }, [auth.isCurrentUser]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const client = useQueryClient();
  const key = splitKey(profileId, householdId);
  const pendingKey = pendingSplitKey(profileId, householdId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readDefaultSplit(profileId, householdId, signal),
    retry: false,
    refetchOnMount: 'always',
  });
  const pendingQuery = useQuery<PendingSplit | null>({
    queryKey: pendingKey,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    gcTime: Infinity,
  });
  const pending = pendingQuery.data ?? null;
  const [editor, setEditor] = useState<{
    id: string;
    snapshot: SplitSnapshot;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ready = query.isSuccess && !query.isFetching;
  const owner =
    ready &&
    query.data.roster.some(
      (member) => member.profile_id === profileId && member.role === 'OWNER',
    );
  // Any new authorization/version snapshot dismisses an unsent draft. It must
  // never silently adopt newer roster/version while preserving stale inputs.
  const activeEditor = editor?.snapshot === query.data ? editor : null;

  const submit = async (request: SplitRequest) => {
    const previous = client.getQueryData<PendingSplit | null>(pendingKey);
    if (
      !mounted.current ||
      !currentUser.current(profileId) ||
      previous?.inFlight ||
      (previous && !sameSplitRequest(previous, request)) ||
      (!previous && (!ready || !owner))
    )
      return;
    client.setQueryData<PendingSplit>(pendingKey, {
      ...request,
      inFlight: true,
    });
    const cache = client
      .getQueryCache()
      .find({ queryKey: pendingKey, exact: true });
    const isCurrent = () => {
      const current = client.getQueryData<PendingSplit | null>(pendingKey);
      return (
        currentUser.current(profileId) &&
        client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
          cache &&
        !!current &&
        sameSplitRequest(current, request)
      );
    };
    setEditor(null);
    setNotice(null);
    try {
      await saveDefaultSplit(request);
      if (!isCurrent()) return;
      client.setQueryData(pendingKey, null);
      if (mounted.current)
        setNotice(
          `Guardado confirmado (versión ${request.expectedVersion + 1}). Abajo se muestra el reparto actual; un reintento nunca restaura versiones anteriores.`,
        );
    } catch (error) {
      if (!isCurrent()) return;
      client.setQueryData(
        pendingKey,
        isRejectedSplit(error) ? null : { ...request, inFlight: false },
      );
      if (mounted.current) setNotice(splitErrorMessage(error));
    } finally {
      const current = client.getQueryData<PendingSplit | null>(pendingKey);
      if (
        currentUser.current(profileId) &&
        client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
          cache &&
        (current === null || (!!current && sameSplitRequest(current, request)))
      )
        await client.invalidateQueries({ queryKey: key });
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="section">Reparto predeterminado</AppText>
      <AppText>
        Solo el propietario puede cambiar los porcentajes. Es una plantilla para
        futuros gastos: no mueve dinero ni modifica gastos anteriores.
      </AppText>
      {notice && <AppText role="status">{notice}</AppText>}
      {pending && (
        <>
          <AppText>
            {pending.inFlight
              ? 'Guardado en curso. Cerrar esta pantalla no cancela la solicitud.'
              : 'Hay un guardado sin confirmar. Se conserva la solicitud original para comprobarlo sin duplicar cambios.'}
          </AppText>
          <Button
            disabled={pending.inFlight || query.isFetching}
            onPress={() => {
              const { inFlight, ...request } = pending;
              if (!inFlight) void submit(request);
            }}
          >
            Comprobar reparto pendiente
          </Button>
        </>
      )}
      {query.isFetching || query.isPending ? (
        <LoadingState label="Comprobando reparto…" />
      ) : query.isError ? (
        <ErrorState
          message="No pudimos comprobar el reparto. No se muestran porcentajes guardados sin validar el acceso."
          onRetry={() => {
            setEditor(null);
            void query.refetch();
          }}
        />
      ) : (
        ready && (
          <>
            {query.data.status === 'UNCONFIGURED' && (
              <AppText>
                Aún no hay un reparto configurado. No se aplica ningún
                porcentaje automáticamente.
              </AppText>
            )}
            {query.data.status === 'STALE' && (
              <AppText role="status">
                Cambió la composición del hogar. El reparto anterior no está
                vigente: el propietario debe revisar y confirmar un porcentaje
                para cada miembro activo.
              </AppText>
            )}
            {query.data.template && (
              <>
                <AppText>Versión {query.data.version}</AppText>
                {query.data.roster.map((member) => (
                  <AppText key={member.id}>
                    {member.display_name}:{' '}
                    {decimalText(
                      query.data.template!.shares.find(
                        (share) => share.member_id === member.id,
                      )!.basis_points,
                      2,
                    )}
                    %
                  </AppText>
                ))}
              </>
            )}
            {!owner && (
              <AppText>
                Solo consulta. Pide al propietario que configure o revise el
                reparto.
              </AppText>
            )}
            {owner && !activeEditor && (
              <Button
                disabled={!!pending}
                onPress={() => {
                  setNotice(null);
                  setEditor({ id: randomUUID(), snapshot: query.data });
                }}
              >
                Editar reparto
              </Button>
            )}
            {activeEditor && owner && !pending && (
              <SplitEditor
                key={activeEditor.id}
                id={activeEditor.id}
                snapshot={activeEditor.snapshot}
                onSave={submit}
                onCancel={() => setEditor(null)}
              />
            )}
          </>
        )
      )}
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onPress={() => {
          setEditor(null);
          setNotice(null);
          void query.refetch();
        }}
      >
        Actualizar reparto
      </Button>
    </View>
  );
}

function SplitEditor({
  id,
  snapshot,
  onSave,
  onCancel,
}: {
  id: string;
  snapshot: SplitSnapshot;
  onSave: (request: SplitRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SplitForm>({
    resolver: zodResolver(splitFormSchema),
    defaultValues: initialSplitForm(snapshot),
  });
  const [confirmation, setConfirmation] = useState<SplitRequest | null>(null);
  if (confirmation)
    return (
      <>
        <AppText variant="section">Confirmar reparto</AppText>
        {snapshot.roster.map((member) => (
          <AppText key={member.id}>
            {member.display_name}:{' '}
            {decimalText(
              confirmation.shares.find(
                (share) => share.member_id === member.id,
              )!.basis_points,
              2,
            )}
            %
          </AppText>
        ))}
        <AppText>
          Estos porcentajes deben sumar 100%. Solo servirán como plantilla
          futura y no cambiarán gastos anteriores.
        </AppText>
        <Button
          onPress={() => {
            void onSave(confirmation);
          }}
        >
          Confirmar y guardar reparto
        </Button>
        <Button variant="text" onPress={() => setConfirmation(null)}>
          Volver a porcentajes
        </Button>
        <Button variant="text" onPress={onCancel}>
          Cancelar reparto
        </Button>
      </>
    );
  return (
    <>
      {snapshot.roster.map((member, index) => (
        <Controller
          key={member.id}
          control={control}
          name={`percentages.${index}`}
          render={({ field }) => (
            <TextField
              label={`Porcentaje de ${member.display_name}`}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
              keyboardType="decimal-pad"
              editable={!isSubmitting}
              error={errors.percentages?.[index]?.message}
            />
          )}
        />
      ))}
      <AppText>
        Ingresa un porcentaje explícito para cada miembro, incluido 0 si
        corresponde.
      </AppText>
      <Button
        loading={isSubmitting}
        onPress={handleSubmit((form) =>
          setConfirmation(splitRequestFromForm(snapshot, id, form)),
        )}
      >
        Revisar reparto
      </Button>
      <Button variant="text" disabled={isSubmitting} onPress={onCancel}>
        Cancelar reparto
      </Button>
    </>
  );
}
