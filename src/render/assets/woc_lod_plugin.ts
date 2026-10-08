// The GLTFLoader plugin that reads WOC_lod: the coarser levels of detail a WOC character file
// ships beside each primitive (scripts/assets/woc_character/, the split build). A primitive
// that has them carries
//
//   "extensions": { "WOC_lod": { "levels": [ { "indices": <accessor>, "maxDeviation": <units> } ] } }
//
// with the levels ordered mid first then far, a level that saves under a tenth of the triangles
// left out (so a list of one is the far level: geometry_lod_core.ts wocLodLevelNames). Each
// level is a triangle-list index accessor over the primitive's OWN vertices, so skinning, uvs,
// normals and morph targets hold as they are. The extension is in `extensionsUsed`, never
// `extensionsRequired`: a loader without this plugin draws level 0 and ignores it.
//
// After the parse, each primitive's levels are loaded through the parser (its accessor cache,
// the meshopt decoder) and stored on the geometry the loader built for it (geometry_lod.ts
// setGeometryLod); GLTFLoader shares one geometry between primitives of identical accessors,
// and the first primitive met names its levels. Fail soft: a level that is not a legal triangle
// list over its geometry's vertices, or reads back mostly degenerate (an index list written as a
// vertex stream: geometry_lod_core.ts LOD_MAX_DEGENERATE_SHARE), is dropped with a dev-channel
// note, and nothing here ever fails a load (a geometry with no level draws level 0 throughout).
import type * as THREE from 'three';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { setGeometryLod } from './geometry_lod';
import {
  type CoarseLodLevel,
  LOD_MAX_DEGENERATE_SHARE,
  lodDegenerateShare,
  lodIndicesValid,
  wocLodLevelNames,
} from './geometry_lod_core';

/** The extension's name, as it appears in a file's `extensionsUsed`. */
export const WOC_LOD_EXTENSION = 'WOC_lod';

interface WocLodLevelDef {
  readonly indices?: unknown;
  readonly maxDeviation?: unknown;
}

/** What a mesh made by GLTFLoader is to the parse (its `associations` entry). */
interface PrimitiveRef {
  readonly meshes?: number;
  readonly primitives?: number;
}

const warned = new Set<string>();

/** A dev-channel note, once per message (a malformed level is a build bug, never a player's). */
function warnOnce(message: string, err?: unknown): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[WOC_lod] ${message}`, err ?? '');
}

/** The WOC_lod reader, for GLTFLoader.register. */
export function wocLodPlugin(parser: GLTFParser): GLTFLoaderPlugin {
  return {
    name: WOC_LOD_EXTENSION,
    afterRoot: (result: GLTF) => attachWocLod(parser, result),
  };
}

function levelDefsOf(parser: GLTFParser, mesh: THREE.Mesh): readonly WocLodLevelDef[] | null {
  const ref = parser.associations.get(mesh) as PrimitiveRef | undefined;
  if (ref?.meshes === undefined || ref.primitives === undefined) return null;
  const primitive = parser.json?.meshes?.[ref.meshes]?.primitives?.[ref.primitives];
  const levels = primitive?.extensions?.[WOC_LOD_EXTENSION]?.levels;
  return Array.isArray(levels) && levels.length > 0 ? levels : null;
}

/** Store every primitive's levels on its geometry. Never rejects: a rejected afterRoot would
 *  fail the whole load, and a level is only ever an optimization. */
async function attachWocLod(parser: GLTFParser, result: GLTF): Promise<void> {
  try {
    // every other file the shared loader parses: nothing to walk
    const used: unknown = parser.json?.extensionsUsed;
    if (!Array.isArray(used) || !used.includes(WOC_LOD_EXTENSION)) return;
    if (!Array.isArray(parser.json?.meshes)) return;
    const asked = new Map<
      THREE.BufferGeometry,
      { name: string; defs: readonly WocLodLevelDef[] }
    >();
    // one owner per list: an accessor another geometry already draws (its own index, or a level
    // an earlier primitive named) is copied, so no dispose can free a buffer a level still draws
    const taken = new Set<THREE.BufferAttribute>();
    for (const scene of result.scenes ?? [result.scene]) {
      scene?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (mesh.geometry.index) taken.add(mesh.geometry.index);
        if (asked.has(mesh.geometry)) return;
        const defs = levelDefsOf(parser, mesh);
        if (defs) asked.set(mesh.geometry, { name: mesh.name, defs });
      });
    }
    if (asked.size === 0) return;
    await Promise.all(
      [...asked].map(async ([geometry, { name, defs }]) => {
        try {
          await attachLevels(parser, geometry, name, defs, taken);
        } catch (err) {
          warnOnce(`levels of ${name} could not load; it draws level 0`, err);
        }
      }),
    );
  } catch (err) {
    warnOnce('levels could not be read; every primitive draws level 0', err);
  }
}

async function attachLevels(
  parser: GLTFParser,
  geometry: THREE.BufferGeometry,
  name: string,
  defs: readonly WocLodLevelDef[],
  used: Set<THREE.BufferAttribute>,
): Promise<void> {
  const vertices = geometry.getAttribute('position')?.count ?? 0;
  const names = wocLodLevelNames(defs.length);
  const out: Partial<Record<CoarseLodLevel, THREE.BufferAttribute>> = {};
  for (const [i, level] of names.entries()) {
    const at = defs[i]?.indices;
    if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) {
      warnOnce(`${name}: its ${level} level names no accessor`);
      continue;
    }
    const attribute = (await parser.getDependency('accessor', at)) as
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute
      | null;
    const list = indexList(attribute);
    if (!list || !lodIndicesValid(list.array, vertices)) {
      warnOnce(`${name}: its ${level} level is not a triangle list over its own vertices`);
      continue;
    }
    if (lodDegenerateShare(list.array) > LOD_MAX_DEGENERATE_SHARE) {
      warnOnce(
        `${name}: its ${level} level is mostly degenerate triangles (a list written as a vertex ` +
          'stream? mark the level accessors as index data)',
      );
      continue;
    }
    out[level] = used.has(list) ? list.clone() : list;
    used.add(list);
  }
  setGeometryLod(geometry, out);
}

/** An accessor that can be drawn as an index buffer: one plain integer per entry. */
function indexList(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
): THREE.BufferAttribute | null {
  if (!attribute || (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    return null;
  }
  const plain = attribute as THREE.BufferAttribute;
  if (plain.itemSize !== 1 || plain.normalized) return null;
  const array = plain.array;
  return array instanceof Uint16Array || array instanceof Uint32Array || array instanceof Uint8Array
    ? plain
    : null;
}
