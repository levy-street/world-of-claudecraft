export const NYTHRAXIS_DUNGEON_ID: 'nythraxis_boss_arena';
export const NYTHRAXIS_BOSS_TEMPLATE_ID: 'nythraxis_scourge_of_thornpeak';
export const NYTHRAXIS_ALDRIC_TEMPLATE_ID: 'brother_aldric_raid';
export const NYTHRAXIS_ALDRIC_VISUAL_KEY: 'npc_aldric';
export const NYTHRAXIS_ALDRIC_SPAWN_DIST: number;
export const NYTHRAXIS_PHASE_TWO_HP_PERCENT: number;
export const DUNGEON_INSTANCE_X_MIN: number;
export const NYTHRAXIS_ARENA_ENTRY_LOCAL: Readonly<{ x: number; z: number }>;
export const NYTHRAXIS_BOSS_SPAWN_LOCAL: Readonly<{ x: number; z: number }>;
export const MOB_INTEREST_RADIUS: number;
export const ALDRIC_FREE_PARK_POS: Readonly<{ x: number; z: number }>;
export const NYTHRAXIS_HITCH_PHASES: readonly ['entry', 'arrival', 'boss', 'aldric', 'soulRend'];
export const NYTHRAXIS_HITCH_COMPARE_KEYS: readonly [
  'worstGapMs',
  'stallsOver150',
  'programsDelta',
];

export interface PlanarPos {
  x: number;
  z: number;
}

export function encounterPrewarmQueryValue(prewarm: boolean): string | null;
export function nythraxisHitchObserverUrl(opts: {
  origin: string;
  gfx?: string;
  prewarm?: boolean;
}): string;
export function parseNythraxisHitchLegs(raw: string | null | undefined): Array<'cold' | 'warm'>;
export function aldricSpawnStandingPos(bossPos: PlanarPos, dist?: number): PlanarPos;
export function nythraxisBossSpawnFromEntry(entryPos: PlanarPos): PlanarPos;
export function planarDistance(a: PlanarPos, b: PlanarPos): number;
export function withinMobInterest(
  viewerPos: PlanarPos,
  entityPos: PlanarPos,
  radius?: number,
): boolean;
export function isInsideNythraxisArena(
  player: {
    dungeonId?: string | null;
    pos?: { x?: number };
  } | null,
): boolean;

export interface HitchPhaseSummary {
  worstGapMs: number;
  stallsOver150: number;
  stallsOver50: number;
  programsDelta: number;
  texturesDelta: number;
  visiblePlayers: number;
  soulRendFlips: number;
  aldricSeen: number;
  bossSeen: number;
}

export interface HitchLegSample {
  entry?: unknown;
  arrival?: unknown;
  boss?: unknown;
  aldric?: unknown;
  soulRend?: unknown;
}

export interface HitchMetricDelta {
  before: number;
  after: number;
  delta: number;
}

export type HitchCompareSection = Record<
  (typeof NYTHRAXIS_HITCH_COMPARE_KEYS)[number],
  HitchMetricDelta
>;

export interface HitchCompare {
  entry: HitchCompareSection;
  arrival: HitchCompareSection;
  boss: HitchCompareSection;
  aldric: HitchCompareSection;
  soulRend: HitchCompareSection;
  combat: HitchCompareSection;
}

export const HITCH_LONG_TASK_COVERAGE: number;
export const HITCH_BACKGROUND_MARK_COUNT: number;

export interface HitchGapAttribution {
  atMs: number;
  ms: number;
  longTaskMs: number;
  cause: 'long-task' | 'off-task';
  marks: string[];
  /** Marks inside the gap that fire all window long: counted, never credited. */
  backgroundMarks: number;
}

export function attributeHitchGaps(input: {
  gaps?: Array<{ at: number; ms: number }>;
  longTasks?: Array<{ startTime: number; duration: number }>;
  marks?: Array<{ label: string; at: number }>;
}): HitchGapAttribution[];
export function formatHitchGapAttribution(
  attributed: HitchGapAttribution[] | null | undefined,
): string;

export function summarizeHitchPhase(sample: unknown): HitchPhaseSummary;
export function combatHitchCost(leg: HitchLegSample | null | undefined): {
  worstGapMs: number;
  stallsOver150: number;
  stallsOver50: number;
  programsDelta: number;
  texturesDelta: number;
};
export function compareNythraxisHitchLegs(
  cold: HitchLegSample | null | undefined,
  warm: HitchLegSample | null | undefined,
): HitchCompare;
export function formatNythraxisHitchCompare(compare: HitchCompare): string;
