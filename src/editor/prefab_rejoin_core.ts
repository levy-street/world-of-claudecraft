// The inverse of Edit pieces: put a split prefab building back together.
//
// SPACEY, 2026-09-09: "make it so you can join ur split asset back, or a combo of
// selected assets, you highlight all assets in that area then press a button
// to combine all into 1 object."
//
// Two different jobs hide behind one button, and only one of them can be exact:
//
//  - A building that was EXPLODED still knows what it was. Its shell placement
//    carries the building's own origin, yaw and scale (prefab_pieces_core lays
//    it at the model origin with no rotation of its own), so the original
//    placement can be reconstructed to the yard, collision and all, that is
//    what `rejoinPrefab` does here.
//  - Any other pile of placements has no single asset to become. Those are
//    GROUPED instead (app.ts assigns a shared groupId): they pick, drag,
//    rotate and delete as one object without inventing geometry that does not
//    exist. Merging arbitrary GLBs into one mesh would need a bake, and a baked
//    lump could never be taken apart again.
//
// Pure math over the manifest, so a Vitest can prove explode -> rejoin is a
// round trip (tests/editor_prefab_rejoin_core.test.ts).

import type { MapPlacement } from '../sim/map_doc';
import { PIECE_TARGET, type PrefabPiecesDef } from './prefab_pieces_core';

/** The pieces of ONE building, or null when the selection is something else. */
export function prefabOfSelection(
  selection: readonly Pick<MapPlacement, 'assetId'>[],
  lookup: (assetId: string) => PrefabPiecesDef | undefined,
): PrefabPiecesDef | null {
  if (selection.length < 2) return null;
  const building = new Set<string>();
  for (const p of selection) {
    const m = /^tidehold_parts\/([^/]+)\//.exec(p.assetId);
    if (!m) return null; // something in the selection is not a prefab piece
    building.add(m[1]);
  }
  if (building.size !== 1) return null; // pieces of two different buildings
  return lookup(`tidehold/${[...building][0]}`) ?? null;
}

/**
 * Rebuild the whole-building placement from its exploded pieces.
 *
 * The shell is the anchor: explodePrefab seats it at the building's own x/z and
 * yaw with `scale = kb * shell.maxDim / PIECE_TARGET` and
 * `groundY = originY + shell.minY * kb`, so both the building's scale and the
 * height its model origin sat at invert exactly. The result is DETACHED at that
 * origin rather than re-seated on the terrain, so a building that was standing
 * on a plaza does not drop to the ground when it is put back together.
 *
 * Returns null when the shell is missing (the caller falls back to grouping).
 */
export function rejoinPrefab(
  pieces: readonly MapPlacement[],
  def: PrefabPiecesDef,
): MapPlacement | null {
  if (!def.shell) return null;
  const shell = pieces.find((p) => p.assetId === def.shell?.assetId);
  if (!shell || !(shell.scale > 0)) return null;
  const kb = (shell.scale * PIECE_TARGET) / (def.shell.maxDim || 1);
  const originY = (shell.groundY ?? 0) - def.shell.minY * kb;
  const out: MapPlacement = {
    assetId: def.assetId,
    x: shell.x,
    z: shell.z,
    rotY: shell.rotY,
    scale: (kb * def.maxDim) / PIECE_TARGET,
    detached: true,
    groundY: originY + def.minY * kb,
    collide: true,
    // Back to the asset's own authored shape: the split had handed each piece a
    // share of it as per-placement hitboxes, and carrying those over would
    // double the collision up.
    collisionMode: 'baked',
  };
  return out;
}

/** A fresh group id. Short and readable in a saved document. */
export function newGroupId(rand: () => number = Math.random): string {
  return `g${Math.floor(rand() * 0xffffffff).toString(36)}${Math.floor(rand() * 0xffff).toString(36)}`;
}

/** Every index in `placements` that belongs to the same group as `index`. */
export function groupMembers(
  placements: readonly Pick<MapPlacement, 'groupId'>[],
  index: number,
): number[] {
  const id = placements[index]?.groupId;
  if (!id) return [index];
  const out: number[] = [];
  placements.forEach((p, i) => {
    if (p.groupId === id) out.push(i);
  });
  return out.length > 0 ? out : [index];
}
