import type { TextStyle } from 'react-native';

export const colors = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  textPrimary: '#17212B',
  textSecondary: '#384858',
  border: '#7A8794',
  action: '#2457A7',
  actionPressed: '#1C4585',
  onAction: '#FFFFFF',
  success: '#176B45',
  warning: '#8A5200',
  danger: '#A01515',
  disabledBackground: '#E2E8F0',
  disabledText: '#52606D',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;
export const radius = 8;
export const controlMinHeight = 48;

export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  section: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  input: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
} as const satisfies Record<string, TextStyle>;
