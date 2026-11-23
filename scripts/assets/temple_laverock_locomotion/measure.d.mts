import type { Animation, Document, Node } from '@gltf-transform/core';
import type { Group, Object3D } from 'three';

export interface MeasuredRig {
  document: Document;
  group: Group;
  objects: Map<Node, Object3D>;
}
export function readRig(path: string): Promise<MeasuredRig>;
export function player(rig: MeasuredRig, animation: Animation): (time: number) => void;
export function normalizedScale(rig: MeasuredRig): number;
export function contacts(
  rig: MeasuredRig,
  animation: Animation,
  scale: number,
  stance: number,
): {
  duration: number;
  speed: number;
  min: number;
  max: number;
  ankleMin: number;
  ankleMax: number;
  seam: number;
};
