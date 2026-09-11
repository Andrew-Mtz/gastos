import { render, screen } from '@testing-library/react-native';

import { BootstrapScreen } from '../BootstrapScreen';

test('renders the bootstrap heading and message', async () => {
  await render(<BootstrapScreen />);

  expect(screen.getByRole('header', { name: 'Gastos' })).toBeOnTheScreen();
  expect(
    screen.getByText('La aplicación está lista para comenzar.'),
  ).toBeOnTheScreen();
});
