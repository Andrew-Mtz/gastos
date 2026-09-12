import { Stack } from 'expo-router';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingState } from '../../components/ui/StatusState';
import { useAuth } from './AuthProvider';

export function AuthNavigator() {
  const { state, retry, signOut } = useAuth();
  if (
    state.status === 'INITIALIZING' ||
    state.status === 'AUTHENTICATED_PROFILE_LOADING' ||
    (state.status === 'SIGNING_OUT' && !state.message)
  )
    return <LoadingState label="Cargando sesión" />;
  if (
    state.status === 'INITIALIZATION_ERROR' ||
    state.status === 'AUTHENTICATED_PROFILE_ERROR' ||
    state.status === 'SIGNING_OUT'
  )
    return (
      <ErrorState
        message={
          'message' in state && state.message
            ? state.message
            : 'No se pudo cargar tu perfil. Intenta nuevamente.'
        }
        onRetry={
          state.status === 'SIGNING_OUT'
            ? () => {
                void signOut();
              }
            : retry
        }
        secondaryAction={
          state.status !== 'SIGNING_OUT' && (
            <Button
              variant="secondary"
              onPress={() => {
                void signOut();
              }}
            >
              Cerrar sesión
            </Button>
          )
        }
      />
    );
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={state.status === 'UNAUTHENTICATED'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'AUTHENTICATED_PROFILE_MISSING'}>
        <Stack.Screen name="profile-setup" />
      </Stack.Protected>
      <Stack.Protected guard={state.status === 'AUTHENTICATED_READY'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
