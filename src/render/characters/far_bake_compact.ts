// The far bake's vertex diet: a geometry holding only the vertices its index draws. A WOC
// piece is baked at its FAR level, which is another index over the piece's own vertices
// (assets/geometry_lod.ts), so a far bake that walked each geometry whole posed, skinned
// and stored every vertex of level 0 to draw about two fifths of them (measured
// 2026-10-05 on the shipped files, the medium armor tier: 20,368 vertices transformed for
// 7,952 drawn on a full-kit male warrior, 22,718 for 10,972 on a female mage).
// The compact geometry is what the bake transforms instead: the same triangles over the
// same attribute values, the dead vertices gone, so the baked far mesh draws exactly what
// it drew, in less than half the work and the memory.
//
// A scratch of the throwaway bake model only (woc_far_bake.ts): it copies raw attribute
// data (same typed array, same normalization, so a quantized position or a skin weight
// reads back bit for bit, out of an interleaved buffer too), keeps the vertices in their
// own order (a geometry drawn whole maps onto itself and is handed back as is), and is
// never drawn.
import * as THREE from 'three';

type Raw = THREE.BufferAttribute['array'];
type AnyAttribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** `attribute` with only the vertices listed in `kept`, in that order, as a plain
 *  attribute of its own. An interleaved one (what the loader builds for a quantized
 *  stream padded to its stride, which is every shipped character position) is read out of
 *  its buffer: its own components, never the stream's padding. */
function gather(attribute: AnyAttribute, kept: Uint32Array): THREE.BufferAttribute {
  const size = attribute.itemSize;
  const interleaved = (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
    ? (attribute as THREE.InterleavedBufferAttribute)
    : null;
  const from: Raw = interleaved
    ? interleaved.data.array
    : (attribute as THREE.BufferAttribute).array;
  const stride = interleaved ? interleaved.data.stride : size;
  const offset = interleaved ? interleaved.offset : 0;
  const Ctor = from.constructor as new (length: number) => Raw;
  const to = new Ctor(kept.length * size);
  for (let k = 0; k < kept.length; k++) {
    const at = kept[k] * stride + offset;
    for (let c = 0; c < size; c++) to[k * size + c] = from[at + c];
  }
  return new THREE.BufferAttribute(to, size, attribute.normalized);
}

/** What a compact geometry carries of its source: every attribute and every morph target
 *  unless a caller names the ones it reads (a far bake reads four attributes and one morph
 *  list: FAR_BAKE_READS). */
export interface CompactKeep {
  readonly attributes?: readonly string[];
  readonly morphs?: readonly string[];
}

/** What the far bake reads of a piece: its positions and uvs, its skin, and the position
 *  morphs the head's pose applies. Its normals are recomputed from the baked triangles,
 *  and no morph but a position's moves a vertex. */
export const FAR_BAKE_READS: CompactKeep = {
  attributes: ['position', 'uv', 'skinIndex', 'skinWeight'],
  morphs: ['position'],
};

/**
 * The geometry of the vertices `geometry`'s index draws: its attributes and morph targets
 * (all of them, or the ones `keep` names) gathered to those vertices, their order kept,
 * and the index renumbered over them. Handed back AS IS when there is nothing to drop (no
 * index, or an index that draws every vertex), and for a shape this cannot stand for
 * vertex by vertex: groups or a partial draw range (the compact geometry carries
 * neither). A caller then bakes the geometry whole, as before.
 */
export function compactDrawnVertices(
  geometry: THREE.BufferGeometry,
  keep: CompactKeep = {},
): THREE.BufferGeometry {
  const index = geometry.index;
  const position = geometry.getAttribute('position');
  if (!index || !position) return geometry;
  if (
    geometry.groups.length > 0 ||
    geometry.drawRange.start !== 0 ||
    geometry.drawRange.count !== Number.POSITIVE_INFINITY
  ) {
    return geometry;
  }
  const count = position.count;
  const drawn = new Uint8Array(count);
  let used = 0;
  for (let k = 0; k < index.count; k++) {
    const i = index.getX(k);
    if (drawn[i] === 0) {
      drawn[i] = 1;
      used++;
    }
  }
  if (used === count) return geometry;
  const kept = new Uint32Array(used);
  const renumbered = new Uint32Array(count);
  for (let i = 0, k = 0; i < count; i++) {
    if (drawn[i] === 0) continue;
    kept[k] = i;
    renumbered[i] = k++;
  }
  const out = new THREE.BufferGeometry();
  out.name = geometry.name;
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (keep.attributes && !keep.attributes.includes(name)) continue;
    out.setAttribute(name, gather(attribute, kept));
  }
  const morphed = out.morphAttributes as Record<string, THREE.BufferAttribute[]>;
  for (const [name, targets] of Object.entries(geometry.morphAttributes)) {
    if (keep.morphs && !keep.morphs.includes(name)) continue;
    morphed[name] = (targets as AnyAttribute[]).map((target) => gather(target, kept));
  }
  out.morphTargetsRelative = geometry.morphTargetsRelative;
  const triangles = new (used > 65535 ? Uint32Array : Uint16Array)(index.count);
  for (let k = 0; k < index.count; k++) triangles[k] = renumbered[index.getX(k)];
  out.setIndex(new THREE.BufferAttribute(triangles, 1));
  return out;
}
