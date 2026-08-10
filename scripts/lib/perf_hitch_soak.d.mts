export interface SoakAppearance {
  botIndex: number;
  weaponType: string;
  skin: number;
  weaponVariant: number;
  mountVariant: number;
}

export interface HeapFloorValley {
  readonly atMs: number;
  readonly floorMb: number;
}

export interface SoakChurnStep {
  atMs: number;
  cycle: number;
  outgoingBotIndexes: number[];
  incoming: SoakAppearance[];
  visibleBotIndexes: number[];
}

export interface SoakChurnPlan {
  seed: number;
  cohortCount: number;
  cohortSize: number;
  intervalMs: number;
  appearanceRoundCount: number;
  uniqueCombinationCount: number;
  initialVisibleBotIndexes: number[];
  steps: SoakChurnStep[];
}

export const HITCH_SOAK_SEED: number;
export const HITCH_SOAK_COHORTS: number;
export const HITCH_SOAK_INTERVAL_MS: number;
export const HITCH_SOAK_INSIDE_RADIUS: number;
export const HITCH_SOAK_OUTSIDE_RADIUS: number;

export function estimateHeapFloorGrowthMb(
  series: readonly HeapFloorValley[] | null | undefined,
): number | null;

export function executeSoakChurnPlan(
  plan: SoakChurnPlan,
  actions: {
    now: () => number;
    wait: (delayMs: number) => Promise<void>;
    moveOutside: (botIndex: number) => void;
    applyIncoming: (entry: SoakAppearance) => void;
  },
): Promise<void>;

export function resolveSoakAppearance(
  entry: SoakAppearance,
  weaponType: string,
  weaponSkins: Readonly<Record<string, readonly string[]>>,
  mounts: readonly string[],
): { skin: number; weaponSkin: string; mountItem: string };

export function buildSoakChurnPlan(options: {
  botCount: number;
  measureMs: number;
  seed?: number;
  cohortCount?: number;
  intervalMs?: number;
  skinCount?: number;
  botWeaponTypes: readonly string[];
  weaponVariantCounts: Readonly<Record<string, number>>;
  mountVariantCount?: number;
}): SoakChurnPlan;
