import { Text, type TextProps } from 'react-native';
import { colors, typography } from '../../theme/tokens';

type AppTextProps = TextProps & {
  variant?: 'title' | 'section' | 'body' | 'caption';
  tone?: 'primary' | 'secondary' | 'danger' | 'warning' | 'success';
};
const tones = {
  primary: colors.textPrimary,
  secondary: colors.textSecondary,
  danger: colors.danger,
  warning: colors.warning,
  success: colors.success,
};

export function AppText({
  variant = 'body',
  tone = 'primary',
  style,
  ...props
}: AppTextProps) {
  const heading = variant === 'title' || variant === 'section';
  return (
    <Text
      role={heading && !props.accessibilityRole ? 'heading' : undefined}
      {...props}
      style={[typography[variant], { color: tones[tone] }, style]}
    />
  );
}
