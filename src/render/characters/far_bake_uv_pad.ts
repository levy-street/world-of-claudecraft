// The uv agreement step of the far-LOD bake (characters/assets.ts
// bakeStaticPose), the sibling of dequantize_attribute.ts: that one makes the
// uv attributes that exist agree in TYPE, this one makes their PRESENCE agree.
//
// mergeGeometries refuses a set whose attribute lists differ, and a composed
// (modular) body always mixes atlas-mapped kit pieces with colour-only face
// parts (head, ears, eyes, mouth, brows) that ship no uv at all. The bake used
// to resolve that by deleting uv from EVERY part, which stripped the kit's
// atlas uv too: the merged far mesh then sampled the atlas at the single texel
// (0,0) across the whole robe and hat, a flat untextured body the moment a
// peer or NPC crossed into the static band (the "NPCs lose their textures"
// report). Padding the uv-less parts instead keeps the mapped parts intact.
import * as THREE from 'three';

/**
 * Give every geometry in a far-bake set a `uv` attribute when at least one of
 * them has one. A part without uv gets an all-zero Float32 uv of its own
 * vertex count: it never samples a map, so the value is inert, and Float32
 * matches what dequantizeAttribute already made the real ones. A set where
 * nothing carries a uv is left alone (nothing to agree with).
 */
export function padMissingUv(geos: readonly THREE.BufferGeometry[]): void {
  if (!geos.some((g) => g.getAttribute('uv'))) return;
  for (const g of geos) {
    if (g.getAttribute('uv')) continue;
    const count = g.getAttribute('position')?.count ?? 0;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
}
