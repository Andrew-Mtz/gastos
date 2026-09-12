import { render, screen, userEvent } from '@testing-library/react-native';
import { Button } from '../Button';
import { ErrorState, LoadingState } from '../StatusState';

test('loading provides a readable busy label', async () => {
  await render(<LoadingState label="Cargando sesión" />);
  expect(
    screen.getByRole('progressbar', { name: 'Cargando sesión' }),
  ).toBeBusy();
  expect(screen.getByText('Cargando sesión')).toBeVisible();
});

test('error presents its message and invokes retry and optional secondary action', async () => {
  const retry = jest.fn();
  const signOut = jest.fn();
  await render(
    <ErrorState
      message="No se pudo cargar tu perfil."
      onRetry={retry}
      secondaryAction={
        <Button variant="secondary" onPress={signOut}>
          Cerrar sesión
        </Button>
      }
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'No se pudo cargar tu perfil.',
  );
  await userEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
  await userEvent.press(screen.getByRole('button', { name: 'Cerrar sesión' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(signOut).toHaveBeenCalledTimes(1);
});

test('error can be shown with retry alone', async () => {
  await render(
    <ErrorState message="Intenta nuevamente." onRetry={jest.fn()} />,
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
});
