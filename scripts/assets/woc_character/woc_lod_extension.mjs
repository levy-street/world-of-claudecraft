// WOC_lod: level-of-detail index lists on a mesh primitive, the glTF-Transform side (the
// 2026-10-03 character LOD build; lod_indices.mjs makes the levels, the runtime reads them).
//
// An LOD level is ONLY a new index list over the primitive's own vertices (meshoptimizer
// collapses onto vertices that already exist), so skinning, uvs and morph targets stay valid and
// nothing else in the file changes. On a primitive, in the file:
//
//   "extensions": { "WOC_lod": { "levels": [
//     { "indices": <accessor index>, "maxDeviation": <number> },   the mid level
//     { "indices": <accessor index>, "maxDeviation": <number> }    the far level
//   ] } }
//
// - levels run fine to coarse, mid first and far second. A level that would not save at least a
//   tenth of the primitive's triangles is left out (lod_indices.mjs), and the far level never
//   keeps more triangles than the mid one, so a primitive carries [mid, far], [far] alone, or
//   nothing: ONE level is always the far one. Two levels may name the same accessor (a far level
//   that could not beat the mid one reuses it).
// - indices: a SCALAR accessor, unsigned short (unsigned int when the primitive has more than
//   65,535 vertices), a triangle list over the primitive's vertex indexing.
// - maxDeviation: the largest distance, in the file's scene units (the rig's space, a body about
//   1.18 units tall), from any vertex level 0 draws to the level's surface, MEASURED
//   (lod_indices.mjs measureDeviation), never meshoptimizer's own estimate.
// - WOC_lod is listed in extensionsUsed and NEVER in extensionsRequired: a reader that does not
//   know it draws level 0, as before.
//
// Keeping the accessors through the build: each level holds its accessor as a real reference
// tagged as index data, so prune keeps it, dedup leaves it alone, and the meshopt writer
// compresses it with the triangle codec (the writer picks that codec only for an index accessor
// that some TRIANGLES Primitive parents, so each level also parents its accessor from a
// detached, never-written carrier primitive; without one the writer falls back to the sequence
// codec, about 35% larger on these lists). What no reference can protect is the VERTEX
// NUMBERING: the meshopt transform reorders and compacts every primitive's vertices. Run it, or
// any other transform that renumbers vertices, inside keepLodIndices(...), which follows each
// vertex through the transform and rewrites the levels. A level whose base indices changed
// outside it fails the write (the level-0 index fingerprint each Lod keeps) instead of shipping
// garbage.
// A Lod is owned by its primitive: when the primitive is disposed (prune of a dropped mesh), the
// Lod, its levels and their carriers go with it, so the accessors prune away too.
import {
  Accessor,
  Extension,
  ExtensionProperty,
  Primitive,
  PropertyType,
  RefList,
  WriterContext,
} from '@gltf-transform/core';

export const WOC_LOD = 'WOC_lod';

const { UNSIGNED_INT, UNSIGNED_SHORT } = Accessor.ComponentType;

/** The temporary vertex attribute keepLodIndices follows each vertex by (never written). */
export const LOD_VERTEX_TAG = '_WOC_LOD_VERTEX';

const INDEX_USAGE = WriterContext.BufferViewUsage.ELEMENT_ARRAY_BUFFER;

/** A 32-bit FNV-1a fingerprint of an index accessor's VALUES (its array type ignored, so the
 *  quantizer's u32 to u16 narrowing keeps it). Null without indices. */
export function indexFingerprint(accessor) {
  if (!accessor) return null;
  const array = accessor.getArray();
  let h = 0x811c9dc5;
  for (let i = 0; i < array.length; i++) {
    let v = array[i] >>> 0;
    for (let b = 0; b < 4; b++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      v >>>= 8;
    }
  }
  return h >>> 0;
}

/** The index array type the contract writes for a primitive of `vertexCount` vertices. */
export function lodIndexArrayFor(vertexCount, values) {
  return vertexCount > 65535 ? Uint32Array.from(values) : Uint16Array.from(values);
}

/** One level: its index accessor and its measured deviation. */
export class WocLodLevel extends ExtensionProperty {
  static EXTENSION_NAME = WOC_LOD;

  init() {
    this.extensionName = WOC_LOD;
    this.propertyType = 'WocLodLevel';
    this.parentTypes = ['WocLod'];
  }

  getDefaults() {
    return Object.assign(super.getDefaults(), { indices: null, maxDeviation: 0, carrier: null });
  }

  /** The level's triangle list (an Accessor). */
  getIndices() {
    return this.getRef('indices');
  }

  setIndices(indices) {
    this.setRef('indices', indices, { usage: INDEX_USAGE });
    let carrier = this.getRef('carrier');
    if (indices) {
      if (!carrier) {
        carrier = new Primitive(this.graph);
        this.setRef('carrier', carrier);
      }
      carrier.setMode(Primitive.Mode.TRIANGLES).setIndices(indices);
    } else if (carrier) {
      this.setRef('carrier', null);
      carrier.dispose();
    }
    return this;
  }

  /** Largest distance from a level-0 vertex to this level's surface, in scene units. */
  getMaxDeviation() {
    return this.get('maxDeviation');
  }

  setMaxDeviation(maxDeviation) {
    return this.set('maxDeviation', maxDeviation);
  }

  dispose() {
    const carrier = this.getRef('carrier');
    super.dispose();
    carrier?.dispose();
  }
}

/** A primitive's levels, mid first and far second. */
export class WocLod extends ExtensionProperty {
  static EXTENSION_NAME = WOC_LOD;

  init() {
    this.extensionName = WOC_LOD;
    this.propertyType = 'WocLod';
    this.parentTypes = [PropertyType.PRIMITIVE];
  }

  getDefaults() {
    return Object.assign(super.getDefaults(), { levels: new RefList(), baseIndexHash: null });
  }

  addLevel(level) {
    return this.addRef('levels', level);
  }

  removeLevel(level) {
    return this.removeRef('levels', level);
  }

  listLevels() {
    return this.listRefs('levels');
  }

  /** The level-0 index fingerprint the levels were made against (indexFingerprint), or null
   *  when unchecked. In memory only: the write refuses a Lod whose primitive's indices no longer
   *  match it. */
  getBaseIndexHash() {
    return this.get('baseIndexHash');
  }

  setBaseIndexHash(hash) {
    return this.set('baseIndexHash', hash);
  }

  dispose() {
    const levels = this.listLevels();
    super.dispose();
    for (const level of levels) level.dispose();
  }
}

/** The WOC_lod extension (register it on the IO that reads or writes the character files). */
export class WocLodExtension extends Extension {
  static EXTENSION_NAME = WOC_LOD;
  extensionName = WOC_LOD;

  constructor(document) {
    super(document);
    // a Lod is owned by its primitive: dispose the Lods a disposed primitive leaves behind
    this._lodOwner = (event) => {
      if (!(event.target instanceof Primitive)) return;
      for (const property of [...this.properties]) {
        if (property instanceof WocLod && !property.isDisposed()) {
          if (property.listParents().length === 0) property.dispose();
        }
      }
    };
    document.getGraph().addEventListener('node:dispose', this._lodOwner);
  }

  dispose() {
    this.document.getGraph().removeEventListener('node:dispose', this._lodOwner);
    super.dispose();
  }

  /** Optional by contract: a reader without it draws level 0. */
  setRequired(required) {
    if (required) throw new Error(`${WOC_LOD} is never required (the contract keeps it optional)`);
    return super.setRequired(false);
  }

  createLod() {
    return new WocLod(this.document.getGraph());
  }

  createLevel() {
    return new WocLodLevel(this.document.getGraph());
  }

  /** @hidden */
  read(context) {
    const json = context.jsonDoc.json;
    (json.meshes ?? []).forEach((meshDef, meshIndex) => {
      const mesh = context.meshes[meshIndex];
      (meshDef.primitives ?? []).forEach((primDef, primIndex) => {
        const def = primDef.extensions?.[WOC_LOD];
        if (!def) return;
        const prim = mesh.listPrimitives()[primIndex];
        const lod = this.createLod();
        for (const levelDef of def.levels ?? []) {
          const indices = context.accessors[levelDef.indices];
          if (!indices) throw new Error(`${WOC_LOD}: level indices ${levelDef.indices} missing`);
          lod.addLevel(
            this.createLevel()
              .setIndices(indices)
              .setMaxDeviation(levelDef.maxDeviation ?? 0),
          );
        }
        lod.setBaseIndexHash(indexFingerprint(prim.getIndices()));
        prim.setExtension(WOC_LOD, lod);
      });
    });
    return this;
  }

  /** @hidden */
  write(context) {
    const json = context.jsonDoc.json;
    let written = 0;
    for (const mesh of this.document.getRoot().listMeshes()) {
      const meshIndex = context.meshIndexMap.get(mesh);
      mesh.listPrimitives().forEach((prim, primIndex) => {
        const lod = prim.getExtension(WOC_LOD);
        const levels = lod?.listLevels() ?? [];
        if (!levels.length) return;
        assertLodCurrent(mesh, primIndex, prim, lod);
        const primDef = json.meshes[meshIndex].primitives[primIndex];
        primDef.extensions ??= {};
        primDef.extensions[WOC_LOD] = {
          levels: levels.map((level) => ({
            indices: context.accessorIndexMap.get(level.getIndices()),
            maxDeviation: level.getMaxDeviation(),
          })),
        };
        written++;
      });
    }
    // nothing to say: do not list the extension at all (and never as required)
    if (!written) json.extensionsUsed = (json.extensionsUsed ?? []).filter((n) => n !== WOC_LOD);
    if (json.extensionsRequired) {
      json.extensionsRequired = json.extensionsRequired.filter((n) => n !== WOC_LOD);
    }
    return this;
  }
}

/** Throws when a Lod's levels cannot belong to its primitive any more: an index past the vertex
 *  list, or base indices that changed since the levels were made (a vertex renumbering outside
 *  keepLodIndices). */
function assertLodCurrent(mesh, primIndex, prim, lod) {
  const where = `${WOC_LOD} on ${mesh.getName() || 'a mesh'} primitive ${primIndex}`;
  const hash = lod.getBaseIndexHash();
  if (hash !== null && hash !== indexFingerprint(prim.getIndices())) {
    throw new Error(
      `${where}: the primitive's indices changed after its levels were made (renumber vertices ` +
        'only inside keepLodIndices)',
    );
  }
  const vertices = prim.getAttribute('POSITION')?.getCount() ?? 0;
  const componentType = vertices > 65535 ? UNSIGNED_INT : UNSIGNED_SHORT;
  for (const level of lod.listLevels()) {
    const indices = level.getIndices();
    if (indices?.getType() !== 'SCALAR' || indices.getCount() % 3 !== 0) {
      throw new Error(`${where}: a level without a SCALAR triangle list`);
    }
    if (indices.getComponentType() !== componentType) {
      throw new Error(
        `${where}: level indices are component type ${indices.getComponentType()}, the ` +
          `contract writes ${componentType} for ${vertices} vertices`,
      );
    }
    const array = indices.getArray();
    for (let i = 0; i < array.length; i++) {
      if (array[i] >= vertices) throw new Error(`${where}: index ${array[i]} of ${vertices}`);
    }
  }
}

/** Every mesh primitive that carries at least one level, with its Lod. */
export function listLodPrimitives(doc) {
  const out = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const lod = prim.getExtension(WOC_LOD);
      if (lod?.listLevels().length) out.push({ mesh, prim, lod });
    }
  }
  return out;
}

/**
 * Tag every vertex of every primitive that carries levels with its own number (LOD_VERTEX_TAG,
 * float, exact far past any vertex count here), so a transform that renumbers vertices carries
 * the old numbers along like any other attribute. Returns the tagged primitives.
 */
export function tagLodVertices(doc) {
  const tagged = new Map();
  for (const { prim } of listLodPrimitives(doc)) {
    if (prim.getAttribute(LOD_VERTEX_TAG)) throw new Error(`${LOD_VERTEX_TAG} already present`);
    const count = prim.getAttribute('POSITION').getCount();
    const ids = new Float32Array(count);
    for (let i = 0; i < count; i++) ids[i] = i;
    const buffer = prim.getAttribute('POSITION').getBuffer();
    prim.setAttribute(
      LOD_VERTEX_TAG,
      doc.createAccessor('', buffer).setType('SCALAR').setArray(ids),
    );
    tagged.set(prim, count);
  }
  return tagged;
}

/**
 * Rewrite every tagged primitive's levels onto its new vertex numbering (read off the tag the
 * transform carried), drop the tags, and re-fingerprint the base indices. Each level's
 * triangles are put in vertex-cache order for the index codec, vertex numbers kept. Throws when
 * a vertex a level draws was dropped or the numbering is not a plain renumbering.
 */
export function remapLodVertices(doc, tagged, encoder = null) {
  const remapped = new Map();
  for (const [prim, oldCount] of tagged) {
    // a primitive the transform dropped took its levels with it (the Lod owner rule)
    if (prim.isDisposed()) continue;
    const lod = prim.getExtension(WOC_LOD);
    const tag = prim.getAttribute(LOD_VERTEX_TAG);
    if (!lod || !tag) throw new Error(`${WOC_LOD}: a tagged primitive lost its levels or its tag`);
    const ids = tag.getArray();
    const newCount = prim.getAttribute('POSITION').getCount();
    if (ids.length !== newCount) throw new Error(`${LOD_VERTEX_TAG}: ${ids.length} of ${newCount}`);
    const oldToNew = new Int32Array(oldCount).fill(-1);
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j];
      if (!Number.isInteger(id) || id < 0 || id >= oldCount || oldToNew[id] !== -1) {
        throw new Error(`${LOD_VERTEX_TAG}: vertex ${j} carries ${id}, not a renumbering`);
      }
      oldToNew[id] = j;
    }
    for (const level of lod.listLevels()) {
      const old = level.getIndices();
      let next = remapped.get(old);
      if (!next) {
        const src = old.getArray();
        const values = new Uint32Array(src.length);
        for (let i = 0; i < src.length; i++) {
          const v = oldToNew[src[i]];
          if (v < 0)
            throw new Error(`${WOC_LOD}: a level draws vertex ${src[i]}, which was dropped`);
          values[i] = v;
        }
        const ordered = encoder ? vertexCacheOrder(values, encoder) : values;
        next = doc
          .createAccessor('', old.getBuffer())
          .setType('SCALAR')
          .setArray(lodIndexArrayFor(newCount, ordered));
        remapped.set(old, next);
      }
      level.setIndices(next);
    }
    prim.setAttribute(LOD_VERTEX_TAG, null);
    if (!tag.listParents().some((p) => p.propertyType !== PropertyType.ROOT)) tag.dispose();
    lod.setBaseIndexHash(indexFingerprint(prim.getIndices()));
  }
  for (const old of remapped.keys()) {
    if (!old.listParents().some((p) => p.propertyType !== PropertyType.ROOT)) old.dispose();
  }
  return remapped.size;
}

/** A triangle list in meshoptimizer's vertex-cache (strip) order, its vertex numbers kept: the
 *  order the triangle codec packs smallest, and the one a GPU draws best. */
export function vertexCacheOrder(indices, encoder) {
  const work = Uint32Array.from(indices);
  const [remap] = encoder.reorderMesh(work, true, true);
  const back = new Uint32Array(remap.length);
  for (let v = 0; v < remap.length; v++) if (remap[v] !== 0xffffffff) back[remap[v]] = v;
  for (let i = 0; i < work.length; i++) work[i] = back[work[i]];
  return work;
}

/**
 * A transform that runs `transforms` (meshopt, reorder, quantize: anything that may renumber
 * vertices) with every WOC_lod level following its vertices through them. Pass the meshopt
 * encoder as `options.encoder` to also put each level's triangles in vertex-cache order.
 */
export function keepLodIndices(transforms, { encoder = null } = {}) {
  const run = async (doc) => {
    const tagged = tagLodVertices(doc);
    await doc.transform(...transforms);
    remapLodVertices(doc, tagged, encoder);
  };
  Object.defineProperty(run, 'name', { value: 'keepLodIndices' });
  return run;
}
