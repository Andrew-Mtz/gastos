import { z } from 'zod';
import { supabase } from '../../infrastructure/supabase/client';

export const signInSchema = z.object({
  email: z.string().trim().pipe(z.email('Ingresa un correo válido.')),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});
export const signUpSchema = signInSchema
  .extend({
    password: z.string().min(6, 'Usa al menos 6 caracteres.'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden.',
  });
export function isTimezone(value: string) {
  if (
    !(value === 'UTC' || value.includes('/')) ||
    /^(posix|right)\//.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, 'Ingresa tu nombre.')
    .refine(
      (value) => Array.from(value).length <= 100,
      'Usa hasta 100 caracteres.',
    ),
  base_currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Usa tres letras mayúsculas, por ejemplo UYU o USD.'),
  timezone: z
    .string()
    .refine(
      isTimezone,
      'Ingresa una zona válida, por ejemplo America/Montevideo.',
    ),
});
const profileRowSchema = profileSchema.extend({
  id: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProfileInput = z.infer<typeof profileSchema>;
export type Profile = z.infer<typeof profileRowSchema>;
export const profileKey = (id: string) => ['profile', id] as const;
const columns = 'id,display_name,base_currency,timezone,created_at,updated_at';
export async function readProfile(
  id: string,
  signal?: AbortSignal,
): Promise<Profile | null> {
  let query = supabase.from('profiles').select(columns).eq('id', id);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data === null ? null : profileRowSchema.parse(data);
}
export async function createProfile(
  id: string,
  input: ProfileInput,
): Promise<Profile> {
  const existing = await readProfile(id);
  if (existing) return existing;
  const { data, error } = await supabase
    .from('profiles')
    .insert({ id, ...profileSchema.parse(input) })
    .select(columns)
    .single();
  if (!error && data) return profileRowSchema.parse(data);
  // An INSERT response may be lost after commit, or a second submit may win.
  const recovered = await readProfile(id);
  if (recovered) return recovered;
  throw error ?? new Error('Profile creation failed');
}
export function authErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  if (code === 'invalid_credentials') return 'Correo o contraseña incorrectos.';
  if (code === 'email_not_confirmed')
    return 'Confirma tu correo antes de iniciar sesión.';
  if (code === 'weak_password')
    return 'La contraseña no cumple los requisitos de seguridad.';
  if (code === 'user_already_exists' || code === 'email_exists')
    return 'No pudimos completar el registro. Intenta iniciar sesión o revisa tu correo.';
  if (code === '23514' || code === '23502')
    return 'Revisa el nombre, la moneda y la zona horaria.';
  return 'No se pudo completar la operación. Revisa tu conexión e intenta nuevamente.';
}
