import AsyncStorage from '@react-native-async-storage/async-storage';

// Tracks which posts this device has rated via the app, and what rating was
// given (1-3 stars). The vote button's own "voted" state used to be plain
// component state that reset on every app restart / re-visit, showing the
// rating option again as if nothing happened. There's no confirmed
// server-side "what did I rate this" check to fall back on — the site
// renders that state straight into its own post-page HTML rather than
// exposing it via a separate request — so this is a client-side memory of
// *this device's own* successful ratings, not a true source of truth: rating
// via the site directly, another device, etc. won't be reflected here until
// rated through the app at least once.
const KEY = 'sk-voted-posts';

// Every open used to re-read and re-parse the whole ratings blob from
// AsyncStorage from scratch — real I/O plus JSON.parse, competing with
// everything else ViewerScreen does at mount (video setup, tag/comment
// fetches), which is almost certainly why the star row visibly took the
// better part of a second to settle even for the fast, purely-local guess.
// Caching in memory after the first read means every open after the very
// first one in a session resolves synchronously, no I/O at all.
let cachedMap: Record<number, number> | null = null;
let loadPromise: Promise<Record<number, number>> | null = null;

async function readAll(): Promise<Record<number, number>> {
  if (cachedMap) return cachedMap;
  if (loadPromise) return loadPromise; // a second call landing mid-load reuses the same in-flight read instead of starting another
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) {
        cachedMap = {};
      } else {
        const parsed = JSON.parse(raw);
        // migrate the old boolean-array-of-ids shape from before star ratings existed —
        // every vote under that scheme really did always send a hardcoded score of 1,
        // so mapping old entries to a 1-star rating is the accurate historical value,
        // not just a placeholder.
        if (Array.isArray(parsed)) {
          const migrated: Record<number, number> = {};
          parsed.forEach((id: number) => { migrated[id] = 1; });
          cachedMap = migrated;
        } else {
          cachedMap = parsed || {};
        }
      }
    } catch {
      cachedMap = {};
    }
    loadPromise = null;
    return cachedMap!;
  })();
  return loadPromise;
}

async function writeAll(map: Record<number, number>): Promise<void> {
  cachedMap = map; // keep the in-memory copy authoritative immediately, don't wait on the write
  await AsyncStorage.setItem(KEY, JSON.stringify(map)).catch(() => {
    // Non-fatal — worst case the reminder just doesn't persist.
  });
}

export async function getVoteRating(postId: number): Promise<number | null> {
  const map = await readAll();
  return map[postId] || null;
}

export async function setVoteRating(postId: number, stars: number): Promise<void> {
  const map = await readAll();
  map[postId] = stars;
  const keys = Object.keys(map);
  if (keys.length > 2000) {
    // keep this from growing forever — drop the oldest-inserted entries
    const toDrop = keys.length - 2000;
    for (let i = 0; i < toDrop; i++) delete map[Number(keys[i])];
  }
  await writeAll(map);
}
