// Source Cave contributor tier profiles: one deterministic stat and identity
// profile per developer tier. These profiles affect only the tribute mobs inside
// the Source Cave; they do not grant player power to contributors themselves.

import { type DevTierKey, devTierForMergedPrs } from '../dev_tier';

export type SourceCaveTierProfileKey = DevTierKey | 'unranked';

export interface SourceCaveTierProfile {
  key: SourceCaveTierProfileKey;
  level: number;
  hpMult: number;
  dmgMult: number;
  scale: number;
  elite: boolean;
  boss: boolean;
  visualKey?: string;
  color?: number;
  /** Item id rendered as the held mainhand weapon (render-only, rides wire `mh`). */
  mainhandItemId?: string;
}

// Every rung wears a pipeline-generated dev body (manifest.ts): dev_noob for
// the first rung and unranked, dev_gamer, hacker_druid, coder_hunter, and
// dev_hacker at the top. The armed rigs (hacker_druid, coder_hunter) carry a
// PER-MOB mainhand assigned at template synthesis (templates.ts
// sourceCaveTierWeaponForLogin: commit blade on architects, the hammer or
// keyboard split on runesmiths); the dev_* rigs are unarmed by design.
//
// boss stays false on every tier: the boss flag is positional (the rank-1
// contributor, applied by sourceCaveMobProfileForMergedPrs's overlay), never a
// property of a rung. A tier-level boss flag would mint one boss per 70+
// contributor and break the single-boss contract (spec.ts, the reboot chorus).
// Multipliers are calibrated for a well-equipped 10-player level-20 raid (the
// cave's audience since the wave rework), applied over the shared archetype in
// templates.ts, and validated by the scripted-raid probe
// (scripts/source_cave_raid_probe.ts). Two rules fell out of the probe:
// hp multipliers carry the difficulty (the encounter is a healer-mana
// endurance check: no drink windows between waves, so total mob hp is sized
// against the raid's whole mana budget), while PER-MOB damage stays modest on
// the swarm tiers, because a wave opens DISTRIBUTED (cohorts converge from
// every bearing and engage the nearest raider, so cloth eats mobs before
// threat consolidates): a wave's summed raw dps stays near what the healers
// can triage (~230-300), and headcount, not swing size, scales a tier. The
// affixed tiers (templates.ts) fund their mechanics FROM this budget: their
// dmgMult sits one notch under the plain-swing derivation so affix damage
// replaces white damage instead of stacking on it.
// The hp multipliers were re-derived once, when the raid loot that shipped after
// the original calibration had quietly halved the fight: the probe measured a
// 157.1s median single-target clear with ZERO p90 deaths against a design point
// of 243s and 3 deaths. Widening the combat budget to 42 roles (combatants.ts)
// recovered 155.5s to 177.7s, and the remainder is this pass: every rung's
// hpMult scaled by the SAME 1.41, so the calibrated shape between rungs (and the
// affix budget derived from it) survives untouched and only the total moves.
// dmgMult moved separately, and only on the ELITE rungs (runesmith, architect,
// worldwright, and the boss through its rung), by 1.2. The triage band above is
// saturated by the SWARM waves, not the elite ones: ten tinkerers sum to about
// 216 raw dps against the band's ~230, while three architects sum to about 148,
// so the elite rungs had headroom the swarm rungs did not. Restoring lethality
// without touching the swarm keeps deaths where the design wants them, on the
// elite beats, and keeps a distributed wave opening survivable for cloth.
// Probe matrix after the retune (20 deterministic seeds), recorded in
// docs/the-source-cave/encirclement-waves.md; re-measure there, not here.
export const SOURCE_CAVE_UNRANKED_PROFILE = {
  key: 'unranked',
  level: 19,
  hpMult: 2.25,
  dmgMult: 0.7,
  scale: 1,
  elite: false,
  boss: false,
  visualKey: 'dev_noob',
} as const satisfies SourceCaveTierProfile;

export const SOURCE_CAVE_TIER_PROFILES = {
  tinkerer: {
    key: 'tinkerer',
    level: 19,
    hpMult: 2.05,
    dmgMult: 0.8,
    scale: 1.05,
    elite: false,
    boss: false,
    visualKey: 'dev_noob',
  },
  artificer: {
    key: 'artificer',
    level: 19,
    hpMult: 2.55,
    dmgMult: 0.9,
    scale: 1.1,
    elite: false,
    boss: false,
    visualKey: 'dev_gamer',
  },
  runesmith: {
    key: 'runesmith',
    level: 20,
    hpMult: 3.5,
    dmgMult: 1.45,
    scale: 1.15,
    elite: true,
    boss: false,
    visualKey: 'hacker_druid',
  },
  architect: {
    key: 'architect',
    level: 20,
    hpMult: 5.65,
    dmgMult: 1.75,
    scale: 1.3,
    elite: true,
    boss: false,
    visualKey: 'coder_hunter',
  },
  worldwright: {
    key: 'worldwright',
    level: 20,
    hpMult: 8.45,
    dmgMult: 2.3,
    scale: 1.7,
    elite: true,
    boss: false,
    visualKey: 'dev_hacker',
    color: 0xf0c454,
  },
} as const satisfies Readonly<Record<DevTierKey, SourceCaveTierProfile>>;

// The rank-1 contributor's boss bump, on top of its (worldwright) rung: a raid
// boss pool (~13.5k hp after the hp retune above) and swings that spike a
// level-20 tank hard without the enrage-style mechanics reserved for the affix
// pass. The multipliers themselves are untouched by that retune: the boss rides
// its rung, so it scales with the encounter instead of drifting off it.
export const SOURCE_CAVE_BOSS_OVERLAY = {
  hpMult: 3.2,
  dmgMult: 2.6,
  scaleBonus: 0.15,
} as const;

export function sourceCaveTierProfileForMergedPrs(mergedPrs: number | null): SourceCaveTierProfile {
  const tier = devTierForMergedPrs(mergedPrs);
  return tier ? SOURCE_CAVE_TIER_PROFILES[tier.key as DevTierKey] : SOURCE_CAVE_UNRANKED_PROFILE;
}

export function sourceCaveMobProfileForMergedPrs(
  mergedPrs: number | null,
  boss: boolean,
): SourceCaveTierProfile {
  const tier = devTierForMergedPrs(mergedPrs);
  if (tier) return sourceCaveMobProfileForTier(tier.key as DevTierKey, boss);
  const profile = SOURCE_CAVE_UNRANKED_PROFILE;
  if (!boss) return profile;
  return bossOverlay(profile);
}

/** Fixed combat-role profile, decoupled from the contributor's displayed PR count. */
export function sourceCaveMobProfileForTier(
  tier: SourceCaveTierProfileKey,
  boss: boolean,
): SourceCaveTierProfile {
  const profile =
    tier === 'unranked' ? SOURCE_CAVE_UNRANKED_PROFILE : SOURCE_CAVE_TIER_PROFILES[tier];
  if (!boss) return profile;
  return bossOverlay(profile);
}

function bossOverlay(profile: SourceCaveTierProfile): SourceCaveTierProfile {
  return {
    ...profile,
    hpMult: profile.hpMult * SOURCE_CAVE_BOSS_OVERLAY.hpMult,
    dmgMult: profile.dmgMult * SOURCE_CAVE_BOSS_OVERLAY.dmgMult,
    scale: profile.scale + SOURCE_CAVE_BOSS_OVERLAY.scaleBonus,
    elite: true,
    boss: true,
  };
}
