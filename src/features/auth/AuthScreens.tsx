import { useState } from 'react';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { FormScreen } from '../../components/ui/Screen';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from './AuthProvider';
import {
  authErrorMessage,
  createProfile,
  isTimezone,
  profileKey,
  profileSchema,
  signInSchema,
  signUpSchema,
  type ProfileInput,
} from './auth-data';

export function SignInScreen() {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });
  return (
    <FormScreen>
      <AppText variant="title">Iniciar sesión</AppText>
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextField
            error={errors.email?.message}
            label="Correo"
            placeholder="Correo"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            editable={!isSubmitting}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextField
            error={errors.password?.message}
            label="Contraseña"
            placeholder="Contraseña"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            ref={field.ref}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            editable={!isSubmitting}
          />
        )}
      />
      {error && (
        <AppText role="alert" tone="danger">
          {error}
        </AppText>
      )}
      {auth.warning && (
        <AppText role="alert" tone="warning">
          {auth.warning}
        </AppText>
      )}
      <Button
        loading={isSubmitting}
        onPress={handleSubmit(async (input) => {
          setError(null);
          try {
            await auth.signIn(input);
            resetField('password');
          } catch (err) {
            setError(authErrorMessage(err));
          }
        })}
      >
        Iniciar sesión
      </Button>
      <Link href="/(auth)/sign-up" asChild>
        <Button variant="text">Crear cuenta</Button>
      </Link>
    </FormScreen>
  );
}
export function SignUpScreen() {
  const auth = useAuth();
  const [message, setMessage] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });
  return (
    <FormScreen>
      <AppText variant="title">Crear cuenta</AppText>
      {(['email', 'password', 'confirmPassword'] as const).map((name) => {
        const label =
          name === 'email'
            ? 'Correo'
            : name === 'password'
              ? 'Contraseña'
              : 'Confirmar contraseña';
        return (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field }) => (
              <TextField
                error={errors[name]?.message}
                label={label}
                placeholder={label}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                secureTextEntry={name !== 'email'}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={name === 'email' ? 'email-address' : 'default'}
                autoComplete={name === 'email' ? 'email' : 'new-password'}
                editable={!isSubmitting}
              />
            )}
          />
        );
      })}
      {message && <AppText role="alert">{message}</AppText>}
      <Button
        loading={isSubmitting}
        onPress={handleSubmit(async ({ email, password }) => {
          setMessage(null);
          try {
            const pending = await auth.signUp({ email, password });
            resetField('password');
            resetField('confirmPassword');
            if (pending)
              setMessage(
                'Revisa tu correo para confirmar la cuenta y luego inicia sesión.',
              );
          } catch (err) {
            setMessage(authErrorMessage(err));
          }
        })}
      >
        Crear cuenta
      </Button>
      <Link href="/(auth)/sign-in" asChild>
        <Button variant="text">Volver a iniciar sesión</Button>
      </Link>
    </FormScreen>
  );
}
function deviceTimezone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimezone(zone) ? zone : '';
  } catch {
    return '';
  }
}
export function ProfileSetupScreen() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: '',
      base_currency: '',
      timezone: deviceTimezone(),
    },
  });
  const userId = 'userId' in auth.state ? auth.state.userId : '';
  return (
    <FormScreen>
      <AppText variant="title">Completar perfil</AppText>
      {(['display_name', 'base_currency', 'timezone'] as const).map((name) => {
        const label =
          name === 'display_name'
            ? 'Nombre'
            : name === 'base_currency'
              ? 'Moneda (UYU, USD, EUR...)'
              : 'Zona horaria';
        return (
          <Controller
            key={name}
            control={control}
            name={name}
            render={({ field }) => (
              <TextField
                error={errors[name]?.message}
                label={label}
                placeholder={label}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                autoCapitalize={
                  name === 'base_currency' ? 'characters' : 'none'
                }
                autoCorrect={false}
                editable={!isSubmitting}
              />
            )}
          />
        );
      })}
      {error && (
        <AppText role="alert" tone="danger">
          {error}
        </AppText>
      )}
      <Button
        loading={isSubmitting}
        onPress={handleSubmit(async (input) => {
          if (!auth.isCurrentUser(userId)) return;
          setError(null);
          try {
            const result = await createProfile(userId, input);
            if (auth.isCurrentUser(userId))
              queryClient.setQueryData(profileKey(userId), result);
          } catch (err) {
            if (auth.isCurrentUser(userId)) setError(authErrorMessage(err));
          }
        })}
      >
        {error ? 'Reintentar guardar perfil' : 'Guardar perfil'}
      </Button>
      <Button
        variant="secondary"
        onPress={() => {
          void auth.signOut();
        }}
      >
        Cerrar sesión
      </Button>
    </FormScreen>
  );
}
