import { render, screen, userEvent, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CategoryCreator } from '../CategoryCreator';
import { createExpenseCategory } from '../expense-data';
import { profile, bucket, category } from './fixtures';
jest.mock('../expense-data', () => ({ createExpenseCategory: jest.fn() }));
const current = jest.fn(() => true);
const created = jest.fn(async () => {});
beforeEach(() => {
  jest.clearAllMocks();
  current.mockReturnValue(true);
  jest.mocked(createExpenseCategory).mockResolvedValue(category);
});
async function open() {
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } })
      }
    >
      <CategoryCreator
        profileId={profile.id}
        buckets={[
          bucket,
          {
            ...bucket,
            id: 'f1040000-0000-4000-8000-000000000002',
            name: 'Savings',
            type: 'SAVINGS',
          },
        ]}
        isCurrent={current}
        onCreated={created}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.press(screen.getByRole('button', { name: 'Crear categoría' }));
  return user;
}
test('creates a personal category only after explicit name and spendable bucket selection', async () => {
  const user = await open();
  expect(
    screen.queryByRole('button', { name: 'Savings' }),
  ).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Guardar categoría' }));
  expect(createExpenseCategory).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('Nombre de categoría'), 'Food');
  await user.press(screen.getByRole('button', { name: 'Needs' }));
  await user.press(screen.getByRole('button', { name: 'Guardar categoría' }));
  expect(createExpenseCategory).toHaveBeenCalledWith(
    profile.id,
    bucket.id,
    'Food',
  );
  expect(created).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByRole('button', { name: 'Crear categoría' }),
  ).toBeOnTheScreen();
});
test('pending category creation blocks duplicate taps and auth departure hides completion', async () => {
  let resolve!: () => void;
  jest.mocked(createExpenseCategory).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = () => done(category);
      }),
  );
  const user = await open();
  await user.type(screen.getByLabelText('Nombre de categoría'), 'Food');
  await user.press(screen.getByRole('button', { name: 'Needs' }));
  await user.press(screen.getByRole('button', { name: 'Guardar categoría' }));
  expect(
    screen.getByRole('button', { name: 'Guardar categoría' }),
  ).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Guardar categoría' }));
  expect(createExpenseCategory).toHaveBeenCalledTimes(1);
  current.mockReturnValue(false);
  await act(async () => resolve());
  expect(screen.getByLabelText('Nombre de categoría')).toHaveDisplayValue(
    'Food',
  );
});
