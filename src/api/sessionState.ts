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

// Read on every single clip open (as the gate inside fetchServerVote,
// before it even starts the network correction fetch) — caching in memory
// after the first read avoids a redundant AsyncStorage round-trip on every
// subsequent open, same reasoning as the ratings cache in voteRatings.ts.
let cached: boolean | null = null;

export async function getSessionEstablished(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    cached = false;
  }
  return cached;
}

export async function setSessionEstablished(established: boolean): Promise<void> {
  cached = established; // keep the in-memory copy authoritative immediately, don't wait on the write
  try {
    await AsyncStorage.setItem(KEY, established ? '1' : '0');
  } catch {
    // non-fatal — worst case fetchServerVote just stays cautious next time too
  }
}
