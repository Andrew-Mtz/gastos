import { Stack } from 'expo-router';
import { ActivityIndicator, Button, Text, View } from 'react-native';
import { useAuth } from './AuthProvider';

export function AuthNavigator() {
  const { state, retry, signOut } = useAuth();
  if (
    state.status === 'INITIALIZING' ||
    state.status === 'AUTHENTICATED_PROFILE_LOADING' ||
    (state.status === 'SIGNING_OUT' && !state.message)
  )
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Cargando sesión" />
      </View>
    );
  if (
    state.status === 'INITIALIZATION_ERROR' ||
    state.status === 'AUTHENTICATED_PROFILE_ERROR' ||
    state.status === 'SIGNING_OUT'
  )
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        <Text role="alert">
          {'message' in state
            ? state.message
            : 'No se pudo cargar tu perfil. Intenta nuevamente.'}
        </Text>
        <Button
          title="Reintentar"
          onPress={
            state.status === 'SIGNING_OUT'
              ? () => {
                  void signOut();
                }
              : retry
          }
        />
        {state.status !== 'SIGNING_OUT' && (
          <Button
            title="Cerrar sesión"
            onPress={() => {
              void signOut();
            }}
          />
        )}
      </View>
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
