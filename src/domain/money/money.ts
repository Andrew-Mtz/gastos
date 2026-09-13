declare const currencyCodeBrand: unique symbol;
declare const moneyBrand: unique symbol;

export type CurrencyCode = string & {
  readonly [currencyCodeBrand]: true;
};

export type Money = Readonly<{
  amountMinor: number;
  currency: CurrencyCode;
}> & {
  readonly [moneyBrand]: true;
};

export type MoneyErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_CURRENCY'
  | 'CURRENCY_MISMATCH'
  | 'ARITHMETIC_OVERFLOW';

const errorMessages: Record<MoneyErrorCode, string> = {
  INVALID_AMOUNT: 'Money requires a safe-integer minor-unit amount.',
  INVALID_CURRENCY: 'Currency requires exactly three ASCII uppercase letters.',
  CURRENCY_MISMATCH: 'Money currencies must match for this operation.',
  ARITHMETIC_OVERFLOW: 'Money arithmetic exceeded the safe integer range.',
};

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode) {
    super(errorMessages[code]);
    this.name = 'MoneyError';
    this.code = code;
  }
}

export function createCurrencyCode(value: string): CurrencyCode {
  if (
    typeof value !== 'string' ||
    value.length !== 3 ||
    !/^[A-Z]{3}$/.test(value)
  ) {
    throw new MoneyError('INVALID_CURRENCY');
  }
  // Branding follows validation; it does not assert ISO registry membership.
  return value as CurrencyCode;
}

function validateAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyError('INVALID_AMOUNT');
  }
}

export function createMoney(amountMinor: number, currency: string): Money {
  validateAmount(amountMinor);
  const currencyCode = createCurrencyCode(currency);
  // Only validated values receive the compile-time brand; JSON stays plain.
  return Object.freeze({
    amountMinor: amountMinor === 0 ? 0 : amountMinor,
    currency: currencyCode,
  }) as Money;
}

function validateMoney(value: Money): void {
  if (value === null || typeof value !== 'object') {
    throw new MoneyError('INVALID_AMOUNT');
  }
  validateAmount(value.amountMinor);
  createCurrencyCode(value.currency);
}

function validatePair(a: Money, b: Money): void {
  validateMoney(a);
  validateMoney(b);
}

function requireSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError('CURRENCY_MISMATCH');
  }
}

function arithmeticResult(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyError('ARITHMETIC_OVERFLOW');
  }
  return createMoney(amountMinor, currency);
}

export function addMoney(a: Money, b: Money): Money {
  validatePair(a, b);
  requireSameCurrency(a, b);
  return arithmeticResult(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  validatePair(a, b);
  requireSameCurrency(a, b);
  return arithmeticResult(a.amountMinor - b.amountMinor, a.currency);
}

export function negateMoney(value: Money): Money {
  validateMoney(value);
  return arithmeticResult(-value.amountMinor, value.currency);
}

export function moneyEquals(a: Money, b: Money): boolean {
  validatePair(a, b);
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  validatePair(a, b);
  requireSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}
