// A geometry's levels of detail, and the geometry each level is drawn with (the three.js half;
// the arithmetic and the fallback rule are geometry_lod_core.ts, the file contract is
// woc_lod_plugin.ts). A level is an index list over its geometry's OWN vertices, so drawing it
// needs no vertex data of its own: a VARIANT geometry that shares every buffer of its source
// (the attributes, the morph attributes and their relativity, the groups, the bounds) and
// differs only in its index.
//
// Where the levels live: in a module WeakMap keyed by geometry, never on `userData`. A geometry
// clone shares `userData` by reference and an Object3D copy JSON-clones its own, so levels kept
// there would ride every derived geometry whatever it did to the vertices (a level over a
// geometry whose vertices moved draws garbage, or reads past its buffers) and be serialized to
// arrays by any `toJSON`. In the WeakMap a level reaches a derived geometry only where the code
// that derived it says the vertex order held (carryGeometryLod, mergeGeometryLod), and any other
// derivation simply draws level 0: losing a level is the safe failure, drawing a wrong one is
// not. The WeakMap also lets a geometry and its levels be collected together.
//
// Ownership and disposal: one variant per (source, level), cached here and shared by every mesh
// that draws that level. Shared attributes mean shared GPU buffers, and three's geometry dispose
// deletes the buffer of every attribute the geometry holds, so a variant disposed alone would
// free the very buffers its source still draws (and the source, disposed alone, those of every
// variant). A variant therefore has no dispose of its own: its `dispose()` does nothing, and it
// is disposed by its source's dispose, inside the same dispatch (a buffer both hold is deleted
// once, whichever listener runs first). It lives exactly as long as its source, which every
// existing cache already disposes only once nothing draws it.
// What a variant owns alone is its index buffer (each level's list belongs to one geometry: a
// derived geometry carries a COPY), its vertex-array bindings, and, for a source with morph
// targets, the morph texture three builds per geometry at the first draw.
import * as THREE from 'three';
import {
  type CoarseLodLevel,
  type GeometryLodLevel,
  geometryLodDrawn,
  type LodMergePart,
  mergeLodIndices,
} from './geometry_lod_core';

export type { CoarseLodLevel, GeometryLodLevel } from './geometry_lod_core';

/** A geometry's coarser levels: index lists over its own vertices. */
export interface GeometryLod {
  readonly mid?: THREE.BufferAttribute;
  readonly far?: THREE.BufferAttribute;
}

/** Each source geometry's levels. */
const levelsOf = new WeakMap<THREE.BufferGeometry, GeometryLod>();
/** Each variant's source and the level it draws. */
const variantOf = new WeakMap<
  THREE.BufferGeometry,
  { readonly source: THREE.BufferGeometry; readonly level: CoarseLodLevel }
>();
/** Each source's variants, by level. */
const variantsOf = new WeakMap<
  THREE.BufferGeometry,
  Partial<Record<CoarseLodLevel, THREE.BufferGeometry>>
>();

const DISPOSE = THREE.BufferGeometry.prototype.dispose;
/** A variant's own dispose: nothing (it goes with its source, see the header). */
const keptBySource = (): void => undefined;

/** The geometry a variant draws the level of, or the geometry itself. */
export function geometryLodSourceOf(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  return variantOf.get(geometry)?.source ?? geometry;
}

/** The level a geometry draws: a variant's level, else level 0. */
export function geometryLodLevelOf(geometry: THREE.BufferGeometry): GeometryLodLevel {
  return variantOf.get(geometry)?.level ?? 'lod0';
}

/** A geometry's coarser levels (a variant answers for its source), or null. */
export function geometryLodOf(geometry: THREE.BufferGeometry): GeometryLod | null {
  return levelsOf.get(geometryLodSourceOf(geometry)) ?? null;
}

/**
 * Give a geometry its coarser levels (the loader's plugin, a merge, a carry): index lists over
 * its own vertices, each owned by this geometry alone. Set once, before anything asks for a
 * variant: a geometry whose variants exist keeps the levels they draw (a new set is refused,
 * with a dev-channel note), and a variant has no levels of its own. An empty set clears.
 */
export function setGeometryLod(geometry: THREE.BufferGeometry, lod: GeometryLod): void {
  if (variantOf.has(geometry)) return;
  if (variantsOf.has(geometry)) {
    console.warn('[geometry_lod] levels set on a geometry already drawn at a level; kept the old');
    return;
  }
  const own: { mid?: THREE.BufferAttribute; far?: THREE.BufferAttribute } = {};
  if (lod.mid) own.mid = lod.mid;
  if (lod.far) own.far = lod.far;
  if (own.mid || own.far) levelsOf.set(geometry, own);
  else levelsOf.delete(geometry);
}

/**
 * Carry `from`'s levels onto `to`, a geometry derived from it with the SAME vertices in the same
 * order (a rebake, a clone with a narrowed attribute): copies of the lists, so each geometry owns
 * its own. A variant carries nothing: a geometry derived from one took the variant's level as
 * its own index already.
 */
export function carryGeometryLod(from: THREE.BufferGeometry, to: THREE.BufferGeometry): void {
  if (variantOf.has(from)) return;
  const lod = levelsOf.get(from);
  if (!lod) return;
  setGeometryLod(to, { mid: lod.mid?.clone(), far: lod.far?.clone() });
}

/** One part of a merged geometry, in vertex order. */
export interface GeometryLodMergePart {
  /** The part's geometry, or a variant of it: its SOURCE's index and levels are what merge. */
  readonly geometry: THREE.BufferGeometry;
  /** The merge flipped the part's winding (a mirrored part). */
  readonly flip?: boolean;
}

/** A source's levels as a part drawn at them sees them: none where no variant can draw them
 *  (groups, a partial draw range), so a merge never draws coarser than its part would. */
function drawableLevelsOf(source: THREE.BufferGeometry): GeometryLod | null {
  const lod = levelsOf.get(source);
  return lod && variantable(source) ? lod : null;
}

/**
 * Give `out`, a geometry merged from `parts` (their vertices concatenated in order), the levels
 * of its parts: each part's own list at that level, or the next finer one it carries, offset
 * like the merge's own index (geometry_lod_core.ts mergeLodIndices). Nothing when no part
 * carries a level. The merge's own index must be its parts' SOURCE indices (level 0).
 */
export function mergeGeometryLod(
  out: THREE.BufferGeometry,
  parts: readonly GeometryLodMergePart[],
): void {
  if (!parts.some((part) => drawableLevelsOf(geometryLodSourceOf(part.geometry)))) return;
  const merged = mergeLodIndices(
    parts.map((part): LodMergePart => {
      const source = geometryLodSourceOf(part.geometry);
      const lod = drawableLevelsOf(source);
      return {
        vertices: source.getAttribute('position')?.count ?? 0,
        flip: part.flip === true,
        lod0: source.index ? source.index.array : null,
        mid: lod?.mid?.array ?? null,
        far: lod?.far?.array ?? null,
      };
    }),
  );
  setGeometryLod(out, {
    mid: merged.mid ? new THREE.BufferAttribute(merged.mid, 1) : undefined,
    far: merged.far ? new THREE.BufferAttribute(merged.far, 1) : undefined,
  });
}

/** Whether a variant can draw a level of `source` with nothing but another index: no groups
 *  (their ranges count the source's own index) and its whole draw range. */
function variantable(source: THREE.BufferGeometry): boolean {
  return (
    source.groups.length === 0 &&
    source.drawRange.start === 0 &&
    source.drawRange.count === Number.POSITIVE_INFINITY &&
    !(source as THREE.InstancedBufferGeometry).isInstancedBufferGeometry
  );
}

/** A source's dispose takes its variants with it (see the header). */
function disposeVariants(event: { target: THREE.BufferGeometry }): void {
  const own = variantsOf.get(event.target);
  if (!own) return;
  for (const variant of [own.mid, own.far]) if (variant) DISPOSE.call(variant);
}

function makeVariant(
  source: THREE.BufferGeometry,
  index: THREE.BufferAttribute,
  level: CoarseLodLevel,
): THREE.BufferGeometry {
  const variant = new THREE.BufferGeometry();
  variant.name = source.name;
  // the very objects, not copies: a buffer the source (re)binds is the one the variant draws
  variant.attributes = source.attributes;
  variant.morphAttributes = source.morphAttributes;
  variant.morphTargetsRelative = source.morphTargetsRelative;
  variant.groups = source.groups;
  if (!source.boundingBox) source.computeBoundingBox();
  if (!source.boundingSphere) source.computeBoundingSphere();
  variant.boundingBox = source.boundingBox;
  variant.boundingSphere = source.boundingSphere;
  variant.userData = source.userData;
  variant.setIndex(index);
  variant.dispose = keptBySource;
  variantOf.set(variant, { source, level });
  return variant;
}

/**
 * The geometry that draws `wanted` of `geometry` (or of its source, when handed a variant): the
 * level's cached variant, or the source itself where the level is 0, the source carries no
 * coarser level of that kind or finer (geometryLodDrawn), or its draw cannot take another index
 * (groups, a partial draw range). Shared by every mesh that draws that level.
 */
export function geometryLodVariant(
  geometry: THREE.BufferGeometry,
  wanted: GeometryLodLevel,
): THREE.BufferGeometry {
  const source = geometryLodSourceOf(geometry);
  const lod = levelsOf.get(source);
  if (!lod) return source;
  const level = geometryLodDrawn(wanted, (l) => lod[l] !== undefined);
  if (level === 'lod0' || !variantable(source)) return source;
  let own = variantsOf.get(source);
  if (!own) {
    own = {};
    variantsOf.set(source, own);
    source.addEventListener('dispose', disposeVariants);
  }
  let variant = own[level];
  if (!variant) {
    variant = makeVariant(source, lod[level] as THREE.BufferAttribute, level);
    own[level] = variant;
  }
  return variant;
}

/** Draw every mesh under `root` at `wanted`: each mesh's geometry swapped for its variant (a
 *  build or an attach does this once; a mesh with no levels keeps its geometry). */
export function applyGeometryLod(root: THREE.Object3D, wanted: GeometryLodLevel): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const next = geometryLodVariant(mesh.geometry, wanted);
    if (next !== mesh.geometry) mesh.geometry = next;
  });
}
