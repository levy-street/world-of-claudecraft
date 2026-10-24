export interface DistanceExperimentSnapshot {
  cap: number;
  sceneryOff: boolean;
  suppressedRoots: number;
  serial: number;
  objects: {
    uuid: string;
    root: string;
    bounds: number[];
    originallyVisible: boolean;
    visible: boolean;
  }[];
  entries: {
    uuid: string;
    root: string | undefined;
    total: number;
    kept: number;
    indices: number[];
    bounds: number[][];
    placementsExact: boolean;
  }[];
}
export function installSceneryDistanceExperiment(renderer: object): {
  retains(mesh: object, index: number): boolean | null;
  set(distance: number): void;
  setSceneryOff(enabled: boolean): void;
  refresh(): void;
  snapshot(): DistanceExperimentSnapshot;
  dispose(): void;
};
