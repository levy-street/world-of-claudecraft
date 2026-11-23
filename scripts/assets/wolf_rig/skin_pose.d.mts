import type { Animation, AnimationChannel, Node, Root } from '@gltf-transform/core';

export interface WolfRig {
  readonly nodes: Node[];
  readonly parent: Map<Node, Node>;
  readonly meshes: Node[];
  readonly byName: Map<string, Node>;
}
export interface LocalTrs {
  t: number[];
  r: number[];
  s: number[];
}
export type WolfPose = Map<Node, LocalTrs>;

export const REGIONS: readonly string[];
export function regionOf(bone: string): string;
export function readWolfGlb(path: string): Promise<Root>;
export function rigOf(root: Root): WolfRig;
export function clipDuration(anim: Animation): number;
export function sample(channel: AnimationChannel, t: number): number[];
export function localPose(
  rig: WolfRig,
  anim: Animation,
  t: number,
): { local: WolfPose; unbound: string[] };
export function worldUpFor(rig: WolfRig, name: string): number[];
export function lowestByRegion(rig: WolfRig, local: WolfPose): Record<string, number>;
export function skinnedBoundsY(rig: WolfRig, local: WolfPose): { min: number; max: number };
export function idleMeasureTime(idle: Animation): number;
export function idleGround(rig: WolfRig, root: Root): number;
export function idleHeight(rig: WolfRig, root: Root): number;
export function biggestTurn(prev: WolfPose, local: WolfPose): { step: number; bone: string };
