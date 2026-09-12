import { Button } from 'react-native';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { PlaceholderScreen } from '../../src/features/navigation/PlaceholderScreen';
export default function SettingsRoute() {
  const { signOut } = useAuth();
  return (
    <PlaceholderScreen
      title="Ajustes"
      message="Más opciones de configuración se añadirán más adelante."
    >
      <Button
        title="Cerrar sesión"
        onPress={() => {
          void signOut();
        }}
      />
    </PlaceholderScreen>
  );
}
