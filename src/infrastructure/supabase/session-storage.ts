import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AESEncryptionKey,
  AESKeySize,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export class SessionStorageError extends Error {
  constructor() {
    super(
      'No se pudo acceder de forma segura a la sesión. Intenta nuevamente.',
    );
  }
}

const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
const encoder = new TextEncoder();

// One queue per logical Auth entry. Keys are never cached outside an operation.
export function createSessionStorage(
  namespace: string,
  onFailure: (error: SessionStorageError) => void,
) {
  const queues = new Map<string, Promise<unknown>>();
  const names = (key: string) => {
    const context = JSON.stringify(['gastos-auth', 1, namespace, key]);
    const encoded = Array.from(encoder.encode(context), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    return { location: `gastos.auth.${encoded}`, aad: encoder.encode(context) };
  };
  async function remove(location: string) {
    let failed = false;
    try {
      await SecureStore.deleteItemAsync(location, options);
    } catch {
      failed = true;
    }
    try {
      await AsyncStorage.removeItem(location);
    } catch {
      failed = true;
    }
    if (failed) throw new SessionStorageError();
  }
  function queued<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const next = (queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation)
      .catch(() => {
        const error = new SessionStorageError();
        onFailure(error);
        throw error;
      });
    queues.set(key, next);
    void next
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      })
      .catch(() => undefined);
    return next;
  }
  return {
    getItem(key: string): Promise<string | null> {
      return queued(key, async () => {
        const { location, aad } = names(key);
        // Native access failures must not be confused with missing values.
        const payload = await AsyncStorage.getItem(location);
        const secret = await SecureStore.getItemAsync(location, options);
        if (payload === null && secret === null) return null;
        if (payload === null || secret === null) {
          await remove(location);
          return null;
        }
        try {
          const envelope: unknown = JSON.parse(payload);
          if (
            typeof envelope !== 'object' ||
            envelope === null ||
            !('version' in envelope) ||
            envelope.version !== 1 ||
            !('sealed' in envelope) ||
            typeof envelope.sealed !== 'string'
          )
            throw new SessionStorageError();
          if (!/^[0-9a-f]{64}$/.test(secret)) throw new SessionStorageError();
          const encryptionKey = await AESEncryptionKey.import(secret, 'hex');
          const sealed = AESSealedData.fromCombined(envelope.sealed, {
            ivLength: 12,
            tagLength: 16,
          });
          const bytes = await aesDecryptAsync(sealed, encryptionKey, {
            additionalData: aad,
          });
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          await remove(location);
          // Lock the UI until the lifecycle retries and observes the removed entry.
          throw new SessionStorageError();
        }
      });
    },
    setItem(key: string, value: string): Promise<void> {
      return queued(key, async () => {
        const { location, aad } = names(key);
        let secret = await SecureStore.getItemAsync(location, options);
        if (secret === null) {
          await AsyncStorage.removeItem(location);
          const generated = await AESEncryptionKey.generate(AESKeySize.AES256);
          secret = await generated.encoded('hex');
          await SecureStore.setItemAsync(location, secret, options);
        }
        if (!/^[0-9a-f]{64}$/.test(secret)) {
          await remove(location);
          throw new SessionStorageError();
        }
        const encryptionKey = await AESEncryptionKey.import(secret, 'hex');
        const sealed = await aesEncryptAsync(
          encoder.encode(value),
          encryptionKey,
          { nonce: { length: 12 }, tagLength: 16, additionalData: aad },
        );
        await AsyncStorage.setItem(
          location,
          JSON.stringify({
            version: 1,
            sealed: await sealed.combined('base64'),
          }),
        );
      });
    },
    removeItem(key: string): Promise<void> {
      return queued(key, () => remove(names(key).location));
    },
  };
}
