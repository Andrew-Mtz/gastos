// Profile Setup choices, not a domain-wide currency registry. Existing profiles
// retain the original three-uppercase-letter validation and stored currency.
export const profileCurrencyOptions = [
  { code: 'UYU', label: 'Peso uruguayo (UYU)' },
  { code: 'USD', label: 'Dólar estadounidense (USD)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'BRL', label: 'Real brasileño (BRL)' },
  { code: 'ARS', label: 'Peso argentino (ARS)' },
] as const;
