export type Vec3 = number[];
export type Mat4 = number[];

export interface AnimChannel {
  node: string;
  path: 'translation' | 'rotation' | 'scale' | string;
  times: number[];
  values: number[];
  stride: number;
  interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE' | string;
}

export interface Clip {
  name: string;
  duration: number;
  channels: AnimChannel[];
}

export interface SkeletonNode {
  name: string;
  translation: Vec3;
  rotation: number[];
  scale: Vec3;
  children: number[];
}

export interface Skeleton {
  nodes: SkeletonNode[];
  roots: number[];
}

export interface SkinnedVertex {
  p: Vec3;
  j: number[];
  w: number[];
}

export interface SkinnedPrimitive {
  jointNames: string[];
  ibms: Mat4[];
  dequant: Mat4 | null;
  verts: SkinnedVertex[];
  edges: number[][];
}

export interface SkinnedModel {
  skeleton: Skeleton;
  prims: SkinnedPrimitive[];
  clips: Clip[];
}

export interface StretchOptions {
  samples?: number;
  minRestLength?: number;
  reportRatio?: number;
}

export interface StretchResult {
  worst: number;
  worstClip: string | null;
  perClip: { clip: string; worst: number }[];
  overRatio: number;
  overRatioFrac: number;
  edgeSamples: number;
  samples: number;
  minRestLength: number;
  reportRatio: number;
}

export interface BoneStat {
  bone: string;
  peak: number;
  touched: number;
  dominated: number;
  massFrac: number;
}

export interface WeightStats {
  verts: number;
  bones: BoneStat[];
  meanDominant: number;
  unownedFrac: number;
  deadBones: string[];
}

export declare function edgesFromIndices(indices: ArrayLike<number>): number[][];
export declare function sampleChannel(channel: AnimChannel, t: number): number[];
export declare function poseSkeletonAt(
  skeleton: Skeleton,
  clip: Clip | null | undefined,
  t: number,
): Map<string, Mat4>;
export declare function skinPositions(prim: SkinnedPrimitive, posed: Map<string, Mat4>): Vec3[];
export declare function worstEdgeStretch(model: SkinnedModel, opts?: StretchOptions): StretchResult;
export declare function weightStats(model: SkinnedModel): WeightStats;
