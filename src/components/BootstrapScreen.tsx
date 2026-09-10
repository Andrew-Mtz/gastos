import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function BootstrapScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Gastos
      </Text>
      <Text style={styles.message}>La aplicación está lista para comenzar.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: '#17212b',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: '#384858',
    textAlign: 'center',
  },
});
