import type { GapStats, SampleStats } from './bench_gate.mjs';

export declare function boundedEnvInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number;
export declare function mulberry32(seed: number): () => number;
export declare function lettersOf(n: number): string;
export declare function ipFor(n: number): string;
export declare function sanitizeBaseUrl(urlStr: string): string;
export declare function terminalAwareGapMax(
  gapMax: number,
  lastSnapAtMs: number | undefined,
  windowCloseAtMs: number,
): number;

export interface FishingSpot {
  x: number;
  z: number;
  facing: number;
  zoneId: string;
}

export interface FishingSpotSimData {
  GATHER_NODES: ReadonlyArray<{ pos: { x: number; z: number } }>;
  WORLD_SEED: number;
  groundHeight(x: number, z: number, seed: number): number;
  waterLevelAt(x: number, z: number): number;
  firstFishableSampleAhead(
    x: number,
    z: number,
    facing: number,
    seed: number,
  ): { x: number; z: number; water: number } | null;
  zoneAt(x: number, z: number): { id: string };
}

export declare function findFishingSpots(sim: FishingSpotSimData, want: number): FishingSpot[];

export interface ObserverSample {
  role: 'gather' | 'fish';
  snapSizes: number[];
  snapTimes: number[];
  snapCount: number;
  ncdCount: number;
  ncdBytes: number;
  tslotCount: number;
  tslotBytes: number;
}

export interface RoleAggregate {
  observers: number;
  snapshots: number;
  snapBytes: SampleStats;
  gapP95Median: number;
  gapMaxWorst: number;
  ncd: { presenceRatio: number; bytesPerSnapshot: number; bytesWhenPresent: number };
  tslot: { presenceRatio: number; bytesPerSnapshot: number; bytesWhenPresent: number };
}

export declare function aggregateObservers(
  observers: ReadonlyArray<ObserverSample>,
  deps: {
    gapStats: (snapTimes: ReadonlyArray<number>) => GapStats;
    sampleStats: (values: ReadonlyArray<number>) => SampleStats;
  },
): Partial<Record<'gather' | 'fish', RoleAggregate>>;
