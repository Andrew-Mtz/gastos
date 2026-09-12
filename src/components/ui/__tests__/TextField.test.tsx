import { createRef, useState } from 'react';
import { TextInput } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { TextField } from '../TextField';

test('label persists during input, blur reaches the caller, and ref reaches the input', async () => {
  const onBlur = jest.fn();
  const ref = createRef<TextInput>();
  function Field() {
    const [value, setValue] = useState('');
    return (
      <TextField
        label="Correo"
        value={value}
        onChangeText={setValue}
        onBlur={onBlur}
        ref={ref}
        keyboardType="email-address"
        autoComplete="email"
      />
    );
  }
  await render(<Field />);
  await userEvent.type(screen.getByLabelText('Correo'), 'person@example.test');
  expect(screen.getByText('Correo')).toBeVisible();
  expect(screen.getByLabelText('Correo')).toHaveDisplayValue(
    'person@example.test',
  );
  expect(onBlur).toHaveBeenCalledTimes(1);
  expect(ref.current).not.toBeNull();
});

test('errors are visible alerts and included in the input hint', async () => {
  await render(<TextField label="Nombre" error="Ingresa tu nombre." />);
  expect(screen.getByRole('alert')).toHaveTextContent('Ingresa tu nombre.');
  expect(screen.getByLabelText('Nombre')).toHaveProp(
    'accessibilityHint',
    'Ingresa tu nombre.',
  );
});

test('native password and editable props remain usable', async () => {
  const onChangeText = jest.fn();
  await render(
    <TextField
      label="Contraseña"
      secureTextEntry
      autoComplete="current-password"
      editable={false}
      value="secret"
      onChangeText={onChangeText}
    />,
  );
  const input = screen.getByLabelText('Contraseña');
  expect(input).toHaveProp('secureTextEntry', true);
  expect(input).toHaveProp('autoComplete', 'current-password');
  expect(input).toBeDisabled();
  await userEvent.type(input, 'ignored');
  expect(onChangeText).not.toHaveBeenCalled();
});
