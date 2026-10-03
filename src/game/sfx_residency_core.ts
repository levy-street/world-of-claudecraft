// Which decoded SFX clips the iOS memory profile may drop, in what order, and
// under which byte budget. Pure: sfx.ts owns the buffers and the audio graph and
// is the thin consumer.
//
// iPhone WebKit kills the WebContent process at a fixed footprint, and decoded
// PCM was never released, so every ambience bed and mount take the player ever
// heard stayed resident. Only clips a player never reacts to may go: an evicted
// clip re-decodes on its next play, which delays that one play. The budget
// bounds those cosmetic clips alone: pinned clips never count toward it, so
// however much pinned PCM piles up, cosmetic clips keep their own room and a
// replayed one is not re-decoded every time.

import type { SfxEntry } from './sfx_manifest.generated';

/** Decoded cosmetic clip PCM (the evictable set below) kept on the iOS memory
 *  profile before the least recently played idle one is dropped. On a tour of
 *  every town the live cosmetic set peaked at 15.2 MiB (two biomes' beds plus
 *  the campfire and forge, crossfading at a zone change) out of 28.4 MiB seen.
 *  20 MiB also fits the heaviest mount's two engine loops (4.2 MiB), so a scene
 *  never pushes out its own live clips; what goes is what earlier zones left. */
export const SFX_IOS_COSMETIC_BUDGET_BYTES = 20 * 1024 * 1024;

/** Manifest categories that carry nothing a player acts on. */
export const SFX_EVICTABLE_CATEGORIES: ReadonlySet<string> = new Set(['ambience', 'movement']);

/** The mount take family (summon, gait, engine, idle, calls, jump and land),
 *  resolved by sfx.ts from this prefix, inside the catch-all 'other' category.
 *  Every other clip there (rift hazards, hoard mechanics, spells, quest and
 *  lockpick alerts) stays pinned. */
const EVICTABLE_OTHER_PREFIX = 'mount_';

export function isSfxClipEvictable(
  key: string,
  entry: Pick<SfxEntry, 'category'> | undefined,
): boolean {
  if (!entry) return false;
  if (SFX_EVICTABLE_CATEGORIES.has(entry.category)) return true;
  return entry.category === 'other' && key.startsWith(EVICTABLE_OTHER_PREFIX);
}

/** Decoded size of an AudioBuffer: one float32 per sample per channel. */
export function audioBufferBytes(buffer: { length: number; numberOfChannels: number }): number {
  const bytes = buffer.length * buffer.numberOfChannels * 4;
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

interface CosmeticClip {
  bytes: number;
  /** Live sources playing or looping this clip. */
  sources: number;
}

/** Least-recently-played ledger over decoded COSMETIC clips, keyed by the
 *  engine's per-variant cache key. Pinned clips are never recorded, so they
 *  neither count toward the budget nor get dropped. Map order is recency:
 *  oldest first. */
export class SfxResidencyLedger {
  private readonly clips = new Map<string, CosmeticClip>();
  private bytes = 0;

  constructor(readonly budgetBytes: number) {}

  /** Decoded bytes of the cosmetic clips currently held. */
  get cosmeticBytes(): number {
    return this.bytes;
  }

  /** A decoded clip joins as the most recently used; a pinned one is ignored. */
  record(cacheKey: string, bytes: number, evictable: boolean): void {
    if (!evictable) return;
    const prior = this.clips.get(cacheKey);
    if (prior) {
      this.bytes -= prior.bytes;
      this.clips.delete(cacheKey);
    }
    this.clips.set(cacheKey, { bytes, sources: prior?.sources ?? 0 });
    this.bytes += bytes;
  }

  /** A source starts on the clip: most recently used, and held until released. */
  acquire(cacheKey: string): void {
    const clip = this.clips.get(cacheKey);
    if (!clip) return;
    this.clips.delete(cacheKey);
    clip.sources++;
    this.clips.set(cacheKey, clip);
  }

  release(cacheKey: string): void {
    const clip = this.clips.get(cacheKey);
    if (clip && clip.sources > 0) clip.sources--;
  }

  /** Forget least recently used idle cosmetic clips until they fit the budget,
   *  skipping any the owner still `held` (a pending play or load). Returns the
   *  cache keys the owner must drop. */
  evict(held: (cacheKey: string) => boolean = () => false): string[] {
    const dropped: string[] = [];
    for (const [cacheKey, clip] of this.clips) {
      if (this.bytes <= this.budgetBytes) break;
      if (clip.sources > 0 || held(cacheKey)) continue;
      this.clips.delete(cacheKey);
      this.bytes -= clip.bytes;
      dropped.push(cacheKey);
    }
    return dropped;
  }
}

/** The ledger for this profile, or null where decoded clips stay unbounded
 *  (every host but the iOS memory profile). */
export function sfxResidencyFor(profile: {
  readonly iosMemoryProfile: boolean;
}): SfxResidencyLedger | null {
  return profile.iosMemoryProfile ? new SfxResidencyLedger(SFX_IOS_COSMETIC_BUDGET_BYTES) : null;
}
