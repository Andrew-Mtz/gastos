import type { PropsWithChildren } from 'react';
import { AppText } from '../../components/ui/AppText';
import { Screen } from '../../components/ui/Screen';

export function PlaceholderScreen({
  title,
  message,
  children,
}: PropsWithChildren<{ title: string; message: string }>) {
  return (
    <Screen edges={['top', 'left', 'right']} scroll>
      <AppText variant="title">{title}</AppText>
      <AppText tone="secondary">{message}</AppText>
      {children}
    </Screen>
  );
}
