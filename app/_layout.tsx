import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/features/auth/AuthProvider';
import { AuthNavigator } from '../src/features/auth/AuthNavigator';

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AuthNavigator />
        </AuthProvider>
      </QueryClientProvider>
      <StatusBar style="dark" />
    </>
  );
}
