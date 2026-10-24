import type * as THREE from 'three';
import type { installSceneryDistanceExperiment } from './scenery_distance_experiment.mjs';
import type { SceneryZoneBounds } from './scenery_quality_indices.mjs';
export interface BandItem {
  key: string;
  kind: string;
  bounds: number[];
  x: number;
  z: number;
  box: THREE.Box3;
  owner: THREE.Object3D;
  parts: { source: THREE.Mesh; matrix: THREE.Matrix4; index: number | null; tint: THREE.Color }[];
}
export function bandDistance(bounds: number[], x: number, z: number): number;
export function inMiddleBand(
  item: Pick<BandItem, 'kind' | 'bounds' | 'x' | 'z'>,
  x: number,
  z: number,
): boolean;
export function collectMiddleBandScenery(
  renderer: { scene: THREE.Scene; camera: THREE.Camera },
  radius?: number,
): BandItem[];
export function installMiddleBandExperiment(
  renderer: object,
  distance: ReturnType<typeof installSceneryDistanceExperiment>,
  options?: {
    name?: string;
    radius?: number;
    quality?: boolean;
    palmZone?: SceneryZoneBounds;
    cellSize?: 64 | 128 | 256;
    allowEmpty?: boolean;
    activateDistance?: boolean;
    litSprites?: boolean;
    member?: (item: BandItem, x: number, z: number) => boolean;
    filter?: (item: BandItem) => boolean;
    excluded?: (item: BandItem) => boolean;
  },
): Promise<{
  set(mode: 'cutoff' | 'simple' | 'sprites' | 'quality' | 'regional'): void;
  snapshot(): {
    mode: string;
    items: number;
    active: number[];
    counts: Record<string, number>;
    atlasBytes: number;
    stats: { mode: string; palm: boolean; name: string; before: number; after: number }[];
    simpleDraws: number;
    triangles: number;
    spriteDraws: number;
    nearViolations: number;
    inventory: {
      id: number;
      key: string;
      x: number;
      z: number;
      kind: string;
      bounds: number[];
      parts: number;
    }[];
  };
  dispose(): void;
}>;
