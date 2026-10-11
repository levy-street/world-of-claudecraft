// Types for woc_lod_extension.mjs (the WOC_lod glTF extension; tests read it directly).
import type {
  Accessor,
  Document,
  Extension,
  ExtensionProperty,
  Mesh,
  Primitive,
  Transform,
} from '@gltf-transform/core';

export declare const WOC_LOD: 'WOC_lod';
export declare const LOD_VERTEX_TAG: '_WOC_LOD_VERTEX';

/** A 32-bit FNV-1a fingerprint of an index accessor's values; null without one. */
export declare function indexFingerprint(accessor: Accessor | null): number | null;
/** The contract's index array for a primitive of `vertexCount` vertices (u32 above 65,535). */
export declare function lodIndexArrayFor(
  vertexCount: number,
  values: ArrayLike<number>,
): Uint16Array | Uint32Array;

export declare class WocLodLevel extends ExtensionProperty {
  getIndices(): Accessor | null;
  setIndices(indices: Accessor | null): this;
  getMaxDeviation(): number;
  setMaxDeviation(maxDeviation: number): this;
}

export declare class WocLod extends ExtensionProperty {
  addLevel(level: WocLodLevel): this;
  removeLevel(level: WocLodLevel): this;
  listLevels(): WocLodLevel[];
  getBaseIndexHash(): number | null;
  setBaseIndexHash(hash: number | null): this;
}

export declare class WocLodExtension extends Extension {
  static readonly EXTENSION_NAME: 'WOC_lod';
  readonly extensionName: 'WOC_lod';
  createLod(): WocLod;
  createLevel(): WocLodLevel;
}

export interface LodPrimitive {
  mesh: Mesh;
  prim: Primitive;
  lod: WocLod;
}

export declare function listLodPrimitives(doc: Document): LodPrimitive[];
export declare function tagLodVertices(doc: Document): Map<Primitive, number>;
export declare function remapLodVertices(
  doc: Document,
  tagged: Map<Primitive, number>,
  encoder?: unknown,
): number;
export declare function vertexCacheOrder(indices: ArrayLike<number>, encoder: unknown): Uint32Array;
/** Runs `transforms` with every level following its vertices through them. */
export declare function keepLodIndices(
  transforms: Transform[],
  options?: { encoder?: unknown },
): Transform;
