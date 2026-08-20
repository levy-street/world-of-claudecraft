// The renderer's two halves of character-visual pooling around the pure
// bounded store (visual_pool.ts): what a visual is reset to when it is
// re-acquired for a new entity, and how it is parked when its entity streams
// out. Extracted from renderer.ts so a plain Vitest drives the reacquire
// contract (transform reset, near LOD, no ghost, per-instance re-tint, the
// live compile gate re-installed) with a stub visual, and the renderer stays
// a thin consumer (tests/character_visual_pool.test.ts).
import type * as THREE from 'three';
import type { FarBakeGate } from './visual';
import type { CharacterVisualPool, PoolableVisual } from './visual_pool';

/** The surface these two paths need from a pooled character visual. */
export interface PooledCharacterVisual extends PoolableVisual {
  root: THREE.Object3D;
  setFar(far: boolean): void;
  setGhost(on: boolean): void;
  setEntityColor(color: number): void;
  setFarBakeGate(gate: FarBakeGate | null): void;
}

/** What the renderer supplies, read at call time (the gate is a renderer
 *  field, the cap follows the live graphics settings). */
export interface PooledVisualHost {
  farBakeGate(): FarBakeGate | null;
  maxPooled(): number;
}

function resetPooledRoot(root: THREE.Object3D, visible: boolean): void {
  root.removeFromParent();
  root.visible = visible;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
}

export class PooledVisualLifecycle<V extends PooledCharacterVisual> {
  constructor(
    private readonly pool: CharacterVisualPool<V>,
    private readonly host: PooledVisualHost,
  ) {}

  /** Take a pooled visual for a live entity, or null on a miss (the caller
   *  builds fresh from the entity). The visual comes back detached, visible,
   *  at identity, near-LOD and un-ghosted, re-tinted to THIS entity's colour
   *  (the key is per-template: rift spawns jitter mob.color per instance, so
   *  the pooled tint may belong to another mob; a no-op when it matches, and
   *  entity scale rides the view group exactly as for a fresh visual), then
   *  carrying the renderer's live compile gate: prewarm-seeded visuals were
   *  built outside createCharacterVisualWithRetry and have none, and a far
   *  re-skin on a live one must link hidden like everything else. */
  take(key: string, entityColor: number): V | null {
    const visual = this.pool.take(key);
    if (!visual) return null;
    resetPooledRoot(visual.root, true);
    visual.setFar(false);
    visual.setGhost(false);
    // Re-tint BEFORE the gate goes in: a tint is a uniform on programs the
    // fixed rig's far mesh already linked, so it commits directly (as before);
    // installed first, the gate would stage it and the far mesh would keep the
    // previous instance's colour until that gate settled.
    visual.setEntityColor(entityColor);
    visual.setFarBakeGate(this.host.farBakeGate());
    return visual;
  }

  /** Park a visual whose entity streamed out: detached, hidden, at identity,
   *  into the bounded least-recently-released-first store, which disposes the
   *  coldest overflow (or the incoming visual when pooling is disabled) so
   *  eviction genuinely frees the per-instance Skeleton + GPU bone-matrix
   *  DataTexture while the hot working set keeps its reuse. An evicted key
   *  transparently rebuilds from the live entity on its next request. */
  store(key: string, visual: V): void {
    resetPooledRoot(visual.root, false);
    this.pool.store(key, visual, this.host.maxPooled());
  }
}
