// Inverts editable foliage PLACEMENTS back into far-field Decoration records
// so converted trees and rocks keep the SAME distance treatment procedural
// ones get: real model near, baked sprite impostor from the tree/rock handoff
// plane to the fog wall. Without this, a map whose foliage was made editable
// (decorationsMode 'empty') rendered a bare horizon past the placed-asset
// cull while the shipped world showed treelines — and, worse, the placements
// drew REAL models out to the placed-asset range, far past where the game
// ever draws a real tree.
//
// The inversion mirrors editor/foliage_edit_core.ts treeAsset()/rockPlacement()
// EXACTLY (scale factors and variant mapping), so a converted-then-inverted
// tree sprites at the size the conversion drew it. Pure: no three, no DOM.

import type { BiomeId } from '../sim/types';
import type { Decoration } from '../sim/world';

/** assetId -> decoration mapping for one placement, or null for any asset the
 *  far field has no sprite archetype for (willows, palms, props...). */
export function farDecorationFor(
  placement: { assetId?: string; path?: string; x: number; z: number; scale?: number },
  biome: BiomeId,
): Decoration | null {
  const ref = placement.assetId ?? placement.path ?? '';
  const m = /^(?:\/models\/)?foliage\/(pine|oak|twisted|dead|rock)_(\d+)(?:\.glb)?$/.exec(ref);
  if (!m) return null;
  const family = m[1] as 'pine' | 'oak' | 'twisted' | 'dead' | 'rock';
  const variant = Math.max(0, parseInt(m[2], 10) - 1);
  const s = placement.scale ?? 1;
  const base = {
    x: placement.x,
    z: placement.z,
    variant,
    biome,
    farOnly: true as const,
    farSpecies: family,
  };
  switch (family) {
    case 'pine':
      return { ...base, kind: 'tree', scale: s / 1.1 };
    case 'oak':
      return { ...base, kind: 'tree2', scale: s / 1.15 };
    case 'twisted':
      return { ...base, kind: 'tree2', scale: s / 0.5 };
    case 'dead':
      return { ...base, kind: 'tree2', scale: s / 0.7 };
    case 'rock':
      return { ...base, kind: 'rock', scale: s / 0.62 };
    default:
      return null;
  }
}

/** Every far-field decoration a placement list implies (sprite lane only). */
export function farFoliageDecorations(
  placements: readonly { assetId?: string; path?: string; x: number; z: number; scale?: number }[],
  biomeAt: (x: number, z: number) => BiomeId,
): Decoration[] {
  const out: Decoration[] = [];
  for (const p of placements) {
    const d = farDecorationFor(p, biomeAt(p.x, p.z));
    if (d) out.push(d);
  }
  return out;
}
