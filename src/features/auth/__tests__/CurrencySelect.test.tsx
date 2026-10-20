import { useState } from 'react';
import {
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';
import { CurrencySelect } from '../CurrencySelect';
import { profileCurrencyOptions } from '../profile-currencies';

function Field({ initialValue = '' }: { initialValue?: string }) {
  const [value, setValue] = useState(initialValue);
  return <CurrencySelect value={value} onChange={setValue} onBlur={() => {}} />;
}

test.each(profileCurrencyOptions)(
  'selects $code from exactly the five approved options without free text',
  async ({ label }) => {
    await render(<Field />);
    const user = userEvent.setup();
    const field = screen.getByRole('combobox', { name: 'Moneda' });
    expect(field).toBeCollapsed();
    expect(field).toHaveAccessibilityValue({ text: 'Selecciona una moneda' });
    expect(screen.queryByRole('textbox')).not.toBeOnTheScreen();
    await user.press(field);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    for (const option of profileCurrencyOptions) {
      expect(
        screen.getByRole('radio', { name: option.label }),
      ).not.toBeChecked();
    }
    await user.press(screen.getByRole('radio', { name: label }));
    expect(screen.getByRole('combobox', { name: 'Moneda' })).toBeCollapsed();
    expect(
      screen.getByRole('combobox', { name: 'Moneda' }),
    ).toHaveAccessibilityValue({
      text: label,
    });
    expect(screen.queryByText('Seleccionar moneda')).not.toBeOnTheScreen();
    await user.press(screen.getByRole('combobox', { name: 'Moneda' }));
    expect(screen.getByRole('radio', { name: label })).toBeChecked();
  },
);

test.each(['cancel', 'requestClose', 'accessibilityEscape'])(
  '%s dismisses without changing selection and permits reopening',
  async (dismissal) => {
    await render(<Field initialValue="BRL" />);
    const user = userEvent.setup();
    await user.press(screen.getByRole('combobox', { name: 'Moneda' }));
    if (dismissal === 'cancel') {
      await user.press(screen.getByRole('button', { name: 'Cancelar' }));
    } else if (dismissal === 'accessibilityEscape') {
      // Modal does not forward this callback to its native host. Exercise the
      // inner View, which actually receives the VoiceOver escape gesture.
      await fireEvent(screen.getByLabelText('Opciones de moneda'), dismissal);
    } else {
      await fireEvent(screen.getByText('Seleccionar moneda'), dismissal);
    }
    expect(screen.queryByText('Seleccionar moneda')).not.toBeOnTheScreen();
    expect(
      screen.getByRole('combobox', { name: 'Moneda' }),
    ).toHaveAccessibilityValue({
      text: 'Real brasileño (BRL)',
    });
    await user.press(screen.getByRole('combobox', { name: 'Moneda' }));
    expect(
      screen.getByRole('radio', { name: 'Real brasileño (BRL)' }),
    ).toBeChecked();
  },
);

test('disabled selector cannot open or change its value', async () => {
  const onChange = jest.fn();
  await render(
    <CurrencySelect
      value="USD"
      onChange={onChange}
      onBlur={() => {}}
      disabled
    />,
  );
  const field = screen.getByRole('combobox', { name: 'Moneda' });
  expect(field).toBeDisabled();
  await userEvent.press(field);
  expect(screen.queryByText('Seleccionar moneda')).not.toBeOnTheScreen();
  expect(onChange).not.toHaveBeenCalled();
});

test('selection passes the ISO code and marks the field touched', async () => {
  const onChange = jest.fn();
  const onBlur = jest.fn();
  await render(<CurrencySelect value="" onChange={onChange} onBlur={onBlur} />);
  await userEvent.press(screen.getByRole('combobox', { name: 'Moneda' }));
  await userEvent.press(
    screen.getByRole('radio', { name: 'Peso argentino (ARS)' }),
  );
  expect(onChange).toHaveBeenCalledWith('ARS');
  expect(onBlur).toHaveBeenCalledTimes(1);
});

test('validation error is visible and included in the accessible hint', async () => {
  await render(
    <CurrencySelect
      value=""
      onChange={() => {}}
      onBlur={() => {}}
      error="Selecciona una moneda."
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Selecciona una moneda.');
  expect(screen.getByRole('combobox', { name: 'Moneda' })).toHaveProp(
    'accessibilityHint',
    'Selecciona una moneda.',
  );
});
