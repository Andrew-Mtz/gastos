import { goalProgress, savingsGoalSchema } from '../savings-goal';
import { goalFormSchema } from '../../../features/savings/goals-form';

const goal = {
  id: '61160000-0000-4000-8000-000000000001',
  owner_profile_id: 'f0050000-0000-4000-8000-000000000001',
  scope: 'PERSONAL',
  name: 'Trip',
  target_amount_minor: 100,
  currency: 'USD',
  target_date: null,
};
test('zero, reached, overfunded and withdrawn progress use exact minor units', () => {
  expect(goalProgress(100, 0, 'USD')).toMatchObject({
    attained: false,
    remaining: { amountMinor: 100 },
  });
  expect(goalProgress(100, 100, 'USD')).toMatchObject({
    attained: true,
    remaining: { amountMinor: 0 },
  });
  expect(goalProgress(100, 125, 'USD')).toMatchObject({
    attained: true,
    balance: { amountMinor: 125 },
    remaining: { amountMinor: 0 },
  });
  expect(goalProgress(100, 75, 'USD')).toMatchObject({
    attained: false,
    remaining: { amountMinor: 25 },
  });
  expect(
    goalProgress(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'JPY')
      .attained,
  ).toBe(true);
});
test.each([
  [0, 0],
  [-1, 1],
  [100, -1],
  [1.2, 1],
  [100, NaN],
  [Number.MAX_SAFE_INTEGER + 1, 0],
  [100, Infinity],
])('rejects invalid target/balance %s %s', (target, balance) =>
  expect(() => goalProgress(target, balance, 'USD')).toThrow(),
);
test.each([
  { scope: 'HOUSEHOLD' },
  { name: '' },
  { name: ' Trip ' },
  { name: 'x'.repeat(121) },
  { target_amount_minor: 0 },
  { currency: 'usd' },
  { target_date: '2027-02-29' },
  { target_date: '0000-01-01' },
])('invalid goal boundary %s', (patch) =>
  expect(() => savingsGoalSchema.parse({ ...goal, ...patch })).toThrow(),
);
test('optional valid date and goal forms retain exact decimal input', () => {
  expect(
    savingsGoalSchema.parse({ ...goal, target_date: '2028-02-29' }).target_date,
  ).toBe('2028-02-29');
  expect(
    goalFormSchema.parse({
      name: ' Trip ',
      target: '12.34',
      currency: 'USD',
      targetDate: '',
    }),
  ).toEqual({ name: 'Trip', target: '12.34', currency: 'USD', targetDate: '' });
});
test.each([
  { target: '0' },
  { target: '-1' },
  { target: '1.001' },
  { target: '90071992547409.92' },
  { targetDate: '2026-13-01' },
  { targetDate: '2027-02-29' },
  { targetDate: '0000-01-01' },
  { name: ' ' },
])('rejects invalid goal form %s', (patch) =>
  expect(() =>
    goalFormSchema.parse({
      name: 'Trip',
      target: '1.00',
      currency: 'USD',
      targetDate: '',
      ...patch,
    }),
  ).toThrow(),
);
