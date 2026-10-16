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
    p.glowStrength === undefined &&
    p.wallFinishes === undefined &&
    p.materialFinishes === undefined
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

/**
 * Which of a template's sub-meshes can share ONE draw call: every sub-mesh
 * whose merge signature (material + vertex layout + shadow flags, computed by
 * the three-side caller) matches joins one group, in first-appearance order,
 * so a kit house with 26 sub-meshes over 8 materials costs 8 batches instead
 * of 26, and 26 instance seats per copy become 8. Entries whose signature is
 * null (a mirrored node, a morph target, a multi-material mesh) stay alone.
 * Returns the groups as source sub-mesh indices, stable across runs, so the
 * LOD1 twin (matched by sub-mesh order) can be merged with the same plan.
 */
export function mergePlan(signatures: readonly (string | null)[]): number[][] {
  const groups: number[][] = [];
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < signatures.length; i++) {
    const key = signatures[i];
    if (key === null) {
      groups.push([i]);
      continue;
    }
    const group = byKey.get(key);
    if (group) group.push(i);
    else {
      const fresh = [i];
      byKey.set(key, fresh);
      groups.push(fresh);
    }
  }
  return groups;
}

/**
 * Distance tiers for placed assets. Full geometry to PLACED_IMPOSTER_DIST,
 * then a baked sprite of itself (render/placed_imposters.ts), then nothing at
 * all past LOD_RANGE_ASSETS (placed_assets.ts, 1200 yd), SPACEY, 2026-09-20:
 * "once you get 200 yds render the trees as a flat png and then 500yds dont
 * even render them". The upgrade edge sits nearer by the hysteresis so a
 * camera parked on the boundary never ping-pongs it.
 *
 * Was 300 on the first pass ("make the billboards imposters for 300yds+",
 * 2026-09-18); 200 swaps a third earlier and buys back the draws the
 * generated-art trees cost.
 */
export const PLACED_IMPOSTER_DIST = 200;
export const PLACED_LOD_HYSTERESIS = 1.12;

/** The tier a placement at squared distance `d2` belongs to, given its current
 *  one: 0 = geometry, 1 = imposter sprite. */
export function placedImposterLevel(
  d2: number,
  current: 0 | 1,
  imposterDist = PLACED_IMPOSTER_DIST,
): 0 | 1 {
  const edge = current === 1 ? imposterDist / PLACED_LOD_HYSTERESIS : imposterDist;
  return d2 > edge * edge ? 1 : 0;
}

/** A placement's drawn tier: 0 = its geometry, 1 = its sprite, 2 = its LOD
 *  twin (the town's buildings only; see placedTwinLevel). */
export type PlacedLodLevel = 0 | 1 | 2;

/**
 * The Tidehold town's buildings carry a baked low-poly twin,
 * `<name>.lod.glb` (scripts/assets/blender_tidehold/bl_town_lod.py): one
 * material, the exterior only, a few hundred triangles. SPACEY, 2026-09-26:
 * "create low poly ... versions ... insure the buildings all look the same at
 * that far distance", then "300 imposters and then 500yd dont even render the
 * bulding at all" and "dont render any of the extra indoors or bonus assets at
 * that 300yds". So: the full model to TWIN_NEAR, the twin to TWIN_FAR, a
 * sprite baked FROM the twin to BUILDING_CULL, nothing past it.
 */
export const TWIN_NEAR = 200;
export const TWIN_FAR = 300;
export const BUILDING_CULL = 500;

const TWIN_OF =
  /^(\/models\/tidehold\/(?:house_[a-e]|tavern(?:_b)?|smithy|market|hall|shop_[ab]|bank|vault))\.glb$/;

/** The LOD twin of a town building's GLB path, or null for anything else. */
export function twinPathFor(path: string | undefined): string | null {
  const m = path ? TWIN_OF.exec(path.split('?')[0]) : null;
  return m ? `${m[1]}.lod.glb` : null;
}

/** The tier a town building at squared distance `d2` belongs to, given its
 *  current one (hysteresis as placedImposterLevel: a tier is left outward at
 *  its edge and re-entered inward at edge / PLACED_LOD_HYSTERESIS). Without a
 *  sprite (`spriteOk` false) the twin holds to the cull. */
export function placedTwinLevel(
  d2: number,
  current: PlacedLodLevel,
  spriteOk = true,
  near = TWIN_NEAR,
  far = TWIN_FAR,
): PlacedLodLevel {
  const d = Math.sqrt(d2);
  const edges = [near, far];
  const top = spriteOk ? 2 : 1;
  let rank = Math.min(top, current === 0 ? 0 : current === 2 ? 1 : 2);
  for (let i = 0; i < 3; i++) {
    if (rank < top && d > edges[rank]) rank++;
    else if (rank > 0 && d < edges[rank - 1] / PLACED_LOD_HYSTERESIS) rank--;
    else break;
  }
  return rank === 0 ? 0 : rank === 1 ? 2 : 1;
}

/**
 * Tier and cull transitions cross-FADE rather than pop ("when models phase
 * out they should pop out gentle with a fade look"): the outgoing
 * representation dithers down over PLACED_FADE_SECONDS while the incoming
 * one dithers up, then the outgoing one leaves its batch.
 */
export const PLACED_FADE_SECONDS = 0.45;

/** Advance a 0..1 fade toward `target` by `dt` seconds; clamped at the ends. */
export function stepFade(
  value: number,
  target: 0 | 1,
  dt: number,
  seconds = PLACED_FADE_SECONDS,
): number {
  const step = seconds > 0 ? dt / seconds : 1;
  if (target === 1) return Math.min(1, value + step);
  return Math.max(0, value - step);
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
