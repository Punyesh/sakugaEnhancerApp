import AsyncStorage from '@react-native-async-storage/async-storage';
import { Post } from './sakugabooru';

// Entirely on-device — no server interaction at all, since real pool
// creation turned out to require an account status most users (even brand
// new accounts) don't have. Posts are stored as full snapshots at the time
// they're added (score etc. won't stay live-updated), same tradeoff as any
// local bookmark/save feature.
export interface LocalPool {
  id: string;
  name: string;
  description: string;
  posts: Post[];
  createdAt: number;
}

const KEY = 'sk-local-pools-v1';

async function readAll(): Promise<LocalPool[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeAll(pools: LocalPool[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(pools)).catch(() => {
    // Non-fatal — worst case a save doesn't persist, not worth surfacing an error for.
  });
}

export async function getLocalPools(): Promise<LocalPool[]> {
  return readAll();
}

export async function getLocalPool(id: string): Promise<LocalPool | null> {
  const pools = await readAll();
  return pools.find((p) => p.id === id) || null;
}

export async function createLocalPool(name: string, description: string): Promise<LocalPool> {
  const pools = await readAll();
  const pool: LocalPool = { id: String(Date.now()), name, description, posts: [], createdAt: Date.now() };
  pools.unshift(pool);
  await writeAll(pools);
  return pool;
}

export async function deleteLocalPool(id: string): Promise<void> {
  const pools = await readAll();
  await writeAll(pools.filter((p) => p.id !== id));
}

export async function addPostToLocalPool(poolId: string, post: Post): Promise<void> {
  const pools = await readAll();
  const pool = pools.find((p) => p.id === poolId);
  if (pool && !pool.posts.some((p) => p.id === post.id)) {
    pool.posts.unshift(post);
    await writeAll(pools);
  }
}

export async function removePostFromLocalPool(poolId: string, postId: number): Promise<void> {
  const pools = await readAll();
  const pool = pools.find((p) => p.id === poolId);
  if (pool) {
    pool.posts = pool.posts.filter((p) => p.id !== postId);
    await writeAll(pools);
  }
}
