// Type surface for scripts/anim/pose_blend.mjs (see that file for behavior).
// Mirrors the scripts/*.d.mts convention so tests/pose_blend.test.ts can
// import the .mjs under strict tsc without an implicit-any error.
import type { Animation, Document, Node, Root } from '@gltf-transform/core';

export interface ChannelDonor {
  node: Node;
  path: string;
  times: Float32Array;
  values: Float32Array;
  size: number;
}

export type Pose = Map<string, number[]>;
export type ClipIndex = Map<string, ChannelDonor>;
export type ValueFor = (key: string, nodeName: string) => number[] | null | undefined;
export type TimelineRow = [time: number, valueFor: ValueFor];
// sampleChannel never reads .node, only the sampled-curve fields.
export type SampledChannel = Pick<ChannelDonor, 'path' | 'times' | 'values' | 'size'>;

export function createGlbIO(): import('@gltf-transform/core').NodeIO;

export function lerpV(a: readonly number[], b: readonly number[], t: number): number[];
export function slerpQ(a: readonly number[], b: readonly number[], t: number): number[];
export const easeOutCubic: (t: number) => number;
export const easeInOutQuad: (t: number) => number;
export function blendValue(
  key: string,
  a: readonly number[],
  b: readonly number[],
  t: number,
): number[];

export interface PoseRampOptions {
  fromTime: number;
  toTime: number;
  steps: number;
  ease: (t: number) => number;
  fromPose: Pose;
  toPose: Pose;
  fallback: Pose | undefined;
}
export function pushPoseRamp(timeline: TimelineRow[], options: PoseRampOptions): void;

export function indexClip(root: Root, name: string): ClipIndex;
export function sampleChannel(ch: SampledChannel, t: number): number[];
export function samplePose(clipIndex: ClipIndex, t: number): Pose;
export function poseValue(pose: Pose, key: string, fallback: Pose | undefined): number[] | null;
export function mergePoses(...poses: readonly Pose[]): Pose;

export interface BakeClipOptions {
  clipName: string;
  channelKeys: Iterable<string>;
  timeline: readonly TimelineRow[];
  donorFor: (key: string) => ChannelDonor | null | undefined;
}

export interface BakeClipResult {
  animation: Animation;
  authored: number;
  times: Float32Array;
}

export function bakeClip(doc: Document, options: BakeClipOptions): BakeClipResult;
export function stripToAnimationsOnly(doc: Document, keepAnims: Iterable<Animation>): void;
