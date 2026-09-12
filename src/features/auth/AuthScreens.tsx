import { useState } from 'react';
import {
  Button,
  ScrollView,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
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

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  heading: { fontSize: 26, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#666',
    borderRadius: 6,
    padding: 12,
    minHeight: 48,
  },
  field: { gap: 6 },
  error: { color: '#a01515' },
});
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
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.screen}
    >
      <Text role="heading" style={styles.heading}>
        Iniciar sesión
      </Text>
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextInput
            accessibilityLabel="Correo"
            placeholder="Correo"
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            editable={!isSubmitting}
          />
        )}
      />
      {errors.email && (
        <Text role="alert" style={styles.error}>
          {errors.email.message}
        </Text>
      )}
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextInput
            accessibilityLabel="Contraseña"
            placeholder="Contraseña"
            style={styles.input}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            editable={!isSubmitting}
          />
        )}
      />
      {errors.password && (
        <Text role="alert" style={styles.error}>
          {errors.password.message}
        </Text>
      )}
      {error && <Text role="alert">{error}</Text>}
      {auth.warning && <Text role="alert">{auth.warning}</Text>}
      <Button
        title="Iniciar sesión"
        disabled={isSubmitting}
        onPress={handleSubmit(async (input) => {
          setError(null);
          try {
            await auth.signIn(input);
            resetField('password');
          } catch (err) {
            setError(authErrorMessage(err));
          }
        })}
      />
      <Link href="/(auth)/sign-up">Crear cuenta</Link>
    </ScrollView>
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
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.screen}
    >
      <Text role="heading" style={styles.heading}>
        Crear cuenta
      </Text>
      {(['email', 'password', 'confirmPassword'] as const).map((name) => {
        const label =
          name === 'email'
            ? 'Correo'
            : name === 'password'
              ? 'Contraseña'
              : 'Confirmar contraseña';
        return (
          <View key={name} style={styles.field}>
            <Controller
              control={control}
              name={name}
              render={({ field }) => (
                <TextInput
                  accessibilityLabel={label}
                  placeholder={label}
                  style={styles.input}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  secureTextEntry={name !== 'email'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={name === 'email' ? 'email-address' : 'default'}
                  autoComplete={name === 'email' ? 'email' : 'new-password'}
                  editable={!isSubmitting}
                />
              )}
            />
            {errors[name] && (
              <Text role="alert" style={styles.error}>
                {errors[name].message}
              </Text>
            )}
          </View>
        );
      })}
      {message && <Text role="alert">{message}</Text>}
      <Button
        title="Crear cuenta"
        disabled={isSubmitting}
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
      />
      <Link href="/(auth)/sign-in">Volver a iniciar sesión</Link>
    </ScrollView>
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
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.screen}
    >
      <Text role="heading" style={styles.heading}>
        Completar perfil
      </Text>
      {(['display_name', 'base_currency', 'timezone'] as const).map((name) => {
        const label =
          name === 'display_name'
            ? 'Nombre'
            : name === 'base_currency'
              ? 'Moneda (UYU, USD, EUR...)'
              : 'Zona horaria';
        return (
          <View key={name} style={styles.field}>
            <Controller
              control={control}
              name={name}
              render={({ field }) => (
                <TextInput
                  accessibilityLabel={label}
                  placeholder={label}
                  style={styles.input}
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  autoCapitalize={
                    name === 'base_currency' ? 'characters' : 'none'
                  }
                  autoCorrect={false}
                  editable={!isSubmitting}
                />
              )}
            />
            {errors[name] && (
              <Text role="alert" style={styles.error}>
                {errors[name].message}
              </Text>
            )}
          </View>
        );
      })}
      {error && <Text role="alert">{error}</Text>}
      <Button
        title={error ? 'Reintentar guardar perfil' : 'Guardar perfil'}
        disabled={isSubmitting}
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
      />
      <Button
        title="Cerrar sesión"
        onPress={() => {
          void auth.signOut();
        }}
      />
    </ScrollView>
  );
}
