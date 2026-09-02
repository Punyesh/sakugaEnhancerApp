import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// Confirmed directly from sakugabooru's own /help/api page: "Simply hashing
// your plain password will NOT work since Danbooru salts its passwords. The
// actual string that is hashed is 'er@!$rjiajd0$!dkaopc350!Y%)--your-password--'."
// This is the classic Danbooru-v1/Moebooru convention this fork inherited —
// not a modern token-based auth scheme, just what the site itself actually uses.
const PASSWORD_SALT_PREFIX = 'er@!$rjiajd0$!dkaopc350!Y%)--';
const PASSWORD_SALT_SUFFIX = '--';

export async function hashPassword(password: string): Promise<string> {
  const salted = PASSWORD_SALT_PREFIX + password + PASSWORD_SALT_SUFFIX;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, salted, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export interface StoredCredentials {
  username: string;
  passwordHash: string;
}

const CREDENTIALS_KEY = 'sakuga-credentials';

// The raw password itself is never stored — only the computed hash, and only
// in the OS's actual secure keychain (SecureStore), not plain AsyncStorage.
export async function saveCredentials(username: string, password: string): Promise<StoredCredentials> {
  const passwordHash = await hashPassword(password);
  const creds: StoredCredentials = { username, passwordHash };
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(creds));
  return creds;
}

export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  const raw = await SecureStore.getItemAsync(CREDENTIALS_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
}
