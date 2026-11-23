// Types for lod_indices.mjs (the WOC character LOD generator; tests read it directly).
import type { Document, Node, Primitive } from '@gltf-transform/core';

export interface LodLevelSpec {
  readonly name: string;
  /** measured deviation bound, as a share of the character's height */
  readonly limit: number;
  /** smallest triangle share the ladder tries */
  readonly floor: number;
  readonly lockBorder: boolean;
}

export declare const LOD_LADDER: readonly number[];
export declare const LOD_LEVELS: readonly [LodLevelSpec, LodLevelSpec];
export declare const LOD_NORMAL_WEIGHT: number;
export declare const LOD_UV_WEIGHT: number;
export declare const LOD_MIN_SAVING: number;
export declare const LOD_DEVIATION_STEPS_PER_UNIT: number;
export declare const LOD_VERIFY_TOLERANCE: number;

export interface CharacterSpace {
  count: number;
  pos: Float32Array;
  nrm: Float32Array;
  linear(delta: Float32Array): Float32Array;
}

export declare function characterSpace(prim: Primitive, node: Node | null): CharacterSpace;
export declare function measureDeviation(
  pos: Float32Array,
  samples: ArrayLike<number>,
  lodIndices: ArrayLike<number>,
  stopAbove?: number,
): { max: number; exceeded: boolean };
export declare function lodMorphWeights(targetName: string | undefined): number[];

export interface LodLevelRow {
  triangles: number;
  share: number;
  ladder: number;
  maxDeviation: number;
  deviationShare: number;
  sharesMid?: true;
}

export interface LodMorphRow {
  deviation: number;
  deviationShare: number;
  extraShare: number;
  target: string | number;
  weight: number;
}

export interface LodPrimitiveRow {
  mesh: string;
  nodes: string[];
  primitive: number;
  material: string | null;
  skipped?: string;
  vertices?: number;
  triangles?: number;
  spaces?: number;
  mid?: LodLevelRow | null;
  far?: LodLevelRow | null;
  morph?: { targets: number; mid?: LodMorphRow; far?: LodMorphRow };
}

export interface LodTotals {
  primitives: number;
  withMid: number;
  withFar: number;
  triangles: number;
  mid: number;
  far: number;
  worstMidShare: number;
  worstFarShare: number;
  worstMorphExtraShare: number;
}

export interface LodReport {
  height: number;
  levels: (LodLevelSpec & { limitUnits: number })[];
  primitives: LodPrimitiveRow[];
  totals: LodTotals;
}

export declare function addLodIndices(
  doc: Document,
  options: {
    height: number;
    minSaving?: number;
    morphs?: boolean;
    levels?: readonly LodLevelSpec[];
  },
): Promise<LodReport>;
export declare function lodTotals(report: Pick<LodReport, 'primitives'>): LodTotals;
export declare function verifyLodIndices(
  doc: Document,
  options: { tolerance: number },
): {
  rows: {
    mesh: string;
    primitive: number;
    level: number;
    triangles: number;
    recorded: number;
    measured: number;
  }[];
  failures: string[];
};
