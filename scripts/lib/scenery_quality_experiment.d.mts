import type { installFarBandExperiment } from './far_band_experiment.mjs';
import type { BandItem, installMiddleBandExperiment } from './middle_band_experiment.mjs';
import type { installSceneryDistanceExperiment } from './scenery_distance_experiment.mjs';
import type { SceneryZoneBounds } from './scenery_quality_indices.mjs';
export function isGiantTree(item: BandItem): boolean;
export function sceneryDistance(
  item: Pick<BandItem, 'kind' | 'x' | 'z' | 'bounds'>,
  x: number,
  z: number,
): number;
export function installSceneryQualityExperiment(
  renderer: object,
  distance: ReturnType<typeof installSceneryDistanceExperiment>,
  options?: { palmZone?: SceneryZoneBounds },
): Promise<{
  set(mode: 'baseline' | 'quality' | 'horizon' | 'regional'): void;
  dispose(): void;
  snapshot(): {
    mode: string;
    middle: ReturnType<Awaited<ReturnType<typeof installMiddleBandExperiment>>['snapshot']>;
    giants: ReturnType<Awaited<ReturnType<typeof installMiddleBandExperiment>>['snapshot']>;
    far: ReturnType<Awaited<ReturnType<typeof installFarBandExperiment>>['snapshot']>;
    outer: ReturnType<Awaited<ReturnType<typeof installFarBandExperiment>>['snapshot']>;
    fog: { near: number; far: number } | null;
  };
}>;
