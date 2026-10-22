import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { useAuth } from '../auth/AuthProvider';
import {
  householdKey,
  isRejectedHousehold,
  type HouseholdSnapshot,
} from './household-data';
import {
  invitationContextConfirms,
  invitationErrorMessage,
  invitationsKey,
  pendingInvitationKey,
  readInvitations,
  recipientCodeSchema,
  submitInvitation,
  sameInvitationRequest,
  type InvitationRequest,
  type PendingInvitation,
} from './invitation-data';

const statusLabels = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptada',
  REVOKED: 'Cancelada',
  EXPIRED: 'Vencida',
  UNAVAILABLE: 'No disponible',
};

// Mounted only inside the parent's freshly authorized, focused/foreground view.
// Remounts keep submitted requests in the auth-cleared QueryClient, not editors.
export function HouseholdInvitations({
  snapshot,
}: {
  snapshot: HouseholdSnapshot;
}) {
  const profileId = snapshot.profile_id;
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
  const key = invitationsKey(profileId);
  const pendingKey = pendingInvitationKey(profileId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => readInvitations(profileId, signal),
    retry: false,
  });
  const pendingQuery = useQuery<PendingInvitation | null>({
    queryKey: pendingKey,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    gcTime: Infinity,
  });
  const pending = pendingQuery.data ?? null;
  const [editor, setEditor] = useState<{
    id: string;
    householdId: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<InvitationRequest | null>(
    null,
  );
  const ready = query.isSuccess && !query.isFetching;
  useEffect(() => {
    if (!ready || !mounted.current || !currentUser.current(profileId)) return;
    const request = client.getQueryData<PendingInvitation | null>(
      pendingInvitationKey(profileId),
    );
    if (request && invitationContextConfirms(query.data, request)) {
      client.setQueryData(pendingInvitationKey(profileId), null);
      if (request.action === 'ACCEPT')
        void client.invalidateQueries({ queryKey: householdKey(profileId) });
    }
  }, [client, pending, profileId, query.data, ready]);

  const submit = async (request: InvitationRequest) => {
    const previous = client.getQueryData<PendingInvitation | null>(pendingKey);
    if (
      !mounted.current ||
      !currentUser.current(profileId) ||
      previous?.inFlight ||
      (previous && !sameInvitationRequest(previous, request)) ||
      (!previous && !ready)
    )
      return;
    client.setQueryData<PendingInvitation>(pendingKey, {
      ...request,
      inFlight: true,
    });
    const cache = client
      .getQueryCache()
      .find({ queryKey: pendingKey, exact: true });
    const isCurrent = () => {
      const current = client.getQueryData<PendingInvitation | null>(pendingKey);
      return (
        currentUser.current(profileId) &&
        client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
          cache &&
        !!current &&
        sameInvitationRequest(current, request)
      );
    };
    setEditor(null);
    setConfirmation(null);
    setCode('');
    setError(null);
    setNotice(null);
    try {
      await submitInvitation(request);
      if (!isCurrent()) return;
      client.setQueryData(pendingKey, null);
      if (mounted.current)
        setNotice(
          'Operación confirmada. Tus finanzas personales siguen privadas.',
        );
    } catch (failure) {
      if (!isCurrent()) return;
      client.setQueryData(
        pendingKey,
        isRejectedHousehold(failure) ? null : { ...request, inFlight: false },
      );
      if (mounted.current) setNotice(invitationErrorMessage(failure));
    } finally {
      const current = client.getQueryData<PendingInvitation | null>(pendingKey);
      if (
        (current === null ||
          (!!current && sameInvitationRequest(current, request))) &&
        currentUser.current(profileId) &&
        client.getQueryCache().find({ queryKey: pendingKey, exact: true }) ===
          cache
      ) {
        await client.invalidateQueries({ queryKey: key });
        if (request.action === 'ACCEPT')
          await client.invalidateQueries({ queryKey: householdKey(profileId) });
      }
    }
  };
  const busy = !!pending;
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="section">Invitaciones</AppText>
      {notice && <AppText role="status">{notice}</AppText>}
      {pending && (
        <>
          <AppText>
            {pending.inFlight
              ? 'Solicitud en curso. Cerrar esta pantalla no la cancela.'
              : 'Hay una solicitud sin confirmar. Se conserva su identidad para evitar duplicados.'}
          </AppText>
          <Button
            disabled={pending.inFlight || query.isFetching}
            onPress={() => {
              const { inFlight, ...request } = pending;
              if (!inFlight) void submit(request);
            }}
          >
            Comprobar invitación pendiente
          </Button>
        </>
      )}
      {query.isFetching || query.isPending ? (
        <LoadingState label="Comprobando invitaciones…" />
      ) : query.isError ? (
        <ErrorState
          message="No pudimos comprobar las invitaciones. No se muestran datos guardados sin validar."
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        ready && (
          <>
            <AppText>Tu código de destinatario</AppText>
            <AppText selectable>{query.data.recipient_code}</AppText>
            <AppText>
              Selecciona y copia este código para compartirlo con quien te
              invita. Solo identifica tu cuenta: nadie puede entrar por tenerlo.
              Tú debes aceptar aquí.
            </AppText>
            {snapshot.households
              .filter((household) =>
                household.members.some(
                  (member) =>
                    member.profile_id === profileId && member.role === 'OWNER',
                ),
              )
              .map((household) => (
                <Button
                  key={household.id}
                  disabled={busy || !!editor || !!confirmation}
                  onPress={() => {
                    setEditor({ id: randomUUID(), householdId: household.id });
                    setCode('');
                    setError(null);
                  }}
                >
                  {`Invitar a ${household.name}`}
                </Button>
              ))}
            {editor && (
              <>
                <TextField
                  label="Código de la persona invitada"
                  value={code}
                  onChangeText={setCode}
                  autoCapitalize="none"
                  autoCorrect={false}
                  error={error ?? undefined}
                />
                <AppText>
                  La otra persona verá el nombre de este hogar. Debe aceptar en
                  su cuenta dentro de 7 días para entrar como miembro. No se
                  compartirán finanzas personales.
                </AppText>
                <Button
                  onPress={() => {
                    const parsed = recipientCodeSchema.safeParse(code);
                    if (!parsed.success) {
                      setError(parsed.error.issues[0].message);
                      return;
                    }
                    void submit({
                      action: 'CREATE',
                      id: editor.id,
                      householdId: editor.householdId,
                      recipientCode: parsed.data,
                    });
                  }}
                >
                  Enviar invitación
                </Button>
                <Button
                  variant="text"
                  onPress={() => {
                    setEditor(null);
                    setCode('');
                    setError(null);
                  }}
                >
                  Cerrar invitación sin enviar
                </Button>
              </>
            )}
            <AppText variant="section">
              Recibidas en los últimos 14 días
            </AppText>
            {query.data.incoming.length === 0 && (
              <AppText>No hay invitaciones recibidas.</AppText>
            )}
            {query.data.incoming.map((invitation) => (
              <View key={invitation.id} style={{ gap: 8 }}>
                <AppText>
                  {invitation.household_name}: {statusLabels[invitation.status]}
                </AppText>
                <AppText>
                  Vence: {new Date(invitation.expires_at).toLocaleString()}
                </AppText>
                {invitation.status === 'PENDING' && (
                  <Button
                    disabled={busy || !!editor || !!confirmation}
                    onPress={() =>
                      setConfirmation({ action: 'ACCEPT', id: invitation.id })
                    }
                  >
                    {`Aceptar ${invitation.household_name}`}
                  </Button>
                )}
              </View>
            ))}
            <AppText variant="section">Enviadas en los últimos 14 días</AppText>
            {query.data.outgoing.length === 0 && (
              <AppText>No hay invitaciones enviadas.</AppText>
            )}
            {query.data.outgoing.map((invitation) => (
              <View key={invitation.id} style={{ gap: 8 }}>
                <AppText>
                  {invitation.household_name}: {statusLabels[invitation.status]}
                </AppText>
                <AppText>
                  Código destinatario: {invitation.recipient_code}
                </AppText>
                <AppText>
                  Vence: {new Date(invitation.expires_at).toLocaleString()}
                </AppText>
                {invitation.status === 'PENDING' && (
                  <Button
                    disabled={busy || !!editor || !!confirmation}
                    onPress={() =>
                      setConfirmation({ action: 'REVOKE', id: invitation.id })
                    }
                  >
                    {`Cancelar invitación ${invitation.id.slice(-8)}`}
                  </Button>
                )}
              </View>
            ))}
            {confirmation && (
              <>
                <AppText>
                  {confirmation.action === 'ACCEPT'
                    ? 'Al unirte compartirás tu nombre visible y rol con los miembros activos. Tus otros hogares y finanzas personales seguirán separados. No se reactivan membresías anteriores.'
                    : 'La persona ya no podrá aceptar esta invitación. Cancelarla no elimina miembros que ya hayan ingresado.'}
                </AppText>
                <Button
                  onPress={() => {
                    void submit(confirmation);
                  }}
                >
                  {confirmation.action === 'ACCEPT'
                    ? 'Confirmar ingreso al hogar'
                    : 'Confirmar cancelación de invitación'}
                </Button>
                <Button variant="text" onPress={() => setConfirmation(null)}>
                  Volver sin cambios
                </Button>
              </>
            )}
            <AppText>
              Salir, quitar miembros, cambiar roles y transferir la propiedad
              aún no están disponibles.
            </AppText>
          </>
        )
      )}
      <Button
        variant="secondary"
        disabled={query.isFetching}
        onPress={() => {
          setEditor(null);
          setConfirmation(null);
          setCode('');
          void query.refetch();
        }}
      >
        Actualizar invitaciones
      </Button>
    </View>
  );
}
