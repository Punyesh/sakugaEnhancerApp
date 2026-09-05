import AsyncStorage from '@react-native-async-storage/async-storage';

// Tracks whether establishSession (auth.ts) has ever actually succeeded —
// used by fetchServerVote (sakugabooru.ts) to avoid a real ambiguity: an
// anonymous, logged-out page load and a genuinely-logged-in page load where
// you truly haven't voted can both show an empty `votes` object for a given
// post. Without this flag, fetchServerVote can't tell those two situations
// apart, and would misread "we were never actually logged in" as "confirmed:
// zero stars" — silently overwriting a correct local rating with nothing on
// every reopen. Kept in its own file (not auth.ts or sakugabooru.ts
// directly) purely so both can import it without an import cycle, since
// auth.ts already depends on sakugabooru.ts for BASE_URL.
const KEY = 'sk-session-established';

export async function getSessionEstablished(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setSessionEstablished(established: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, established ? '1' : '0');
  } catch {
    // non-fatal — worst case fetchServerVote just stays cautious next time too
  }
}
