import { createRef } from 'react';
import { Text, type View } from 'react-native';
import { Link } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Button } from '../Button';

afterEach(() => {
  jest.useRealTimers();
});

test('enabled button invokes its callback and forwards the native ref', async () => {
  const onPress = jest.fn();
  const ref = createRef<View>();
  await render(
    <Button ref={ref} onPress={onPress}>
      Guardar
    </Button>,
  );
  await userEvent.press(screen.getByRole('button', { name: 'Guardar' }));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(ref.current).not.toBeNull();
});

test.each(['disabled', 'loading'] as const)(
  '%s prevents activation and retains its label',
  async (state) => {
    const onPress = jest.fn();
    await render(
      <Button
        disabled={state === 'disabled'}
        loading={state === 'loading'}
        onPress={onPress}
      >
        Guardar
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Guardar')).toBeVisible();
    if (state === 'loading') expect(button).toBeBusy();
    await userEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  },
);

test('text button composes with a real Router Link and preserves link semantics', async () => {
  await renderRouter({
    index: () => (
      <Link href="/(auth)/sign-up" asChild>
        <Button variant="text">Crear cuenta</Button>
      </Link>
    ),
    '(auth)/sign-up': () => <Text>Signup destination</Text>,
  });
  await userEvent.press(screen.getByRole('link', { name: 'Crear cuenta' }));
  expect(await screen.findByText('Signup destination')).toBeVisible();
});
