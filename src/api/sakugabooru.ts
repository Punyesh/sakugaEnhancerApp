/**
 * sakugabooru API client.
 *
 * This ports over what we actually learned building the browser bookmarklet
 * version of this tool — most of that pain was browser-specific and doesn't
 * apply here (no CORS to dodge outside a browser; no Prototype.js polluting
 * Array.prototype since this JS runtime is fully isolated from the site's own
 * page scripts, so plain .filter()/.map()/.sort() are safe again). But some
 * lessons are about the SERVER, not the browser, and those still apply:
 *
 * - `/tag.json`'s `name_pattern` parameter is a confirmed no-op on this fork —
 *   verified by testing multiple wildcard syntaxes ('*x*', '%x%', plain 'x')
 *   and getting byte-identical results regardless of the pattern. Don't use it.
 * - `limit=0` ("return every tag") also doesn't work as documented — it
 *   silently returns some small default set instead of everything.
 *
 * So: tag/show substring search still works by fetching the ENTIRE tag
 * dictionary ourselves via real pagination, then filtering client-side.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const TAG_CACHE_KEY = 'sk-tagdict-v1';
const TAG_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours, matching the bookmarklet's localStorage cache

const BASE_URL = 'https://www.sakugabooru.com';

export interface Post {
  id: number;
  tags: string;
  author: string;
  source: string;
  score: number;
  rating: string;
  file_url: string;
  file_ext?: string;
  jpeg_url?: string;
  preview_url?: string;
  sample_url?: string;
  width: number;
  height: number;
  created_at: number; // unix seconds
  parent_id?: number;
  has_children?: boolean;
}

export interface Tag {
  id: number;
  name: string;
  count: number;
  type: number; // 0 general, 1 artist, 3 copyright, 4 character, 5+ seen but undocumented
  ambiguous: boolean;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(BASE_URL + path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- posts ----------

export function searchPosts(tags: string[], order: 'score' | 'date' | 'random', limit = 24, page = 1) {
  const tagQuery = [...tags, `order:${order}`].join(' ').trim();
  return getJSON<Post[]>(`/post.json?limit=${limit}&page=${page}&tags=${encodeURIComponent(tagQuery)}`);
}

export function isVideoFile(url: string) {
  return /\.(webm|mp4|mov)(\?|$)/i.test(url || '');
}

// ---------- full tag dictionary ----------
// Fetched once per app session and cached in memory (a real persistent cache —
// e.g. AsyncStorage with a TTL, mirroring the bookmarklet's localStorage
// approach — is a good next step once this is working end-to-end).

let allTagsCache: Tag[] | null = null;
let allTagsLoading: Promise<Tag[]> | null = null;

async function fetchAllTagsPaged(onProgress?: (n: number) => void): Promise<Tag[]> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 150; // politeness/sanity cap — unconfirmed real per-page size
  const CONCURRENCY = 5;
  let all: Tag[] = [];
  let nextPage = 1;

  async function fetchOne(page: number) {
    const batch = await getJSON<Tag[]>(`/tag.json?limit=${PAGE_SIZE}&page=${page}&order=name`);
    if (!Array.isArray(batch)) throw new Error('unexpected /tag.json response shape');
    return batch;
  }

  while (nextPage <= MAX_PAGES) {
    const pages: number[] = [];
    for (let i = 0; i < CONCURRENCY && nextPage <= MAX_PAGES; i++) {
      pages.push(nextPage);
      nextPage++;
    }
    const batches = await Promise.all(pages.map(fetchOne));
    let reachedEnd = false;
    for (const batch of batches) {
      all = all.concat(batch);
      if (batch.length === 0) reachedEnd = true;
    }
    onProgress?.(all.length);
    if (reachedEnd) break;
    await sleep(80); // brief pause between batches, not between individual requests
  }
  return all;
}

// A real tag name (like "fighting") should never contain a URL, whitespace,
// or be absurdly long — any of those is a strong signal of corrupted data
// (e.g. a URL somehow getting spliced into the middle of a real tag name),
// not a legitimate tag. Filtering this at load time means one bad cached
// entry can't linger indefinitely or show up as a garbled search suggestion.
function isValidTagName(name: string): boolean {
  if (!name || name.length > 100) return false;
  if (/https?:\/\//i.test(name)) return false;
  if (/\s/.test(name)) return false;
  return true;
}

async function readTagCache(): Promise<Tag[] | null> {
  try {
    const raw = await AsyncStorage.getItem(TAG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tags: Tag[]; savedAt: number };
    if (Date.now() - parsed.savedAt > TAG_CACHE_TTL_MS) return null; // stale, refetch
    const clean = parsed.tags.filter((t) => isValidTagName(t.name));
    if (clean.length !== parsed.tags.length) {
      writeTagCache(clean); // persist the cleaned version so this doesn't need re-filtering every load
    }
    return clean;
  } catch {
    return null; // corrupt or missing — just refetch, not worth surfacing an error for
  }
}

function writeTagCache(tags: Tag[]) {
  AsyncStorage.setItem(TAG_CACHE_KEY, JSON.stringify({ tags, savedAt: Date.now() })).catch(() => {
    // Non-fatal — worst case, next app launch just refetches instead of
    // using a persisted cache. Not worth surfacing to the user.
  });
}

export function ensureAllTags(onProgress?: (n: number) => void): Promise<Tag[]> {
  if (allTagsCache) return Promise.resolve(allTagsCache);
  if (allTagsLoading) return allTagsLoading;
  allTagsLoading = readTagCache()
    .then((cached) => {
      if (cached) {
        allTagsCache = cached;
        return cached;
      }
      return fetchAllTagsPaged(onProgress).then((tags) => {
        const clean = tags.filter((t) => isValidTagName(t.name));
        allTagsCache = clean;
        writeTagCache(clean);
        return clean;
      });
    })
    .catch((err) => {
      allTagsLoading = null; // allow retrying instead of sticking forever on a transient failure
      throw err;
    });
  return allTagsLoading;
}

/** Client-side substring search against the full tag dictionary, since the
 * server's own `name_pattern` doesn't work. Optionally restrict to a tag type
 * (3 = show/copyright tags, useful for the Shows search). */
export async function searchTags(query: string, type?: number, limit = 15): Promise<Tag[]> {
  const norm = query.trim().toLowerCase().replace(/\s+/g, '_');
  const all = await ensureAllTags();
  const matchesType = (t: Tag) => type === undefined || t.type === type;

  let direct = all.filter((t) => matchesType(t) && t.name.includes(norm));
  if (direct.length === 0) {
    // Multi-word query rarely matches one contiguous tag name — try each word.
    const words = norm.split('_').filter((w) => w.length >= 3);
    const seen = new Set<string>();
    direct = [];
    for (const w of words) {
      for (const t of all) {
        if (matchesType(t) && t.name.includes(w) && !seen.has(t.name)) {
          seen.add(t.name);
          direct.push(t);
        }
      }
    }
  }
  return direct.sort((a, b) => b.count - a.count).slice(0, limit);
}

/** Get a tag's exact `type` (1 = artist), for marking animator tags in results. */
export async function getTagTypeMap(): Promise<Record<string, number>> {
  const all = await ensureAllTags();
  const map: Record<string, number> = {};
  for (const t of all) map[t.name] = t.type;
  return map;
}

// ---------- artist stats ----------

const MAX_STATS_PAGES = 5; // politeness cap: up to 500 posts per animator
const STATS_PAGE_DELAY = 350;

export async function fetchArtistPosts(tagName: string): Promise<Post[]> {
  let all: Post[] = [];
  let page = 1;
  while (page <= MAX_STATS_PAGES) {
    const batch = await getJSON<Post[]>(
      `/post.json?limit=100&page=${page}&tags=${encodeURIComponent(tagName)}`
    );
    all = all.concat(batch);
    if (batch.length < 100) break;
    page++;
    if (page <= MAX_STATS_PAGES) await sleep(STATS_PAGE_DELAY);
  }
  return all;
}

export interface ArtistStats {
  total: number;
  avgScore: number;
  yearCounts: Record<string, number>;
  topTags: { tag: string; count: number }[];
}

export function computeArtistStats(tagName: string, posts: Post[]): ArtistStats {
  const tagFreq: Record<string, number> = {};
  const yearCounts: Record<string, number> = {};
  let scoreSum = 0;

  for (const p of posts) {
    scoreSum += p.score || 0;
    for (const t of (p.tags || '').split(/\s+/)) {
      if (!t || t === tagName) continue;
      tagFreq[t] = (tagFreq[t] || 0) + 1;
    }
    if (p.created_at) {
      const year = String(new Date(p.created_at * 1000).getFullYear());
      yearCounts[year] = (yearCounts[year] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    total: posts.length,
    avgScore: posts.length ? scoreSum / posts.length : 0,
    yearCounts,
    topTags,
  };
}

// ---------- episode/source parsing (for Shows) ----------
// Best-effort text parse of the free-text `source` field — there's no
// structured episode data in the API. See parseEpisodeKey in the bookmarklet
// for the original reasoning; ported as-is here.

export interface EpisodeKey {
  key: string;
  label: string;
  sortNum: number;
  token: string | null;
}

export function parseEpisodeKey(source: string | undefined): EpisodeKey {
  const s = (source || '').trim();
  if (!s) return { key: 'unsorted', label: 'No source listed', sortNum: 1e9, token: null };

  let m = s.match(/#\s?(\d{1,4})/);
  if (m) return { key: `ep:${+m[1]}`, label: `Episode ${+m[1]}`, sortNum: +m[1], token: `#${m[1]}` };

  m = s.match(/\bep(?:isode)?\.?\s?(\d{1,4})\b/i);
  if (m) return { key: `ep:${+m[1]}`, label: `Episode ${+m[1]}`, sortNum: +m[1], token: `#${m[1]}` };

  if (/\bmovie\b/i.test(s)) return { key: 'movie', label: 'Movie', sortNum: 1e6 + 1, token: 'movie' };
  if (/\bova\b/i.test(s)) return { key: 'ova', label: 'OVA', sortNum: 1e6 + 2, token: 'OVA' };
  if (/\b(opening|op\d*)\b/i.test(s)) return { key: 'op', label: 'Opening', sortNum: 1e6 + 3, token: 'OP' };
  if (/\b(ending|ed\d*)\b/i.test(s)) return { key: 'ed', label: 'Ending', sortNum: 1e6 + 4, token: 'ED' };
  if (/\b(pv|trailer)\b/i.test(s)) return { key: 'pv', label: 'PV / Trailer', sortNum: 1e6 + 5, token: 'PV' };

  return { key: 'other', label: 'Other / uncategorized', sortNum: 1e6 + 6, token: null };
}

/** Given a numeric episode, build search candidates trying realistic source-text
 * formats in order — a confirmed real case ("#0357") matched neither "#357" nor
 * bare "357" when queried directly, so multiple paddings are worth trying. */
export function buildEpisodeCandidates(num: number, observedToken?: string | null): string[] {
  const plain = String(num);
  const pad3 = plain.length < 3 ? plain.padStart(3, '0') : plain;
  const pad4 = plain.length < 4 ? plain.padStart(4, '0') : plain;
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (tok: string | null | undefined) => {
    if (tok && !seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  };
  add(observedToken);
  for (const r of [plain, pad3, pad4]) {
    add(`#${r}`);
    add(r);
  }
  return out;
}

// ---------- show/episode fetching ----------

export interface EpisodeGroup extends EpisodeKey {
  count: number;
  posts: Post[];
}

export interface ShowEntry {
  totalSampled: number;
  related: { name: string; count: number }[];
  episodes: EpisodeGroup[];
  posts: Post[];
  pagesFetched: number;
  exhausted: boolean;
}

const SHOW_SAMPLE_PAGES = 3; // politeness cap: 300 posts initially, same as the bookmarklet
const SHOW_PAGE_DELAY = 350;
const showCache: Record<string, ShowEntry> = {};

async function fetchRelatedTags(showTag: string): Promise<{ name: string; count: number }[]> {
  // Moebooru's related-tag endpoint shape isn't something we independently
  // reverified for this app the way most of the rest of this client was — the
  // bookmarklet confirmed its actual shape through live testing, but that
  // exact verification wasn't redone here. This defensively handles a couple
  // of plausible shapes; if related titles come back empty or wrong, this is
  // the first place to check against the real response.
  try {
    const raw: any = await getJSON(`/tag/related.json?tags=${encodeURIComponent(showTag)}&type=copyright`);
    const list: [string, number][] = Array.isArray(raw?.tags) ? raw.tags : Array.isArray(raw) ? raw : [];
    return list
      .filter((entry) => Array.isArray(entry) && entry[0] !== showTag)
      .map(([name, count]) => ({ name, count: Number(count) || 0 }));
  } catch {
    return [];
  }
}

/** Fetches (and incrementally extends) a show's sampled posts, grouped into
 * episodes. Pass a higher targetPages than what's cached to sample deeper —
 * used for the "scan further back" action once the initial sample doesn't
 * cover an episode someone's looking for. */
export async function getShowEntry(showTag: string, targetPages = SHOW_SAMPLE_PAGES): Promise<ShowEntry> {
  const cached = showCache[showTag];
  if (cached && (cached.pagesFetched >= targetPages || cached.exhausted)) return cached;

  const startPage = cached ? cached.pagesFetched + 1 : 1;
  const priorPosts = cached ? cached.posts : [];
  const relatedPromise = cached ? Promise.resolve(cached.related) : fetchRelatedTags(showTag);

  let newPosts: Post[] = [];
  let reachedEnd = false;
  for (let page = startPage; page <= targetPages; page++) {
    const batch = await getJSON<Post[]>(
      `/post.json?limit=100&page=${page}&tags=${encodeURIComponent(showTag)}+order:date`
    );
    newPosts = newPosts.concat(batch);
    if (batch.length < 100) {
      reachedEnd = true;
      break;
    }
    if (page < targetPages) await sleep(SHOW_PAGE_DELAY);
  }

  const related = await relatedPromise;
  const allPosts = priorPosts.concat(newPosts);
  const groups: Record<string, EpisodeGroup> = {};
  for (const p of allPosts) {
    const g = parseEpisodeKey(p.source);
    if (!groups[g.key]) groups[g.key] = { ...g, count: 0, posts: [] };
    groups[g.key].count++;
    groups[g.key].posts.push(p);
  }
  const episodes = Object.values(groups).sort((a, b) => a.sortNum - b.sortNum);

  const entry: ShowEntry = {
    totalSampled: allPosts.length,
    related,
    episodes,
    posts: allPosts,
    pagesFetched: targetPages,
    exhausted: reachedEnd,
  };
  showCache[showTag] = entry;
  return entry;
}

// ---------- comments ----------

export interface Comment {
  id: number;
  creator?: string;
  creator_id?: number;
  body?: string;
  comment?: string;
  created_at?: number | string;
}

export function fetchComments(postId: number): Promise<Comment[]> {
  return getJSON<any>(`/comment.json?post_id=${postId}`).then((raw) => (Array.isArray(raw) ? raw : []));
}

/** Comment dates turned out not to reliably be plain unix-seconds the way
 * post.created_at is — a real case returned "Invalid Date" when assumed to
 * be seconds. This tries a few plausible formats and just omits the date
 * entirely rather than showing something visibly wrong if none of them parse. */
export function formatCommentDate(raw: number | string | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '';
  let d: Date;
  if (typeof raw === 'number') {
    d = new Date(raw * 1000); // most likely: unix seconds, matching post.json
    if (isNaN(d.getTime())) d = new Date(raw); // fallback: maybe already milliseconds
  } else {
    d = new Date(raw); // fallback: maybe an ISO date string instead of a number
  }
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/** Fetches one specific post by ID — reuses the same /post.json endpoint
 * everything else already relies on (via an id: filter) rather than
 * guessing at a possibly-different single-post endpoint format. Used for
 * opening sakugabooru post links from comments inside the app itself. */
export async function getPostById(id: number): Promise<Post | null> {
  const posts = await getJSON<Post[]>(`/post.json?tags=${encodeURIComponent('id:' + id)}&limit=1`);
  return posts[0] || null;
}

// ---------- posting comments ----------
// Built against the standard Moebooru/Danbooru-v1 convention this fork's own
// docs confirm compatibility with (nested comment[...] params, login +
// password_hash for auth) — unlike almost everything else in this file, the
// exact endpoint/parameter names here haven't been confirmed against a real
// live request, only against documented convention. Worth double-checking
// against the real response the first time this actually runs.
interface CommentPostResponse {
  success: boolean;
  reason?: string;
}

async function postCommentRaw(postId: number, body: string, username: string, passwordHash: string): Promise<CommentPostResponse> {
  const params = new URLSearchParams();
  params.set('login', username);
  params.set('password_hash', passwordHash);
  params.set('comment[post_id]', String(postId));
  params.set('comment[body]', body);

  const res = await fetch(`${BASE_URL}/comment/create.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON response — fall through to the generic HTTP-status-based result below.
  }

  if (res.ok && (!parsed || parsed.success !== false)) {
    return { success: true };
  }
  return { success: false, reason: (parsed && parsed.reason) || `HTTP ${res.status}: ${text.slice(0, 200)}` };
}

// Upvote-only, scoped conservatively — confirmed the endpoint exists directly
// from sakugabooru's own /help/api page ("The base URL is /post/vote.xml"),
// but unlike comment-posting, the exact parameter format here isn't backed
// by the same level of documentation — built against the general
// Danbooru-family convention (post_vote(post_id, score)) as the
// best-reasoned guess, genuinely worth confirming with a real test.
export async function voteUp(postId: number, username: string, passwordHash: string): Promise<void> {
  const params = new URLSearchParams();
  params.set('login', username);
  params.set('password_hash', passwordHash);
  params.set('id', String(postId));
  params.set('score', '1');

  const res = await fetch(`${BASE_URL}/post/vote.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON response — fall through to the generic HTTP-status-based check below.
  }
  if (!res.ok || (parsed && parsed.success === false)) {
    throw new Error((parsed && parsed.reason) || `failed to vote (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function postComment(postId: number, body: string, username: string, passwordHash: string): Promise<void> {
  const result = await postCommentRaw(postId, body, username, passwordHash);
  if (!result.success) throw new Error(result.reason || 'failed to post comment');
}

/** Verifies credentials against the real server WITHOUT posting a visible
 * comment — attempts one on a deliberately out-of-range post id (well past
 * the site's actual highest post id, confirmed via public post-count data
 * to not exist). A confirmed real response shape from this exact endpoint
 * is `{"success":false,"reason":"access denied"}` for bad credentials —
 * any OTHER failure reason means auth itself succeeded and the failure is
 * just that this post obviously doesn't exist. */
export async function verifyLogin(username: string, passwordHash: string): Promise<boolean> {
  const result = await postCommentRaw(999999999, '(login verification — safe to ignore if visible)', username, passwordHash);
  if (result.success) return true; // shouldn't happen given the bogus post id, but a real success is still a success
  const reason = (result.reason || '').toLowerCase();
  return !reason.includes('denied');
}

// ---------- playlists (pools) ----------
// Confirmed directly from sakugabooru's own /help/pools page and the
// standard Danbooru/Moebooru pool API convention: pools support a real
// pool[is_public] flag (1 or 0) at creation, so private and public
// playlists are both genuinely the same underlying mechanism, not two
// separate systems. Unlike comments/voting, the exact response shape for
// listing/fetching pool metadata isn't backed by the same level of
// documentation — built against the general REST convention this same
// codebase uses elsewhere (confirmed for /tag.json), worth confirming live.
export interface Pool {
  id: number;
  name: string;
  description: string;
  is_public: boolean;
  post_count: number;
  user_id?: number;
  created_at?: string;
  updated_at?: string;
}

interface PoolActionResponse {
  success: boolean;
  reason?: string;
}

async function poolAction(path: string, params: URLSearchParams): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON response — fall through to the generic HTTP-status-based check below.
  }
  if (!res.ok || (parsed && parsed.success === false)) {
    throw new Error((parsed && parsed.reason) || `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return parsed;
}

export async function createPool(
  name: string,
  isPublic: boolean,
  description: string,
  username: string,
  passwordHash: string
): Promise<Pool> {
  const params = new URLSearchParams();
  params.set('login', username);
  params.set('password_hash', passwordHash);
  params.set('pool[name]', name);
  params.set('pool[is_public]', isPublic ? '1' : '0');
  params.set('pool[description]', description);
  const result = await poolAction('/pool/create.json', params);
  await addMyPoolId(result.id);
  return result as Pool;
}

export async function addPostToPool(poolId: number, postId: number, username: string, passwordHash: string): Promise<void> {
  const params = new URLSearchParams();
  params.set('login', username);
  params.set('password_hash', passwordHash);
  params.set('pool_id', String(poolId));
  params.set('post_id', String(postId));
  await poolAction('/pool/add_post.json', params);
}

export async function removePostFromPool(poolId: number, postId: number, username: string, passwordHash: string): Promise<void> {
  const params = new URLSearchParams();
  params.set('login', username);
  params.set('password_hash', passwordHash);
  params.set('pool_id', String(poolId));
  params.set('post_id', String(postId));
  await poolAction('/pool/remove_post.json', params);
}

export async function destroyPool(poolId: number, username: string, passwordHash: string): Promise<void> {
  const params = new URLSearchParams();
  params.set('login', username);
  params.set('password_hash', passwordHash);
  params.set('id', String(poolId));
  await poolAction('/pool/destroy.json', params);
  await removeMyPoolId(poolId);
}

/** Searches public pools by name (the site's own "Search Pools" feature). */
export async function searchPools(query: string): Promise<Pool[]> {
  return getJSON<Pool[]>(`/pool.json?query=${encodeURIComponent(query)}`);
}

/** All pools, most-recently-updated first — for browsing without needing to
 * already know a name to search for. */
export async function listPools(page = 1): Promise<Pool[]> {
  return getJSON<Pool[]>(`/pool.json?page=${page}`);
}

/** Confirmed directly from sakugabooru's own /help/api page: "/pool.xml" is
 * the list-all endpoint, while "/pool/show.xml" is the dedicated single-pool
 * lookup — genuinely different endpoints, not the same one with a filter
 * param. The response shape for /pool/show specifically isn't confirmed
 * (could be a single object or a one-item array), so this handles both. */
export async function getPool(poolId: number): Promise<Pool | null> {
  const result = await getJSON<Pool | Pool[]>(`/pool/show.json?id=${poolId}`);
  if (Array.isArray(result)) return result[0] || null;
  return result || null;
}

/** A pool's posts, via the standard pool:ID tag search syntax on the same
 * post-search endpoint already used everywhere else — reusing proven,
 * already-working infrastructure rather than a separate, untested endpoint. */
export async function getPoolPosts(
  poolId: number,
  order: 'score' | 'date' | 'random' = 'date',
  limit = 100,
  page = 1
): Promise<Post[]> {
  return searchPosts([`pool:${poolId}`], order, limit, page);
}

/** A single thumbnail URL for a pool preview — just its first post. */
export async function getPoolPreviewThumb(poolId: number): Promise<string | null> {
  const posts = await getPoolPosts(poolId, 'date', 1, 1);
  return posts[0]?.preview_url || posts[0]?.jpeg_url || posts[0]?.sample_url || null;
}

// ---------- local index of "my" playlists ----------
// Real, server-side pools — this is just an on-device pointer to which ones
// are "mine," sidestepping genuine uncertainty about how (or whether) the
// server's own pool-listing can be filtered by owner, without faking any
// actual playlist data locally.
const MY_POOLS_KEY = 'sk-my-pools-v1';

export async function getMyPoolIds(): Promise<number[]> {
  try {
    const raw = await AsyncStorage.getItem(MY_POOLS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function addMyPoolId(id: number): Promise<void> {
  const ids = await getMyPoolIds();
  if (!ids.includes(id)) {
    ids.push(id);
    await AsyncStorage.setItem(MY_POOLS_KEY, JSON.stringify(ids)).catch(() => {});
  }
}

export async function removeMyPoolId(id: number): Promise<void> {
  const ids = await getMyPoolIds();
  const filtered = ids.filter((x) => x !== id);
  await AsyncStorage.setItem(MY_POOLS_KEY, JSON.stringify(filtered)).catch(() => {});
}

