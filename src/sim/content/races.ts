// Playable races of Valdris, four per faction (data-as-code; see
// docs/design/valdris-continent.md and the lore doc it references).
//
// A race is a faction, a cosmetic base aspect (body scale + a subtle model
// tint the renderer applies), and ONE passive racial trait, WoW-style but
// from our own lore. Racials are deliberately small (1-5%) so the race+class
// combination flavors a build without ever being a mandatory min-max pick.
// Characters saved before races existed load as 'human'; the human racial is
// rested-XP only, so a legacy character's combat numbers stay byte-identical.
// Racial names/descriptions are client-side i18n (races.racial* keys); the
// effects here are the single source recalcPlayerStats and the rested-XP
// accrual read.

import type { PlayerFaction, PlayerRace, RaceDef } from '../types';

export const RACES: Record<PlayerRace, RaceDef> = {
  // The Kael Empire: northern heartland, imperial power.
  // Promise of the Landing: rested XP accrues 25% faster.
  human: {
    id: 'human',
    faction: 'kael',
    scale: 1.0,
    tint: 0xd8c9a8,
    racial: { restedRatePct: 0.25 },
  },
  // Stoneblood: armor +5%.
  dwarf: { id: 'dwarf', faction: 'kael', scale: 0.85, tint: 0xc98f66, racial: { armorPct: 0.05 } },
  // Cogwise: intellect +5%.
  gnome: { id: 'gnome', faction: 'kael', scale: 0.72, tint: 0xb8d47a, racial: { intPct: 0.05 } },
  // Exile's Discipline: spell pushback reduced 20%.
  elf_exile: {
    id: 'elf_exile',
    faction: 'kael',
    scale: 1.02,
    tint: 0xd8cfe8,
    racial: { castPushbackReduction: 0.2 },
  },
  // The Confederation of Veth: western reaches, shadow and ice.
  // Twilight Grace: dodge +1%.
  elf: { id: 'elf', faction: 'veth', scale: 1.02, tint: 0x9fd0b0, racial: { dodge: 0.01 } },
  // Fae Cunning: crit +1%.
  dark_fae: { id: 'dark_fae', faction: 'veth', scale: 0.9, tint: 0x9b7fd4, racial: { crit: 0.01 } },
  // Winterhide: stamina +3%.
  frost_kin: {
    id: 'frost_kin',
    faction: 'veth',
    scale: 1.1,
    tint: 0x8fc3e8,
    racial: { staPct: 0.03 },
  },
  // Silent Blade: agility +3%.
  shadow_walker: {
    id: 'shadow_walker',
    faction: 'veth',
    scale: 1.0,
    tint: 0x8a8fa8,
    racial: { agiPct: 0.03 },
  },
  // The Domain of Ossara: southern desert, ancient faith.
  // Sunforged: maximum health +3%.
  desert_clan: {
    id: 'desert_clan',
    faction: 'ossara',
    scale: 1.0,
    tint: 0xd9a05a,
    racial: { maxHpPct: 0.03 },
  },
  // Glass Attunement: spell power +5%.
  sand_mage: {
    id: 'sand_mage',
    faction: 'ossara',
    scale: 0.95,
    tint: 0xe8d089,
    racial: { spellPowerPct: 0.05 },
  },
  // Enduring March: spirit +5%.
  nomad: { id: 'nomad', faction: 'ossara', scale: 1.0, tint: 0xc9b389, racial: { spiPct: 0.05 } },
  // Quarry Might: strength +3%.
  stone_warden: {
    id: 'stone_warden',
    faction: 'ossara',
    scale: 1.12,
    tint: 0xa8a094,
    racial: { strPct: 0.03 },
  },
};

// Stable creation-screen order: Kael, then Veth, then Ossara.
export const RACE_LIST: PlayerRace[] = [
  'human',
  'dwarf',
  'gnome',
  'elf_exile',
  'elf',
  'dark_fae',
  'frost_kin',
  'shadow_walker',
  'desert_clan',
  'sand_mage',
  'nomad',
  'stone_warden',
];

export const FACTION_LIST: PlayerFaction[] = ['kael', 'veth', 'ossara'];

export function isPlayerRace(value: unknown): value is PlayerRace {
  return typeof value === 'string' && value in RACES;
}

// A player's faction is a pure function of their race.
export function factionOfRace(race: PlayerRace): PlayerFaction {
  return RACES[race].faction;
}

export function racesOfFaction(faction: PlayerFaction): PlayerRace[] {
  return RACE_LIST.filter((r) => RACES[r].faction === faction);
}
