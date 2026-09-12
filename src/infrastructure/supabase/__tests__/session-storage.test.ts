/// <reference types="node" />
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createSessionStorage, SessionStorageError } from '../session-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
// Exercise authenticated encryption with Node's implementation; native Expo APIs
// still require the separate physical-device verification.
jest.mock('expo-crypto', () => {
  const crypto: typeof import('node:crypto') =
    jest.requireActual('node:crypto');
  return {
    AESKeySize: { AES256: 256 },
    AESEncryptionKey: {
      generate: async (bits: number) => {
        if (bits !== 256) throw new Error('Expected AES-256');
        const key = crypto.randomBytes(32);
        return { encoded: async () => key.toString('hex') };
      },
      import: async (key: string) => Buffer.from(key, 'hex'),
    },
    AESSealedData: {
      fromCombined: (
        value: string,
        options: { ivLength: number; tagLength: number },
      ) => {
        if (options.ivLength !== 12 || options.tagLength !== 16)
          throw new Error('Invalid GCM parameters');
        return Buffer.from(value, 'base64');
      },
    },
    aesEncryptAsync: async (
      value: Uint8Array,
      key: Buffer,
      options: {
        nonce: { length: number };
        tagLength: number;
        additionalData: Uint8Array;
      },
    ) => {
      if (options.nonce.length !== 12 || options.tagLength !== 16)
        throw new Error('Invalid GCM parameters');
      const nonce = crypto.randomBytes(options.nonce.length);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(options.additionalData));
      const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
      return {
        combined: async () =>
          Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString(
            'base64',
          ),
      };
    },
    aesDecryptAsync: async (
      sealed: Buffer,
      key: Buffer,
      options: { additionalData: Uint8Array },
    ) => {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        sealed.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(options.additionalData));
      decipher.setAuthTag(sealed.subarray(-16));
      return Buffer.concat([
        decipher.update(sealed.subarray(12, -16)),
        decipher.final(),
      ]);
    },
  };
});

const keys = new Map<string, string>();
const payloads = new Map<string, string>();
const failure = jest.fn();
let storage: ReturnType<typeof createSessionStorage>;
beforeEach(() => {
  jest.resetAllMocks();
  keys.clear();
  payloads.clear();
  jest
    .mocked(SecureStore.getItemAsync)
    .mockImplementation(async (key) => keys.get(key) ?? null);
  jest
    .mocked(SecureStore.setItemAsync)
    .mockImplementation(async (key, value) => {
      keys.set(key, value);
    });
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    keys.delete(key);
  });
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async (key) => payloads.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    payloads.set(key, value);
  });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async (key) => {
    payloads.delete(key);
  });
  storage = createSessionStorage('local-project', failure);
});
function location() {
  return [...keys.keys(), ...payloads.keys()][0]!;
}

test.each(['session-value', 'Sesión 🏠 日本語', 'large-session-'.repeat(4000)])(
  'round trips value without plaintext persistence (%#)',
  async (value) => {
    await storage.setItem('session', value);
    expect(await storage.getItem('session')).toBe(value);
    expect([...payloads.values()][0]).not.toContain(value);
    expect([...keys.values()][0]).toMatch(/^[0-9a-f]{64}$/);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { keychainAccessible: 6, requireAuthentication: false },
    );
    expect(
      await createSessionStorage('local-project', failure).getItem('session'),
    ).toBe(value);
  },
);
test('empty storage is unauthenticated', async () => {
  expect(await storage.getItem('session')).toBeNull();
  expect(failure).not.toHaveBeenCalled();
});
test('refresh reuses key and creates a fresh nonce/ciphertext', async () => {
  await storage.setItem('session', 'same');
  const first = payloads.get(location());
  const key = keys.get(location());
  await storage.setItem('session', 'same');
  expect(keys.get(location())).toBe(key);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  expect(payloads.get(location())).not.toBe(first);
});
test.each(['version', 'ciphertext', 'wrong-key', 'invalid-json'])(
  'fails closed and cleans up %s',
  async (corruption) => {
    await storage.setItem('session', 'private');
    const target = location();
    if (corruption === 'wrong-key') keys.set(target, '01'.repeat(32));
    else if (corruption === 'invalid-json') payloads.set(target, '{');
    else {
      const envelope = JSON.parse(payloads.get(target)!);
      if (corruption === 'version') envelope.version = 2;
      else {
        const bytes = Buffer.from(envelope.sealed, 'base64');
        bytes[15] ^= 1;
        envelope.sealed = bytes.toString('base64');
      }
      payloads.set(target, JSON.stringify(envelope));
    }
    await expect(storage.getItem('session')).rejects.toBeInstanceOf(
      SessionStorageError,
    );
    expect(keys.size).toBe(0);
    expect(payloads.size).toBe(0);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(await storage.getItem('session')).toBeNull();
  },
);
test('AAD prevents swapping valid key and ciphertext between logical entries', async () => {
  await storage.setItem('first', 'private-A');
  const first = location();
  await storage.setItem('second', 'private-B');
  const second = [...keys.keys()][1]!;
  keys.set(second, keys.get(first)!);
  payloads.set(second, payloads.get(first)!);
  await expect(storage.getItem('second')).rejects.toBeInstanceOf(
    SessionStorageError,
  );
  expect(await storage.getItem('first')).toBe('private-A');
});
test.each(['key', 'payload'])(
  'cleans orphan %s without authenticating',
  async (orphan) => {
    await storage.setItem('session', 'private');
    if (orphan === 'key') payloads.clear();
    else keys.clear();
    expect(await storage.getItem('session')).toBeNull();
    expect(keys.size).toBe(0);
    expect(payloads.size).toBe(0);
  },
);
test.each(['secure', 'async'])(
  'temporary %s access failure is an error, not signed out',
  async (store) => {
    await storage.setItem('session', 'private');
    if (store === 'secure')
      jest
        .mocked(SecureStore.getItemAsync)
        .mockRejectedValueOnce(new Error('locked'));
    else
      jest
        .mocked(AsyncStorage.getItem)
        .mockRejectedValueOnce(new Error('unavailable'));
    await expect(storage.getItem('session')).rejects.toBeInstanceOf(
      SessionStorageError,
    );
    expect(keys.size).toBe(1);
    expect(payloads.size).toBe(1);
    expect(await storage.getItem('session')).toBe('private');
  },
);
test('failed key persistence never writes a ciphertext or plaintext payload', async () => {
  jest
    .mocked(SecureStore.setItemAsync)
    .mockRejectedValueOnce(new Error('locked'));
  await expect(storage.setItem('session', 'private')).rejects.toBeInstanceOf(
    SessionStorageError,
  );
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(payloads.size).toBe(0);
});
test('failed refresh write preserves previous readable session and queue recovers', async () => {
  await storage.setItem('session', 'old');
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk'));
  await expect(storage.setItem('session', 'failed')).rejects.toBeInstanceOf(
    SessionStorageError,
  );
  expect(await storage.getItem('session')).toBe('old');
  await storage.setItem('session', 'new');
  expect(await storage.getItem('session')).toBe('new');
});
test('concurrent writes are ordered and removal waits behind pending encryption/write', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementationOnce(async (key, value) => {
      await pending;
      payloads.set(key, value);
    });
  const first = storage.setItem('session', 'first');
  const second = storage.setItem('session', 'second');
  const read = storage.getItem('session');
  const removal = storage.removeItem('session');
  release();
  await Promise.all([first, second]);
  expect(await read).toBe('second');
  await removal;
  expect(keys.size).toBe(0);
  expect(payloads.size).toBe(0);
});
test.each(['secure', 'async'])(
  'removal attempts both stores and reports %s cleanup failure',
  async (store) => {
    await storage.setItem('session', 'private');
    jest.mocked(AsyncStorage.removeItem).mockClear();
    if (store === 'secure')
      jest
        .mocked(SecureStore.deleteItemAsync)
        .mockRejectedValueOnce(new Error('locked'));
    else
      jest
        .mocked(AsyncStorage.removeItem)
        .mockRejectedValueOnce(new Error('disk'));
    await expect(storage.removeItem('session')).rejects.toBeInstanceOf(
      SessionStorageError,
    );
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
    expect(AsyncStorage.removeItem).toHaveBeenCalled();
    expect(
      jest.mocked(SecureStore.deleteItemAsync).mock.invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(AsyncStorage.removeItem).mock.invocationCallOrder[0]!,
    );
    await storage.removeItem('session');
    expect(keys.size).toBe(0);
    expect(payloads.size).toBe(0);
  },
);
