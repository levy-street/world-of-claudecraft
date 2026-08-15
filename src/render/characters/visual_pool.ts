// The character-visual reuse pool: the pure pool-key normalization plus a
// bounded, release-ordered (LRU) store. Extracted from renderer.ts so a plain
// Vitest drives the key rules, the bound, the eviction order, and the disposal
// contract directly (tests/character_visual_pool.test.ts); the renderer stays
// a thin consumer.
import type { Entity } from '../../sim/types';
import { shouldRetainPooledCharacterVisual } from './visual_pool_policy';

/** The one surface the pool needs from a pooled visual. Kept minimal (and
 *  Three-free) so tests exercise the pool with plain stubs. */
export interface PoolableVisual {
  dispose(): void;
}

/**
 * The normalized reuse-pool key for an entity's character visual, or null for
 * a kind that never pools. Players are deliberately excluded (their visual key
 * varies with cosmetics/mech state; diagnosis item A6, not handled here).
 *
 * The key is the entity's TEMPLATE identity only. Per-instance presentation
 * attributes stay OUT of the key on purpose:
 * - `color` and `scale` are instance attributes. Rift spawns re-grade both per
 *   instance (src/sim/rift/runs.ts: a deterministic sim-rng jitter stored on
 *   the entity, so it reaches every host identically over the wire). A key
 *   carrying them can never match a future request, so every despawned rift
 *   mob minted a dead pool entry that sat retained until profile reset (the
 *   C1 memory ratchet). Scale is applied at the view group
 *   (group.scale.setScalar(e.scale)) and color at acquire time
 *   (CharacterVisual.setEntityColor), so pooled reuse renders identically.
 * - NPC `skin` STAYS in the key: it picks a texture atlas at construction and
 *   the per-frame diff only reacts to live changes, so a cross-skin reuse
 *   would keep the wrong atlas. The skin set is small and static, so keys
 *   stay bounded.
 */
export function characterVisualPoolKey(
  e: Pick<Entity, 'kind' | 'templateId' | 'skin'>,
): string | null {
  if (e.kind === 'mob') return `mob:${e.templateId}`;
  if (e.kind === 'npc') return `npc:${e.templateId}:${e.skin}`;
  return null;
}

interface PoolEntry<V> {
  key: string;
  visual: V;
}

/**
 * Release-ordered bounded pool: entries[0] is the least-recently-released
 * visual. `store` evicts (and DISPOSES) least-recently-released entries until
 * the incoming visual fits, so the pool can never grow past the cap while the
 * hottest working set stays resident. Eviction only ever touches detached,
 * off-screen visuals (the renderer removes a visual from the scene before
 * storing it), and an evicted key simply misses on its next request and
 * rebuilds from the live entity: eviction is invisible on screen.
 *
 * Linear scans are fine at pool scale (the cap is
 * GFX.maxPooledCharacterVisuals, low hundreds at most): take/store run on
 * entity stream-in/out, not per frame per entity.
 */
export class CharacterVisualPool<V extends PoolableVisual> {
  private entries: PoolEntry<V>[] = [];

  get size(): number {
    return this.entries.length;
  }

  /** The most-recently-released visual pooled under `key`, or null on a miss. */
  take(key: string): V | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].key === key) {
        const [entry] = this.entries.splice(i, 1);
        return entry.visual;
      }
    }
    return null;
  }

  /**
   * Pool `visual` under `key`, evicting and disposing least-recently-released
   * entries until the pool respects `maxEntries` (the live GFX cap, passed per
   * call so a profile change applies immediately). An invalid or non-positive
   * cap disposes the incoming visual instead of pooling it (fail closed,
   * matching shouldRetainPooledCharacterVisual). Returns how many visuals were
   * disposed.
   */
  store(key: string, visual: V, maxEntries: number): number {
    if (!shouldRetainPooledCharacterVisual(0, maxEntries)) {
      visual.dispose();
      return 1;
    }
    let disposed = 0;
    while (!shouldRetainPooledCharacterVisual(this.entries.length, maxEntries)) {
      const oldest = this.entries.shift();
      if (!oldest) break;
      oldest.visual.dispose();
      disposed++;
    }
    this.entries.push({ key, visual });
    return disposed;
  }

  /** Empty the pool and hand every visual back (release order preserved).
   *  Disposal stays with the caller: the renderer's terminal teardown wraps
   *  each dispose in its best-effort guard. */
  drain(): V[] {
    const drained = this.entries.map((entry) => entry.visual);
    this.entries = [];
    return drained;
  }
}
