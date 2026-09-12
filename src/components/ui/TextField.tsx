import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import {
  colors,
  controlMinHeight,
  radius,
  spacing,
  typography,
} from '../../theme/tokens';
import { AppText } from './AppText';

type TextFieldProps = TextInputProps & { label: string; error?: string };

export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextField(
    {
      label,
      error,
      style,
      editable,
      readOnly,
      onFocus,
      onBlur,
      accessibilityHint,
      accessibilityState,
      ...props
    },
    ref,
  ) {
    const [focused, setFocused] = useState(false);
    const disabled = editable === false || readOnly === true;
    return (
      <View style={styles.field}>
        <AppText>{label}</AppText>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.action}
          {...props}
          editable={editable}
          readOnly={readOnly}
          accessibilityHint={
            [accessibilityHint, error].filter(Boolean).join('. ') || undefined
          }
          accessibilityState={{
            ...accessibilityState,
            disabled: disabled || accessibilityState?.disabled,
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            focused && styles.focused,
            !!error && styles.error,
            disabled && styles.disabled,
            style,
          ]}
        />
        {error && (
          <AppText variant="caption" tone="danger" role="alert">
            {error}
          </AppText>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  input: {
    ...typography.input,
    minHeight: controlMinHeight,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radius,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
  },
  focused: { borderColor: colors.action },
  error: { borderColor: colors.danger },
  disabled: {
    backgroundColor: colors.disabledBackground,
    color: colors.disabledText,
  },
});
