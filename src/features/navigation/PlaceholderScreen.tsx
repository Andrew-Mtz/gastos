import type { PropsWithChildren } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function PlaceholderScreen({
  title,
  message,
  children,
}: PropsWithChildren<{ title: string; message: string }>) {
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <Text role="heading" style={styles.heading}>
        {title}
      </Text>
      <Text>{message}</Text>
      {children}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  heading: { fontSize: 28, fontWeight: '600' },
});
