// Only the authored albedo layer crosses into the unlit veil. Lit rig hooks
// (rim, Gloam, hit response) stay with their own effects.
import type * as THREE from 'three';
import type { SpiritVeilWocLayer } from './spirit_veil_family_core';
import {
  attachWocHeadMergedTint,
  attachWocHeadTint,
  reapplyWocHeadTintToClone,
  wocHeadMergedTintOf,
  wocHeadTintOf,
} from './woc_head_tint';

export function spiritVeilWocLayer(source: THREE.Material): SpiritVeilWocLayer | undefined {
  const merged = wocHeadMergedTintOf(source);
  if (merged) return merged.oneSided ? 'merged-one' : 'merged-both';
  const tint = wocHeadTintOf(source);
  return tint
    ? tint.role === 'skin' && tint.surface === 'suit'
      ? 'skin_suit'
      : tint.role
    : undefined;
}

export function carrySpiritVeilWoc(source: THREE.Material, veil: THREE.MeshBasicMaterial): void {
  if (!spiritVeilWocLayer(source)) return;
  const color = (source as THREE.MeshBasicMaterial).color;
  if (color) veil.color.copy(color);
  reapplyWocHeadTintToClone(source, veil);
}

/** Factory-identical stand-in layer, with values immaterial to program identity. */
export function attachSpiritVeilWocStandIn(
  source: THREE.Material,
  layer: SpiritVeilWocLayer,
): void {
  if (layer === 'merged-one' || layer === 'merged-both') {
    const u = attachWocHeadMergedTint(source, layer === 'merged-one');
    const map = (source as THREE.MeshBasicMaterial).map;
    u.hair.value = u.beard.value = u.scalp.value = map;
  } else {
    attachWocHeadTint(
      source,
      layer === 'skin_suit' ? 'skin' : layer,
      [1, 1, 1],
      layer === 'skin_suit' ? 'suit' : undefined,
    );
  }
}
