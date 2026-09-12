import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import {
  createSessionStorage,
  type SessionStorageError,
} from './session-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL is required.');
}

try {
  const url = new URL(supabaseUrl);

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error();
  }
} catch {
  throw new Error('EXPO_PUBLIC_SUPABASE_URL must be a valid HTTP(S) URL.');
}

if (!supabaseKey?.startsWith('sb_publishable_')) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable key.',
  );
}

let storageError: SessionStorageError | null = null;
const storageListeners = new Set<() => void>();
export const sessionStorageStatus = {
  getError: () => storageError,
  clear: () => {
    storageError = null;
  },
  subscribe: (listener: () => void) => {
    storageListeners.add(listener);
    return () => {
      storageListeners.delete(listener);
    };
  },
};
export const authStorageKey = 'gastos-auth';
export const sessionStorage = createSessionStorage(
  new URL(supabaseUrl).origin,
  (error) => {
    storageError = error;
    storageListeners.forEach((listener) => listener());
  },
);

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storageKey: authStorageKey,
    storage: sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
