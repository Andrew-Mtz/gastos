import { expenseErrorMessage, validateExpenseForm } from '../expense-form';
import { financialDate } from '../../income/income-form';
import { period, request } from './fixtures';
test.each(['0', '-1', '1.001', '1,000.00', 'abc', '90071992547409.92'])(
  'rejects invalid amount %s',
  (amount) => {
    expect(
      validateExpenseForm(period).safeParse({ ...request.form, amount })
        .success,
    ).toBe(false);
  },
);
test.each(['1000.23', '1000,23'])('accepts exact decimal %s', (amount) => {
  expect(
    validateExpenseForm(period).safeParse({ ...request.form, amount }).success,
  ).toBe(true);
});
test.each(['2026-09-30', '2026-11-01', '2026-02-30', '0000-01-01'])(
  'rejects invalid financial date %s',
  (date) => {
    expect(
      validateExpenseForm(period).safeParse({ ...request.form, date }).success,
    ).toBe(false);
  },
);
test('financial date follows user timezone at month boundary', () => {
  expect(
    financialDate('America/Montevideo', new Date('2026-11-01T01:00:00Z')),
  ).toBe('2026-10-31');
});
test('sanitizes infrastructure errors', () => {
  expect(
    expenseErrorMessage({ code: '42501', message: 'private salary' }),
  ).not.toContain('private salary');
});

test('requires explicit category', () => {
  expect(
    validateExpenseForm(period).safeParse({ ...request.form, categoryId: '' })
      .success,
  ).toBe(false);
});
