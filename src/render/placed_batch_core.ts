// Instanced-placement bookkeeping: which placements may share one draw call,
// and the dense slot table that keeps an InstancedMesh's live instances packed
// into [0, count). Pure: no three, no DOM, deterministic, Vitest-importable.
//
// Why this exists. The shipped game draws its own authored art instanced (one
// InstancedMesh per (asset, sub-mesh) pair, see render/battleground_placements
// and render/dungeon), but an editor map arrives as WorldContent.placements and
// render/placed_assets cloned a whole GLB subtree per placement: N copies of one
// crate cost N scene nodes and N draw calls, in the editor AND in the real game
// that loads the exported map. So the same village always cost more built in the
// editor than hand-authored, and no amount of LOD tuning could close that gap.
// This module owns the decisions; placed_assets owns the three objects.
//
// The slot table's contract is what makes LOD and selection cheap: freeing a
// slot swaps the LAST live instance into the hole and lowers the count, so the
// backing instanceMatrix stays dense and `mesh.count` alone controls what draws.
// The caller must rewrite the moved instance's matrix, `free` reports it.

import type { PlacedAsset } from '../sim/types';

/**
 * Placements a batch can never hold: an instance has no material of its own,
 * so `tint` / `opacity` / `glow` / `glowStrength` disqualify it.
 * `applyMaterialOverride` clones the shared template materials for exactly
 * these four, and cloned materials cannot share a draw with their siblings.
 *
 * Authored FIRE is deliberately NOT disqualifying. The flame meshes, embers and
 * light live in their own group next to the model (placed_assets applyFireFx),
 * seated from the placement record rather than from the model's geometry, so a
 * bonfire instances its log pile and animates its flame all the same, and
 * bonfires were by far the biggest remaining clone population on a real map.
 *
 * Skinned rigs and the procedural models (grass patches, waterfalls, generated
 * rocks) are rejected by the caller instead: it is the resolved TEMPLATE, not
 * the document record, that reveals a skeleton or an onBeforeRender hook.
 */
export function placementBatchable(p: PlacedAsset): boolean {
  return (
    p.tint === undefined &&
    p.opacity === undefined &&
    p.glow === undefined &&
    p.glowStrength === undefined
  );
}

/**
 * The batch a placement's sub-mesh belongs to. Everything that would force a
 * separate draw call anyway is in the key: the source GLB, which sub-mesh of it
 * this is, and the shadow-caster flag (an InstancedMesh casts as a whole, so
 * casters and non-casters cannot share one).
 */
export function batchKey(path: string, submesh: number, castShadow: boolean): string {
  return `${path}#${submesh}${castShadow ? '' : ':nc'}`;
}

/** What `SlotTable.free` did, so the caller can repair the backing buffer. */
export interface SlotRelease {
  /** The slot that is now beyond the live range. */
  freed: number;
  /**
   * The id whose instance was swapped DOWN into `freed` and must have its
   * matrix rewritten there, or null when the freed slot was already last.
   */
  moved: number | null;
}

/**
 * A dense slot table over one InstancedMesh: ids occupy [0, count), and the
 * table never leaves a hole. Ids are the view's document indices.
 */
export class SlotTable {
  /** id at each live slot, in slot order. */
  private readonly ids: number[] = [];
  /** Reverse index so free() is O(1) rather than a scan. */
  private readonly slotById = new Map<number, number>();

  get count(): number {
    return this.ids.length;
  }

  slotOf(id: number): number | undefined {
    return this.slotById.get(id);
  }

  has(id: number): boolean {
    return this.slotById.has(id);
  }

  /** Live ids in slot order (a copy; callers iterate while mutating). */
  liveIds(): number[] {
    return [...this.ids];
  }

  /** Append `id`, returning its slot. Re-allocating a live id is a no-op that
   *  returns the slot it already holds. */
  alloc(id: number): number {
    const existing = this.slotById.get(id);
    if (existing !== undefined) return existing;
    const slot = this.ids.length;
    this.ids.push(id);
    this.slotById.set(id, slot);
    return slot;
  }

  /** Remove `id` by swapping the last live instance into its slot. Returns null
   *  when the id was not live. */
  free(id: number): SlotRelease | null {
    const slot = this.slotById.get(id);
    if (slot === undefined) return null;
    this.slotById.delete(id);
    const last = this.ids.length - 1;
    if (slot === last) {
      this.ids.pop();
      return { freed: last, moved: null };
    }
    const movedId = this.ids[last];
    this.ids[slot] = movedId;
    this.ids.pop();
    this.slotById.set(movedId, slot);
    return { freed: slot, moved: movedId };
  }

  /**
   * Rewrite an id in place after the view reindexed its document (a removal
   * shifts every higher index down by one). Keeps the slot, so no matrix moves.
   *
   * Call these in ASCENDING order, the way reindexAfterRemoval walks its keys:
   * renaming the highest id first would write over a lower id that is still
   * live under its old number.
   */
  rename(from: number, to: number): void {
    const slot = this.slotById.get(from);
    if (slot === undefined) return;
    this.slotById.delete(from);
    this.ids[slot] = to;
    this.slotById.set(to, slot);
  }

  clear(): void {
    this.ids.length = 0;
    this.slotById.clear();
  }
}

/**
 * How many draw calls a set of placements costs once batched, given each
 * asset's sub-mesh count. The measurable claim this whole change makes: N
 * placements over M assets cost about M draws, not N. Used by the CI guard
 * (tests/placed_batch_core.test.ts) so an instancing regression fails a test
 * rather than waiting to be noticed as a frame-rate drop.
 */
export function projectedDrawCalls(
  placements: readonly PlacedAsset[],
  subMeshCount: (path: string) => number,
  batchable: (p: PlacedAsset) => boolean = placementBatchable,
): number {
  const keys = new Set<string>();
  let clones = 0;
  for (const p of placements) {
    const subs = Math.max(1, subMeshCount(p.path));
    if (!batchable(p)) {
      clones += subs; // an un-batchable placement still draws its own sub-meshes
      continue;
    }
    for (let i = 0; i < subs; i++) keys.add(batchKey(p.path, i, true));
  }
  return keys.size + clones;
}
