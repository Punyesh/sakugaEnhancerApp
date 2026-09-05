import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { BASE_URL } from './sakugabooru';
import { setSessionEstablished } from './sessionState';

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

// Establishes a real browser-style session with the site — separate from the
// password_hash-based API auth everything else uses, and purely so
// fetchServerVote (sakugabooru.ts) can read a real per-account vote state.
// That only works with the same session cookie a logged-in browser carries,
// since that's how the site recognizes who's asking; the hash-based auth
// used for voting/commenting is stateless per-request and never gets one.
//
// Confirmed directly against the live site via DevTools: GET /user/login
// serves a page containing a CSRF `authenticity_token`; POST
// /user/authenticate with that token plus `user[name]`/`user[password]`
// sets a `session_sakugabooru` cookie (httponly — invisible to JS, which is
// fine, since it only needs to land in the platform's own cookie store so
// later fetches from this app resend it automatically; not something this
// code reads or stores itself).
//
// What's NOT independently confirmed: that React Native's fetch actually
// persists and resends that cookie the way a real browser tab does. Its
// native networking layer (NSURLSession on iOS, OkHttp on Android) is
// documented to maintain a persistent, app-wide cookie store automatically,
// which is what this relies on — but that's a platform-behavior assumption,
// not something tested live the way every param/endpoint above was. Worth
// verifying on a real device: log in, then check whether fetchServerVote
// actually returns a real value instead of null on a post rated from
// elsewhere.
//
// Best-effort and silently non-fatal by design: if any step here fails,
// vote-checking just falls back to the local per-device guess rather than
// blocking login, which still works fully without this.
export async function establishSession(username: string, password: string): Promise<boolean> {
  try {
    const loginPageRes = await fetch(`${BASE_URL}/user/login`);
    const loginPageHtml = await loginPageRes.text();
    // Isolate the whole tag first, then pull `value` from within just that —
    // attribute order in real HTML isn't guaranteed (e.g. `type="hidden"`
    // could sit between `name` and `value`), so anchoring directly on
    // `name="..." value="..."` being adjacent is too fragile.
    const tagMatch = loginPageHtml.match(/<input[^>]*name="authenticity_token"[^>]*>/);
    const valueMatch = tagMatch && tagMatch[0].match(/value="([^"]*)"/);
    if (!valueMatch) { await setSessionEstablished(false); return false; }
    const token = valueMatch[1];

    const params = new URLSearchParams();
    params.set('authenticity_token', token);
    params.set('url', '');
    params.set('user[name]', username);
    params.set('user[password]', password);
    params.set('commit', 'Login');

    const authRes = await fetch(`${BASE_URL}/user/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    // A successful login redirects to /home; a failed one redirects back to
    // /user/login. fetch follows redirects transparently, so the final
    // response's own URL is the simplest available success signal here.
    const ok = authRes.ok && !authRes.url.includes('/user/login');
    await setSessionEstablished(ok);
    return ok;
  } catch {
    await setSessionEstablished(false);
    return false;
  }
}
