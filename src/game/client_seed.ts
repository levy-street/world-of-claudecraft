const SEED_KEY = 'woc_seed';

let cached: string | null = null;

function mint(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the non-crypto path */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getClientSeed(): string {
  if (cached !== null) return cached;
  try {
    const existing = localStorage.getItem(SEED_KEY);
    if (existing) {
      cached = existing;
      return cached;
    }
    const fresh = mint();
    localStorage.setItem(SEED_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    cached = mint();
    return cached;
  }
}
