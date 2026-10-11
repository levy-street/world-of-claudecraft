// The Reputation tab's pure view core: one row per allied faction with the
// standing tier, the progress inside that tier and the tier that comes next,
// plus the day summary the tab shows beside them. DOM-free and clock-free (the
// window hands in `nowMs`), so tests and both hosts read the same decisions.
// The sim owns the standing model (src/sim/factions.ts): thresholds, tiers and
// the level-15 cap come from there, never re-derived here.
import {
  FACTION_IDS,
  FACTIONS,
  type FactionId,
  LOW_LEVEL_MAX_STANDING,
  MAX_STANDING,
  maxStandingForLevel,
  STANDING_TIERS,
  type StandingTier,
  standingProgress,
} from '../../../sim/factions';
import type { WorldQuestProgress } from '../../../sim/types';
import { factionEmblemImageUrl } from '../../currency_art';

export interface ReputationRowView {
  readonly factionId: FactionId;
  readonly hubZoneId: string;
  /** The faction's emblem art for the row's crest (`factionEmblemImageUrl`, the
   *  same art the world quest card shows for standing); null paints the bare frame. */
  readonly emblemUrl: string | null;
  readonly tier: StandingTier;
  /** The tier the bar fills toward; null at Champion. */
  readonly nextTier: StandingTier | null;
  /** Cumulative standing, clamped the way the sim clamps it. */
  readonly current: number;
  /** Progress inside the current tier: points earned and points required. */
  readonly tierProgress: number;
  readonly tierRequired: number;
  /** Whole percent of the current tier filled (100 at Champion). */
  readonly percent: number;
  /** True while the character's level caps standing below this row's next tier. */
  readonly cappedByLevel: boolean;
  /** The standing cap the level imposes when `cappedByLevel` (Trusted for 5-15). */
  readonly levelCap: number;
}

export interface ReputationDayView {
  /** World quests completed today out of the ones on the character's board. */
  readonly completed: number;
  readonly total: number;
  /** Milliseconds until the daily reset; 0 when the expiry is unknown or past. */
  readonly resetsInMs: number;
}

export interface ReputationView {
  readonly rows: readonly ReputationRowView[];
  readonly day: ReputationDayView;
  /** Every tier in ascending order, for the legend. */
  readonly tiers: readonly StandingTier[];
}

export interface ReputationViewInput {
  readonly factions: Readonly<Partial<Record<FactionId, number>>>;
  readonly level: number;
  readonly worldQuestLog: ReadonlyMap<string, WorldQuestProgress>;
  readonly worldQuestExpiresAtMs: number;
  readonly nowMs: number;
}

export function buildReputationRow(
  factionId: FactionId,
  standing: number,
  level: number,
): ReputationRowView {
  const progress = standingProgress(standing);
  const levelCap = maxStandingForLevel(level);
  const cappedByLevel = progress.tierNext !== null && progress.tierNext > levelCap;
  return {
    factionId,
    hubZoneId: FACTIONS[factionId].hub.zoneId,
    emblemUrl: factionEmblemImageUrl(factionId),
    tier: progress.tier,
    nextTier:
      progress.tierNext === null
        ? null
        : (STANDING_TIERS[STANDING_TIERS.indexOf(progress.tier) + 1] ?? null),
    current: progress.current,
    tierProgress: progress.tierProgress,
    tierRequired: progress.tierRequired,
    percent: progress.percent,
    cappedByLevel,
    levelCap,
  };
}

export function buildReputationView(input: ReputationViewInput): ReputationView {
  const rows = FACTION_IDS.map((id) =>
    buildReputationRow(id, input.factions[id] ?? 0, input.level),
  );
  let completed = 0;
  for (const progress of input.worldQuestLog.values()) {
    if (progress.state === 'completed') completed++;
  }
  const expires = input.worldQuestExpiresAtMs;
  const resetsInMs =
    Number.isFinite(expires) && Number.isFinite(input.nowMs) && expires > input.nowMs
      ? expires - input.nowMs
      : 0;
  return {
    rows,
    day: { completed, total: input.worldQuestLog.size, resetsInMs },
    tiers: STANDING_TIERS,
  };
}

/** The standing ceiling the tab reports as the end of the track. */
export const REPUTATION_MAX_STANDING = MAX_STANDING;
/** The ceiling levels 5 to 15 see, so the tab can say what lifts it. */
export const REPUTATION_LOW_LEVEL_CAP = LOW_LEVEL_MAX_STANDING;
