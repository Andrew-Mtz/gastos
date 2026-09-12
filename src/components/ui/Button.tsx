import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type PressableProps,
  type View,
} from 'react-native';
import {
  colors,
  controlMinHeight,
  radius,
  spacing,
  typography,
} from '../../theme/tokens';
import { AppText } from './AppText';

type ButtonProps = Omit<PressableProps, 'children'> & {
  children: string;
  variant?: 'primary' | 'secondary' | 'text';
  loading?: boolean;
};

export const Button = forwardRef<View, ButtonProps>(function Button(
  {
    children,
    variant = 'primary',
    loading = false,
    disabled,
    style,
    accessibilityState,
    ...props
  },
  ref,
) {
  const blocked =
    loading ||
    !!disabled ||
    !!props['aria-disabled'] ||
    !!accessibilityState?.disabled;
  const foreground = blocked
    ? colors.disabledText
    : variant === 'primary'
      ? colors.onAction
      : colors.action;
  return (
    <Pressable
      ref={ref}
      role={props.accessibilityRole ? undefined : 'button'}
      accessibilityLabel={children}
      {...props}
      disabled={blocked}
      aria-disabled={blocked}
      accessibilityState={{
        ...accessibilityState,
        disabled: blocked,
        busy: loading || accessibilityState?.busy,
      }}
      aria-busy={loading || props['aria-busy'] || accessibilityState?.busy}
      style={(state) => [
        styles.base,
        variant === 'primary'
          ? styles.primary
          : variant === 'secondary'
            ? styles.secondary
            : undefined,
        state.pressed &&
          (variant === 'primary' ? styles.primaryPressed : styles.pressed),
        blocked && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading && <ActivityIndicator color={foreground} accessible={false} />}
      <AppText style={[typography.button, styles.label, { color: foreground }]}>
        {children}
      </AppText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    minHeight: controlMinHeight,
    minWidth: controlMinHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primary: { backgroundColor: colors.action },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.action,
  },
  primaryPressed: { backgroundColor: colors.actionPressed },
  pressed: { backgroundColor: colors.disabledBackground },
  disabled: {
    backgroundColor: colors.disabledBackground,
    borderColor: colors.disabledBackground,
  },
  label: { flexShrink: 1, textAlign: 'center' },
});
