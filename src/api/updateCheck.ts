// No expo-constants dependency (would mean a new native dependency and a
// rebuild) — the version is just a plain constant here, kept in sync by
// hand with app.json's "version" field and the actual GitHub release tag
// each time a new one is published. A small manual step, but avoids adding
// a whole new native dependency for something this simple.
export const APP_VERSION = '1.1.0';

const REPO = 'Punyesh/sakugaEnhancerApp';

export interface UpdateInfo {
  version: string;
  url: string;
}

function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/i, '');
  const [major, minor, patch] = clean.split('.').map((n) => parseInt(n, 10) || 0);
  return [major, minor, patch];
}

function isNewer(remote: string, local: string): boolean {
  const [rMaj, rMin, rPat] = parseSemver(remote);
  const [lMaj, lMin, lPat] = parseSemver(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

/** Checks GitHub's public Releases API for a newer version than what's
 * currently running. Returns null if already up to date, or if the check
 * fails for any reason (offline, rate-limited, etc.) — this is a
 * nice-to-have, never worth surfacing an error over. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!res.ok) return null;
    const data = await res.json();
    const tag: string = data.tag_name || '';
    const url: string = data.html_url || `https://github.com/${REPO}/releases/latest`;
    if (tag && isNewer(tag, APP_VERSION)) {
      return { version: tag, url };
    }
    return null;
  } catch {
    return null;
  }
}
