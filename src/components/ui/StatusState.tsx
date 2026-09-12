import type { ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { colors } from '../../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { Screen } from './Screen';

export function LoadingState({ label }: { label: string }) {
  return (
    <Screen centered scroll>
      <ActivityIndicator color={colors.action} accessible={false} />
      <AppText role="progressbar" aria-busy style={{ textAlign: 'center' }}>
        {label}
      </AppText>
    </Screen>
  );
}

export function ErrorState({
  message,
  onRetry,
  secondaryAction,
}: {
  message: string;
  onRetry: () => void;
  secondaryAction?: ReactNode;
}) {
  return (
    <Screen centered scroll>
      <AppText role="alert" tone="danger">
        {message}
      </AppText>
      <Button onPress={onRetry}>Reintentar</Button>
      {secondaryAction}
    </Screen>
  );
}
