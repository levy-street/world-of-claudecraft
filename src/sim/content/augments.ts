// ---------------------------------------------------------------------------
// 2v2 Fiesta — Augments (data-as-code).
//
// Augments are the dopamine engine of Fiesta: at each of three escalating waves
// every fighter is offered THREE class-appropriate augments and keeps the one
// they pick for the rest of the bout (it survives death/respawn). They are NOT
// auras — auras get wiped when a fighter is readied — so each pick folds into a
// flat `TalentEffect` that is accumulated into the player's effective
// `TalentModifiers` (exactly like a talent), plus an optional `special` bag for
// the handful of effects the modifier pipeline can't express (lifesteal, move
// speed). See `Sim.fiestaApplyAugments`.
//
// Tiers escalate with the wave — Silver (wave 1) → Gold (wave 2) → Prismatic
// (wave 3) — mirroring League's Arena cadence: each pick should feel bigger and
// more build-defining than the last. Zero DOM/sim deps so it stays unit-testable
// and shared verbatim by the authoritative Sim and the display-only net client.
// ---------------------------------------------------------------------------

import type { AuraKind, PlayerClass } from '../types';
import type { Role, TalentEffect } from './talents';

export type AugmentTier = 'silver' | 'gold' | 'prismatic';

// Effects the flat-modifier pipeline can't express. Aggregated per player into
// `PlayerMeta.fiestaSpecial` and read on the combat/movement hot paths.
export interface AugmentSpecial {
  lifestealPct?: number; // heal attacker for this fraction of damage dealt
  moveSpeedPct?: number; // additive movement-speed bonus (0.15 = +15%)
  scorePerKill?: number; // bonus team points awarded when this player gets a kill
}

export interface AugmentDef {
  id: string;
  name: string; // English; re-localized at the client boundary by key
  description: string; // English; ditto
  tier: AugmentTier;
  // When set, offered only to these classes / roles. Undefined = universal.
  classes?: PlayerClass[];
  roles?: Role[];
  effect: TalentEffect; // folded into the player's effective TalentModifiers
  special?: AugmentSpecial;
}

// Rough archetype split so universal-but-flavored augments land on the right
// kits. Casters scale on spell damage; the rest on melee/physical.
const CASTERS: PlayerClass[] = ['mage', 'warlock', 'priest'];
const MELEE: PlayerClass[] = ['warrior', 'rogue'];
const HYBRID: PlayerClass[] = ['paladin', 'shaman', 'druid', 'hunter'];
const PHYSICAL: PlayerClass[] = [...MELEE, ...HYBRID];

// ---------------------------------------------------------------------------
// The catalog. Kept deliberately punchy — Fiesta is a party, not a spreadsheet.
// ---------------------------------------------------------------------------

export const AUGMENTS: AugmentDef[] = [
  // ---- SILVER (wave 1): solid, single-stat power spikes ------------------
  {
    id: 'aug_brutality',
    name: 'Brutality',
    tier: 'silver',
    classes: PHYSICAL,
    description: 'Your physical strikes hit 15% harder.',
    effect: { global: { meleeDmgPct: 0.15 } },
  },
  {
    id: 'aug_spellfire',
    name: 'Grimfire',
    tier: 'silver',
    classes: CASTERS,
    description: 'Your spells deal 15% more damage.',
    effect: { global: { spellDmgPct: 0.15 } },
  },
  {
    id: 'aug_toughness',
    name: 'Toughness',
    tier: 'silver',
    description: 'Gain 12% maximum health.',
    effect: { stats: { maxHpPct: 0.12 } },
  },
  {
    id: 'aug_keen_eye',
    name: 'Keen Eye',
    tier: 'silver',
    description: 'Gain 8% critical strike chance.',
    effect: { stats: { crit: 0.08 } },
  },
  {
    id: 'aug_fleetfoot',
    name: 'Fleetfoot',
    tier: 'silver',
    description: 'Move 15% faster. Run them down — or run away.',
    effect: {},
    special: { moveSpeedPct: 0.15 },
  },
  {
    id: 'aug_ironhide',
    name: 'Ironhide',
    tier: 'silver',
    description: 'Gain 250 armor and 5% dodge.',
    effect: { stats: { armor: 250, dodge: 0.05 } },
  },
  {
    id: 'aug_mending',
    name: 'Mending',
    tier: 'silver',
    roles: ['healer'],
    description: 'Your healing is 20% more potent.',
    effect: { global: { healPct: 0.2 } },
  },

  // ---- GOLD (wave 2): two-stat combos, the build starts to sing ----------
  {
    id: 'aug_warlords_might',
    name: "Warlord's Might",
    tier: 'gold',
    classes: PHYSICAL,
    description: '+25% physical damage and +10% crit. Become the threat.',
    effect: { global: { meleeDmgPct: 0.25 }, stats: { crit: 0.1 } },
  },
  {
    id: 'aug_arcane_surge',
    name: 'Arcane Surge',
    tier: 'gold',
    classes: CASTERS,
    description: '+25% spell damage and +10% crit. Light them up.',
    effect: { global: { spellDmgPct: 0.25 }, stats: { crit: 0.1 } },
  },
  {
    id: 'aug_vampirism',
    name: 'Vampirism',
    tier: 'gold',
    description: 'Heal for 15% of all damage you deal. Sustain through chaos.',
    effect: {},
    special: { lifestealPct: 0.15 },
  },
  {
    id: 'aug_juggernaut',
    name: 'Juggernaut',
    tier: 'gold',
    description: '+20% maximum health and +400 armor. Immovable.',
    effect: { stats: { maxHpPct: 0.2, armor: 400 } },
  },
  {
    id: 'aug_bloodhunter',
    name: 'Bloodhunter',
    tier: 'gold',
    description: '+18% damage of all kinds and +12% move speed.',
    effect: { global: { meleeDmgPct: 0.18, spellDmgPct: 0.18 } },
    special: { moveSpeedPct: 0.12 },
  },
  {
    id: 'aug_lightwell',
    name: 'Gravelight',
    tier: 'gold',
    roles: ['healer'],
    description: '+30% healing and +15% maximum health. Anchor your team.',
    effect: { global: { healPct: 0.3 }, stats: { maxHpPct: 0.15 } },
  },
  {
    id: 'aug_bounty_hunter',
    name: 'Bounty Hunter',
    tier: 'gold',
    description: 'Your kills are worth +1 bonus team point. Close the gap fast.',
    effect: { stats: { crit: 0.05 } },
    special: { scorePerKill: 1 },
  },

  // ---- PRISMATIC (wave 3): build-defining, screen-melting spikes ---------
  {
    id: 'aug_apex_predator',
    name: 'Apex Predator',
    tier: 'prismatic',
    classes: PHYSICAL,
    description: '+40% physical damage, +15% crit, heal for 12% of damage dealt.',
    effect: { global: { meleeDmgPct: 0.4 }, stats: { crit: 0.15 } },
    special: { lifestealPct: 0.12 },
  },
  {
    id: 'aug_archmage',
    name: 'Archmage',
    tier: 'prismatic',
    classes: CASTERS,
    description: '+45% spell damage, +15% crit, +15% maximum health.',
    effect: { global: { spellDmgPct: 0.45 }, stats: { crit: 0.15, maxHpPct: 0.15 } },
  },
  {
    id: 'aug_unkillable',
    name: 'Unkillable',
    tier: 'prismatic',
    description: '+40% maximum health, +600 armor, heal for 10% of damage dealt.',
    effect: { stats: { maxHpPct: 0.4, armor: 600 } },
    special: { lifestealPct: 0.1 },
  },
  {
    id: 'aug_overdrive',
    name: 'Overdrive',
    tier: 'prismatic',
    description: '+30% all damage, +20% crit, +20% move speed. FIESTA!',
    effect: { global: { meleeDmgPct: 0.3, spellDmgPct: 0.3 }, stats: { crit: 0.2 } },
    special: { moveSpeedPct: 0.2 },
  },
  {
    id: 'aug_avatar',
    name: 'Avatar of War',
    tier: 'prismatic',
    classes: PHYSICAL,
    description: '+25% all damage, +25% maximum health, +300 armor. Walk it down.',
    effect: { global: { meleeDmgPct: 0.25 }, stats: { maxHpPct: 0.25, armor: 300 } },
  },
  {
    id: 'aug_ascendant',
    name: 'Ascendant',
    tier: 'prismatic',
    roles: ['healer'],
    description: '+45% healing, +25% spell damage, +20% maximum health.',
    effect: { global: { healPct: 0.45, spellDmgPct: 0.25 }, stats: { maxHpPct: 0.2 } },
  },
];

export const AUGMENTS_BY_ID: Record<string, AugmentDef> = Object.fromEntries(
  AUGMENTS.map((a) => [a.id, a]),
);

// Tier offered at each 1-based wave: Silver → Gold → Prismatic.
export function tierForWave(wave: number): AugmentTier {
  return wave <= 1 ? 'silver' : wave === 2 ? 'gold' : 'prismatic';
}

// Category drives the card's type-icon and accent. Pure presentation grouping.
export type AugmentCategory = 'offense' | 'defense' | 'sustain' | 'mobility' | 'utility';

export const AUGMENT_CATEGORY: Record<string, AugmentCategory> = {
  aug_brutality: 'offense',
  aug_spellfire: 'offense',
  aug_keen_eye: 'offense',
  aug_warlords_might: 'offense',
  aug_arcane_surge: 'offense',
  aug_apex_predator: 'offense',
  aug_archmage: 'offense',
  aug_avatar: 'offense',
  aug_overdrive: 'offense',
  aug_toughness: 'defense',
  aug_ironhide: 'defense',
  aug_juggernaut: 'defense',
  aug_unkillable: 'defense',
  aug_vampirism: 'sustain',
  aug_mending: 'sustain',
  aug_lightwell: 'sustain',
  aug_ascendant: 'sustain',
  aug_fleetfoot: 'mobility',
  aug_bloodhunter: 'mobility',
  aug_bounty_hunter: 'utility',
};

export function augmentCategory(id: string): AugmentCategory {
  return AUGMENT_CATEGORY[id] ?? 'utility';
}

// ---------------------------------------------------------------------------
// Ring power-ups — the over-the-top, temporary, grab-in-the-ring buffs. Each
// applies a bundle of timed auras to whoever scoops it up, plus a glow colour
// the renderer paints on the carrier. Deliberately ridiculous.
// ---------------------------------------------------------------------------

export interface PowerupBuff {
  kind: AuraKind;
  value: number;
}

export interface PowerupDef {
  id: string;
  name: string; // English; localized client-side by id
  color: number; // pickup orb / pillar colour
  glow: number; // glow painted on the carrier
  duration: number; // seconds the buffs last
  buffs: PowerupBuff[];
}

export const POWERUPS: PowerupDef[] = [
  {
    id: 'pow_speed_demon',
    name: 'Speed Demon',
    color: 0x32e0ff,
    glow: 0x32e0ff,
    duration: 12,
    buffs: [
      { kind: 'buff_speed', value: 1.7 },
      { kind: 'buff_scale', value: 0.6 },
    ],
  },
  {
    id: 'pow_colossus',
    name: 'Colossus',
    color: 0xff8a1e,
    glow: 0xff8a1e,
    duration: 14,
    buffs: [
      { kind: 'buff_scale', value: 1.9 },
      { kind: 'slow', value: 0.82 },
    ],
  },
  {
    id: 'pow_moon_boots',
    name: 'Moon Boots',
    color: 0xb06bff,
    glow: 0xb06bff,
    duration: 14,
    buffs: [
      { kind: 'buff_jump', value: 2.8 },
      { kind: 'buff_speed', value: 1.25 },
    ],
  },
  {
    id: 'pow_berserker',
    name: 'Berserker',
    color: 0xff3535,
    glow: 0xff3535,
    duration: 10,
    buffs: [
      { kind: 'buff_ap', value: 280 },
      { kind: 'buff_speed', value: 1.2 },
    ],
  },
];

export const POWERUPS_BY_ID: Record<string, PowerupDef> = Object.fromEntries(
  POWERUPS.map((p) => [p.id, p]),
);

// Augments eligible for a given class/role at a given tier, excluding any the
// player already holds. Pure: callers do the deterministic shuffle/pick.
export function eligibleAugments(
  tier: AugmentTier,
  cls: PlayerClass,
  role: Role | null,
  owned: ReadonlySet<string>,
): AugmentDef[] {
  return AUGMENTS.filter((a) => {
    if (a.tier !== tier) return false;
    if (owned.has(a.id)) return false;
    if (a.classes && !a.classes.includes(cls)) return false;
    if (a.roles && !(role && a.roles.includes(role))) return false;
    return true;
  });
}
