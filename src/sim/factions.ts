// Factions and standing progression: the deterministic simulation leaf for
// allied faction identity, zone attribution, standing tiers, and reputation
// awards. Pure functions; zero RNG, no wall clock, no DOM/Three.js imports.

import type { PlayerMeta } from './sim';
import type { WorldQuestDef } from './types';

export const FACTION_IDS = ['rift_watch', 'church_order', 'automatons'] as const;
export type FactionId = (typeof FACTION_IDS)[number];

export interface FactionDef {
  readonly id: FactionId;
  readonly name: string;
  readonly hub: {
    readonly name: string;
    readonly zoneId: string;
  };
  readonly zones: readonly string[];
}

export const FACTIONS: Readonly<Record<FactionId, FactionDef>> = Object.freeze({
  rift_watch: Object.freeze({
    id: 'rift_watch',
    name: 'Rift Watch',
    hub: Object.freeze({
      name: 'Drifthaven',
      zoneId: 'palmreach',
    }),
    zones: Object.freeze([
      'farshore',
      'farshore_isle',
      'palmreach',
      'galecrest',
      'willowfen',
      'veiled_hollow',
    ]),
  }),
  church_order: Object.freeze({
    id: 'church_order',
    name: 'Church Order',
    hub: Object.freeze({
      name: 'Brother Aldric',
      zoneId: 'eastbrook_vale',
    }),
    zones: Object.freeze([
      'eastbrook_vale',
      'zone1',
      'mirefen_marsh',
      'zone2',
      'thornpeak_heights',
      'zone3',
      'nightbloom',
      'wraithwood',
    ]),
  }),
  automatons: Object.freeze({
    id: 'automatons',
    name: 'Automatons',
    hub: Object.freeze({
      name: 'Wyrmwatch',
      zoneId: 'drakelands',
    }),
    zones: Object.freeze(['drakelands', 'frostveil', 'amberfall', 'evergarden']),
  }),
});

/** Static zone-to-faction lookup table for all 14 overworld zones and their aliases. */
export const ZONE_TO_FACTION: Readonly<Record<string, FactionId>> = Object.freeze({
  // Rift Watch (5 zones)
  farshore: 'rift_watch',
  farshore_isle: 'rift_watch',
  palmreach: 'rift_watch',
  galecrest: 'rift_watch',
  willowfen: 'rift_watch',
  veiled_hollow: 'rift_watch',

  // Church Order (5 zones)
  eastbrook_vale: 'church_order',
  zone1: 'church_order',
  mirefen_marsh: 'church_order',
  zone2: 'church_order',
  thornpeak_heights: 'church_order',
  zone3: 'church_order',
  nightbloom: 'church_order',
  wraithwood: 'church_order',

  // Automatons (4 zones)
  drakelands: 'automatons',
  frostveil: 'automatons',
  amberfall: 'automatons',
  evergarden: 'automatons',
});

/** Return the faction that owns the given zone, or null for neutral/tutorial zones. */
export function factionForZone(zoneId: string): FactionId | null {
  return ZONE_TO_FACTION[zoneId] ?? null;
}

/** Return the display name of a faction. */
export function factionDisplayName(factionId: FactionId): string {
  return FACTIONS[factionId]?.name ?? factionId;
}

// ---------------------------------------------------------------------------
// Standing tiers & thresholds
// ---------------------------------------------------------------------------

export const STANDING_TIERS = [
  'unknown',
  'recognized',
  'trusted',
  'proven',
  'vanguard',
  'champion',
] as const;

export type StandingTier = (typeof STANDING_TIERS)[number];

export const STANDING_THRESHOLDS: Readonly<Record<StandingTier, number>> = Object.freeze({
  unknown: 0,
  recognized: 1_000,
  trusted: 3_000,
  proven: 7_000,
  vanguard: 13_000,
  champion: 20_000,
});

export const MAX_STANDING = STANDING_THRESHOLDS.champion;
export const LOW_LEVEL_MAX_STANDING = STANDING_THRESHOLDS.trusted; // 3,000 cap for levels 5-15

/** Generic display labels for standing tiers. */
export const STANDING_TIER_LABELS: Readonly<Record<StandingTier, string>> = Object.freeze({
  unknown: 'Unknown',
  recognized: 'Recognized',
  trusted: 'Trusted',
  proven: 'Proven',
  vanguard: 'Vanguard',
  champion: 'Champion',
});

/** Thematic faction-specific flavor titles for each standing tier. */
export const FACTION_TIER_TITLES: Readonly<
  Record<FactionId, Readonly<Record<StandingTier, string>>>
> = Object.freeze({
  rift_watch: Object.freeze({
    unknown: 'Outsider',
    recognized: 'Watcher',
    trusted: 'Riftwalker',
    proven: 'Warden',
    vanguard: 'Riftwarden',
    champion: 'Champion',
  }),
  church_order: Object.freeze({
    unknown: 'Outsider',
    recognized: 'Acolyte',
    trusted: 'Keeper',
    proven: 'Templar',
    vanguard: 'Dawnkeeper',
    champion: 'Champion',
  }),
  automatons: Object.freeze({
    unknown: 'Outsider',
    recognized: 'Operator',
    trusted: 'Mechanist',
    proven: 'Artificer',
    vanguard: 'Forgemaster',
    champion: 'Champion',
  }),
});

/** Determine the current standing tier from cumulative reputation points. */
export function standingTierForReputation(reputation: number): StandingTier {
  const points = Math.max(0, Math.floor(reputation));
  if (points >= STANDING_THRESHOLDS.champion) return 'champion';
  if (points >= STANDING_THRESHOLDS.vanguard) return 'vanguard';
  if (points >= STANDING_THRESHOLDS.proven) return 'proven';
  if (points >= STANDING_THRESHOLDS.trusted) return 'trusted';
  if (points >= STANDING_THRESHOLDS.recognized) return 'recognized';
  return 'unknown';
}

/** Return the thematic title for a character's standing in a specific faction. */
export function factionTierTitle(factionId: FactionId, reputation: number): string {
  const tier = standingTierForReputation(reputation);
  return FACTION_TIER_TITLES[factionId]?.[tier] ?? STANDING_TIER_LABELS[tier];
}

export interface StandingProgress {
  readonly current: number;
  readonly tier: StandingTier;
  readonly tierStart: number;
  readonly tierNext: number | null;
  readonly tierProgress: number;
  readonly tierRequired: number;
  readonly percent: number;
}

/** Calculate detailed progress towards the next standing tier. */
export function standingProgress(reputation: number): StandingProgress {
  const current = Math.max(0, Math.min(MAX_STANDING, Math.floor(reputation)));
  const tier = standingTierForReputation(current);
  const tierIndex = STANDING_TIERS.indexOf(tier);
  const tierStart = STANDING_THRESHOLDS[tier];
  const nextTier = tierIndex < STANDING_TIERS.length - 1 ? STANDING_TIERS[tierIndex + 1] : null;

  if (nextTier === null) {
    return {
      current,
      tier,
      tierStart,
      tierNext: null,
      tierProgress: current - tierStart,
      tierRequired: 0,
      percent: 100,
    };
  }

  const tierNext = STANDING_THRESHOLDS[nextTier];
  const tierRequired = tierNext - tierStart;
  const tierProgress = current - tierStart;
  const percent =
    tierRequired > 0 ? Math.min(100, Math.floor((tierProgress / tierRequired) * 100)) : 100;

  return {
    current,
    tier,
    tierStart,
    tierNext,
    tierProgress,
    tierRequired,
    percent,
  };
}

/** Maximum standing reputation a player can reach at their current level. */
export function maxStandingForLevel(level: number): number {
  return level <= 15 ? LOW_LEVEL_MAX_STANDING : MAX_STANDING;
}

// ---------------------------------------------------------------------------
// World quest standing rewards
// ---------------------------------------------------------------------------

/** Amount of standing awarded by a World Quest based on character level and faction. */
export function worldQuestStandingReward(quest: WorldQuestDef, playerLevel: number): number {
  if (playerLevel <= 15) {
    // Bracket 5-15: 30 reputation per WQ (6 Eastbrook + Mirefen WQs = 180 rep/day)
    return 30;
  }
  // Bracket 16-20: 14 non-tutorial zones (synchronized at 400 rep/day each)
  const faction = worldQuestFaction(quest);
  if (faction === 'automatons') {
    // 4 zones * 100 = 400 rep/day
    return 100;
  }
  // rift_watch (5 zones * 80 = 400) and church_order (5 zones * 80 = 400)
  return 80;
}

/** Determine the faction for a World Quest (explicit override or derived from zone). */
export function worldQuestFaction(quest: WorldQuestDef): FactionId {
  return (
    (quest as { faction?: FactionId }).faction ?? factionForZone(quest.zoneId) ?? 'church_order'
  );
}

// ---------------------------------------------------------------------------
// Faction standing state & mutation
// ---------------------------------------------------------------------------

export function freshFactionReputation(): Record<FactionId, number> {
  return {
    rift_watch: 0,
    church_order: 0,
    automatons: 0,
  };
}

export function sanitizeFactionReputation(raw: unknown): Record<FactionId, number> {
  const result = freshFactionReputation();
  if (!raw || typeof raw !== 'object') return result;
  const obj = raw as Record<string, unknown>;
  for (const id of FACTION_IDS) {
    const val = obj[id];
    if (typeof val === 'number' && Number.isFinite(val)) {
      result[id] = Math.max(0, Math.min(MAX_STANDING, Math.floor(val)));
    }
  }
  return result;
}

export interface AwardStandingResult {
  readonly gained: number;
  readonly total: number;
  readonly tier: StandingTier;
  /** The tier before the award; differs from `tier` exactly when a new tier was reached. */
  readonly previousTier: StandingTier;
  readonly capped: boolean;
}

/** Award faction reputation to PlayerMeta, respecting level caps. Pure state mutation. */
export function awardFactionReputation(
  meta: PlayerMeta,
  factionId: FactionId,
  amount: number,
  playerLevel: number,
): AwardStandingResult {
  if (!meta.factions) {
    meta.factions = freshFactionReputation();
  }
  const current = meta.factions[factionId] ?? 0;
  const cap = maxStandingForLevel(playerLevel);
  const add = Math.max(0, Math.floor(amount));
  const newTotal = Math.min(cap, current + add);
  const gained = newTotal - current;
  meta.factions[factionId] = newTotal;
  const tier = standingTierForReputation(newTotal);
  const previousTier = standingTierForReputation(current);
  const capped = current + add > cap;
  return { gained, total: newTotal, tier, previousTier, capped };
}
