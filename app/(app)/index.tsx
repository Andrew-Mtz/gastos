import { Button } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BootstrapScreen } from '../../src/components/BootstrapScreen';
import { useAuth } from '../../src/features/auth/AuthProvider';

export default function IndexRoute() {
  const { signOut } = useAuth();
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
      <BootstrapScreen />
      <Button
        title="Cerrar sesión"
        onPress={() => {
          void signOut();
        }}
      />
    </SafeAreaView>
  );
}
