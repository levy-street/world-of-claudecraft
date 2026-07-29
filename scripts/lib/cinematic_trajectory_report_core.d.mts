export const SAMPLE_RATE_HZ: number;
export const WORLD_SEED: number;

export interface CinematicReportScene {
  readonly id: string;
  readonly duration: number;
  readonly ops: readonly unknown[];
}

export function reportScene(runtime: Record<string, unknown>, scene: CinematicReportScene): void;
