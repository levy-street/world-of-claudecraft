// Playable races of Valdris, four per faction (data-as-code; see
// docs/design/valdris-continent.md and the lore doc it references).
//
// Races are IDENTITY, not power: a race picks the character's faction and a
// cosmetic body scale. No race carries stats, abilities, or any mechanical
// edge (recalcPlayerStats never reads race), so the choice is never a
// min-max decision. Characters saved before races existed load as 'human'.

import type { PlayerFaction, PlayerRace, RaceDef } from '../types';

export const RACES: Record<PlayerRace, RaceDef> = {
  // The Kael Empire: northern heartland, imperial power.
  human: { id: 'human', faction: 'kael', scale: 1.0 },
  dwarf: { id: 'dwarf', faction: 'kael', scale: 0.85 },
  gnome: { id: 'gnome', faction: 'kael', scale: 0.72 },
  elf_exile: { id: 'elf_exile', faction: 'kael', scale: 1.02 },
  // The Confederation of Veth: western reaches, shadow and ice.
  elf: { id: 'elf', faction: 'veth', scale: 1.02 },
  dark_fae: { id: 'dark_fae', faction: 'veth', scale: 0.9 },
  frost_kin: { id: 'frost_kin', faction: 'veth', scale: 1.1 },
  shadow_walker: { id: 'shadow_walker', faction: 'veth', scale: 1.0 },
  // The Domain of Ossara: southern desert, ancient faith.
  desert_clan: { id: 'desert_clan', faction: 'ossara', scale: 1.0 },
  sand_mage: { id: 'sand_mage', faction: 'ossara', scale: 0.95 },
  nomad: { id: 'nomad', faction: 'ossara', scale: 1.0 },
  stone_warden: { id: 'stone_warden', faction: 'ossara', scale: 1.12 },
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
