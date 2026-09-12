import { AppText } from './ui/AppText';
import { Screen } from './ui/Screen';

export function BootstrapScreen() {
  return (
    <Screen edges={['top', 'left', 'right']} centered scroll>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        Gastos
      </AppText>
      <AppText tone="secondary" style={{ textAlign: 'center' }}>
        La aplicación está lista para comenzar.
      </AppText>
    </Screen>
  );
}
