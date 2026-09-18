// Pure, host-agnostic celebration plan for faction standing tiers: the
// moment a faction's standing crosses into a new tier (Recognized, Trusted,
// Proven, Vanguard, Champion), the player gets a banner, a gold chat line and
// the achievement chime, the way a deed or a gathering milestone lands.
//
// Observed as a STATE DIFF over IWorld.factions, never as a sim event: the
// standing map already reaches both hosts (the offline Sim reads PlayerMeta,
// the online mirror applies the `fac` self key), so the same observer catches
// a world-quest turn-in, a /dev rep award and any future standing source with
// no wire work. The skill level-up observer (professions/skill_level_toast_view.ts)
// is the template: silent first observation (null prev) so a login never toasts
// the character's whole history, `synced` gating so the pre-mirror all-zero
// default never becomes a baseline, and prev advanced in place so the
// per-drain no-change path allocates nothing.
//
// DOM-free and i18n-free so tests/faction_tier_celebration_view.test.ts drives
// it directly; the painter (faction_tier_celebration_painter.ts) owns the copy.

import {
  FACTION_IDS,
  type FactionId,
  STANDING_TIERS,
  type StandingTier,
  standingTierForReputation,
} from '../../../sim/factions';

/** One faction whose standing tier climbed between two snapshots. */
export interface FactionTierUp {
  factionId: FactionId;
  fromTier: StandingTier;
  toTier: StandingTier;
}

const NO_TIER_UPS: FactionTierUp[] = [];

function tierIndex(tier: StandingTier): number {
  return STANDING_TIERS.indexOf(tier);
}

/**
 * Tier crossings between two standing maps, in FACTION_IDS order. A jump over
 * several tiers reports only the tier reached (one banner, not a ladder).
 * `prev === null` is the silent first observation. Returns the shared empty
 * array when nothing climbed: this runs on every drain.
 */
export function computeFactionTierUps(
  prev: Readonly<Partial<Record<FactionId, number>>> | null,
  next: Readonly<Partial<Record<FactionId, number>>>,
): FactionTierUp[] {
  if (prev === null) return NO_TIER_UPS;
  let ups: FactionTierUp[] | null = null;
  for (const factionId of FACTION_IDS) {
    const toTier = standingTierForReputation(next[factionId] ?? 0);
    const fromTier = standingTierForReputation(prev[factionId] ?? 0);
    if (tierIndex(toTier) > tierIndex(fromTier)) {
      if (ups === null) ups = [];
      ups.push({ factionId, fromTier, toTier });
    }
  }
  return ups ?? NO_TIER_UPS;
}

export interface FactionTierObservation {
  tierUps: FactionTierUp[];
  prev: Record<FactionId, number> | null;
}

/**
 * Per-drain observation step: nothing until `synced`, a silent baseline on
 * the first synced observation, then a diff on every later one. ADVANCES ITS
 * OWN STATE: `prev` is mutated in place and the same object is returned; the
 * caller owns exactly one snapshot.
 */
export function advanceFactionTierObservation(
  synced: boolean,
  prev: Record<FactionId, number> | null,
  next: Readonly<Partial<Record<FactionId, number>>>,
): FactionTierObservation {
  if (!synced) return { tierUps: NO_TIER_UPS, prev };
  if (prev === null) {
    const baseline = {} as Record<FactionId, number>;
    for (const factionId of FACTION_IDS) baseline[factionId] = next[factionId] ?? 0;
    return { tierUps: NO_TIER_UPS, prev: baseline };
  }
  const tierUps = computeFactionTierUps(prev, next);
  for (const factionId of FACTION_IDS) {
    const value = next[factionId] ?? 0;
    if (prev[factionId] !== value) prev[factionId] = value;
  }
  return { tierUps, prev };
}

export interface FactionTierCelebrationPlan {
  /** One gold chat line each, in observation order. */
  logs: FactionTierUp[];
  /** Coalesced single plate slot: the LAST crossing of the drain plates when
   *  several land at once (the log still carries every line). */
  banner: FactionTierUp | null;
  /** At most one celebration chime per drain, standing down when the drain
   *  already chimed (a deed, a tier-up, a masterwork). */
  playSound: boolean;
  /** Motion-only flourishes; false under reducedMotion. Never gates the
   *  lines, the banner text or the chime. */
  motion: boolean;
}

/** Plan the HUD reaction to one drain's faction tier crossings. */
export function buildFactionTierCelebrationPlan(
  tierUps: readonly FactionTierUp[],
  reducedMotion: boolean,
  celebrationAlreadyChimed: boolean,
): FactionTierCelebrationPlan {
  const banner = tierUps.length > 0 ? tierUps[tierUps.length - 1] : null;
  return {
    logs: [...tierUps],
    banner,
    playSound: banner !== null && !celebrationAlreadyChimed,
    motion: banner !== null && !reducedMotion,
  };
}
