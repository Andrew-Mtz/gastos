import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authStorageKey,
  sessionStorage,
  sessionStorageStatus,
  supabase,
} from '../../infrastructure/supabase/client';
import { profileKey, readProfile, type Profile } from './auth-data';

type IdentityState =
  | { status: 'INITIALIZING' | 'UNAUTHENTICATED' }
  | { status: 'INITIALIZATION_ERROR'; message: string }
  | { status: 'AUTHENTICATED'; userId: string }
  | { status: 'SIGNING_OUT'; message?: string };
export type AuthState =
  | Exclude<IdentityState, { status: 'AUTHENTICATED' }>
  | {
      status:
        | 'AUTHENTICATED_PROFILE_LOADING'
        | 'AUTHENTICATED_PROFILE_MISSING'
        | 'AUTHENTICATED_PROFILE_ERROR';
      userId: string;
    }
  | { status: 'AUTHENTICATED_READY'; userId: string; profile: Profile };
type Credentials = { email: string; password: string };
type AuthContextValue = {
  state: AuthState;
  warning: string | null;
  retry: () => void;
  signOut: () => Promise<void>;
  signIn: (input: Credentials) => Promise<void>;
  signUp: (input: Credentials) => Promise<boolean>;
  isCurrentUser: (id: string) => boolean;
};
const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<IdentityState>({
    status: 'INITIALIZING',
  });
  const identityRef = useRef(identity);
  const [warning, setWarning] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const loggingOut = useRef(false);
  const authWork = useRef<Promise<unknown> | null>(null);
  const refreshWork = useRef<Promise<void>>(Promise.resolve());
  const reconcileRefresh = useRef<() => Promise<void>>(() => Promise.resolve());
  const replaceIdentity = (next: IdentityState) => {
    identityRef.current = next;
    setIdentity(next);
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let revision = 0;
    let initialized = false;
    let latestUserId: string | undefined;
    let refreshRunning: boolean | undefined;
    const clearPrivateData = () => {
      void queryClient.cancelQueries();
      queryClient.clear();
    };
    const storageFailure = () => {
      if (!active) return;
      clearPrivateData();
      if (loggingOut.current) return;
      replaceIdentity({
        status: 'INITIALIZATION_ERROR',
        message:
          'No se pudo restaurar la sesión de forma segura. Intenta nuevamente.',
      });
      void reconcile();
    };
    const reconcile = () => {
      refreshWork.current = refreshWork.current
        .catch(() => undefined)
        .then(async () => {
          const shouldRun =
            active &&
            initialized &&
            !loggingOut.current &&
            identityRef.current.status !== 'INITIALIZATION_ERROR' &&
            !sessionStorageStatus.getError() &&
            AppState.currentState === 'active';
          if (refreshRunning === shouldRun) return;
          if (shouldRun) await supabase.auth.startAutoRefresh();
          else await supabase.auth.stopAutoRefresh();
          refreshRunning = shouldRun;
        })
        .catch(() => {
          if (active && !loggingOut.current)
            replaceIdentity({
              status: 'INITIALIZATION_ERROR',
              message: 'No se pudo actualizar la sesión. Intenta nuevamente.',
            });
        });
      return refreshWork.current;
    };
    reconcileRefresh.current = reconcile;
    const acceptIdentity = (userId: string | undefined) => {
      if (!active || loggingOut.current) return;
      if (sessionStorageStatus.getError()) {
        storageFailure();
        return;
      }
      const previous = identityRef.current;
      if (previous.status !== 'AUTHENTICATED' || previous.userId !== userId)
        clearPrivateData();
      replaceIdentity(
        userId
          ? { status: 'AUTHENTICATED', userId }
          : { status: 'UNAUTHENTICATED' },
      );
      void reconcile();
    };
    const unsubscribeStorage = sessionStorageStatus.subscribe(storageFailure);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      revision++;
      latestUserId = session?.user?.id;
      if (initialized) acceptIdentity(latestUserId);
    });
    const initialRevision = revision;
    void reconcile();
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || loggingOut.current) return;
        if (error || sessionStorageStatus.getError()) {
          storageFailure();
          return;
        }
        initialized = true;
        acceptIdentity(
          revision === initialRevision ? data.session?.user?.id : latestUserId,
        );
      })
      .catch(storageFailure);
    const appSubscription = AppState.addEventListener('change', () => {
      void reconcile();
    });
    return () => {
      active = false;
      mounted.current = false;
      subscription.unsubscribe();
      appSubscription.remove();
      unsubscribeStorage();
      void reconcile();
    };
  }, [attempt, queryClient]);

  const userId = identity.status === 'AUTHENTICATED' ? identity.userId : '';
  const profile = useQuery({
    queryKey: profileKey(userId),
    queryFn: ({ signal }) => readProfile(userId, signal),
    enabled: !!userId,
    retry: false,
  });
  let state: AuthState;
  if (identity.status !== 'AUTHENTICATED') state = identity;
  else if (profile.isError)
    state = { status: 'AUTHENTICATED_PROFILE_ERROR', userId };
  else if (profile.isPending)
    state = { status: 'AUTHENTICATED_PROFILE_LOADING', userId };
  else if (profile.data === null)
    state = { status: 'AUTHENTICATED_PROFILE_MISSING', userId };
  else state = { status: 'AUTHENTICATED_READY', userId, profile: profile.data };

  async function authenticate(
    input: Credentials,
    signup: boolean,
  ): Promise<boolean> {
    if (loggingOut.current || authWork.current)
      throw new Error('Authentication busy');
    setWarning(null);
    const operation = (async () => {
      const result = signup
        ? await supabase.auth.signUp(input)
        : await supabase.auth.signInWithPassword(input);
      if (result.error) throw result.error;
      if (sessionStorageStatus.getError())
        throw sessionStorageStatus.getError();
      return result.data.session === null;
    })();
    authWork.current = operation;
    try {
      return await operation;
    } finally {
      if (authWork.current === operation) authWork.current = null;
    }
  }
  async function signOut() {
    if (loggingOut.current && !('message' in identityRef.current)) return;
    loggingOut.current = true;
    replaceIdentity({ status: 'SIGNING_OUT' });
    await queryClient.cancelQueries();
    queryClient.clear();
    await reconcileRefresh.current();
    try {
      await authWork.current?.catch(() => undefined);
      sessionStorageStatus.clear();
      let remoteFailed = false;
      try {
        const result = await supabase.auth.signOut({ scope: 'local' });
        remoteFailed = !!result.error;
      } catch {
        remoteFailed = true;
      }
      // The SDK may stop cleanup early after a storage failure. Retry all owned entries.
      const results = await Promise.allSettled(
        [
          authStorageKey,
          `${authStorageKey}-user`,
          `${authStorageKey}-code-verifier`,
        ].map((key) => sessionStorage.removeItem(key)),
      );
      if (results.some((result) => result.status === 'rejected'))
        throw new Error('Cleanup failed');
      sessionStorageStatus.clear();
      const result = await supabase.auth.getSession();
      if (
        result.error ||
        result.data.session ||
        sessionStorageStatus.getError()
      )
        throw new Error('Cleanup unconfirmed');
      await queryClient.cancelQueries();
      queryClient.clear();
      if (mounted.current) {
        loggingOut.current = false;
        setWarning(
          remoteFailed
            ? 'La sesión se cerró en este dispositivo, pero no se pudo confirmar la revocación remota.'
            : null,
        );
        replaceIdentity({ status: 'UNAUTHENTICATED' });
        // Re-establish initialization even when logout followed a restore error.
        setAttempt((value) => value + 1);
      }
    } catch {
      await queryClient.cancelQueries();
      queryClient.clear();
      if (mounted.current)
        replaceIdentity({
          status: 'SIGNING_OUT',
          message: 'No se pudo confirmar el cierre local. Intenta nuevamente.',
        });
    }
  }
  const retry = () => {
    if (identity.status === 'AUTHENTICATED') {
      void profile.refetch();
      return;
    }
    sessionStorageStatus.clear();
    replaceIdentity({ status: 'INITIALIZING' });
    setAttempt((value) => value + 1);
  };
  return (
    <AuthContext.Provider
      value={{
        state,
        warning,
        retry,
        signOut,
        signIn: async (input) => {
          await authenticate(input, false);
        },
        signUp: (input) => authenticate(input, true),
        isCurrentUser: (id) =>
          !loggingOut.current &&
          identityRef.current.status === 'AUTHENTICATED' &&
          identityRef.current.userId === id,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
