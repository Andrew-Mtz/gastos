import type { PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme/tokens';

type ScreenProps = PropsWithChildren<{
  edges?: Edge[];
  scroll?: boolean;
  centered?: boolean;
}>;

export function Screen({
  children,
  edges,
  scroll = false,
  centered = false,
}: ScreenProps) {
  const contentStyle = [styles.content, centered && styles.centered];
  return (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      {scroll ? (
        <ScrollView style={styles.flex} contentContainerStyle={contentStyle}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function FormScreen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.flex}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, styles.form]}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.xl, gap: spacing.lg },
  centered: { justifyContent: 'center' },
  form: { paddingBottom: spacing.xxl },
});
