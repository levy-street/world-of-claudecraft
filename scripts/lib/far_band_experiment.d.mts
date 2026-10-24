import type { BandItem } from './middle_band_experiment.mjs';
import type { installSceneryDistanceExperiment } from './scenery_distance_experiment.mjs';
export function inFarBand(
  item: Pick<BandItem, 'kind' | 'bounds' | 'x' | 'z'>,
  x: number,
  z: number,
): boolean;
export function installFarBandExperiment(
  renderer: object,
  distance: ReturnType<typeof installSceneryDistanceExperiment>,
  options?: {
    name?: string;
    radius?: number;
    targetTriangles?: number;
    member?: (item: BandItem, x: number, z: number) => boolean;
    excluded?: (item: BandItem) => boolean;
  },
): Promise<{
  set(enabled: boolean): void;
  snapshot(): {
    enabled: boolean;
    items: number;
    active: number[];
    draws: number;
    triangles: number;
    nearViolations: number;
    stats: { name: string; before: number; after: number }[];
    inventory: {
      id: number;
      key: string;
      kind: string;
      bounds: number[];
      x: number;
      z: number;
      parts: number;
    }[];
  };
  dispose(): void;
}>;
