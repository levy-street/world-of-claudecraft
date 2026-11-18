// The Quartered Isle's creatures: the council's servants in each art, the quarters'
// wildlife, and a named elite in each of the three ground quarters (the Gyre has no
// room for mobs). Every isle mob is level 20, the cap, on the band the other level-20
// zones share (content/galecrest.ts): regulars on Galecrest's open-ground band, named
// elites on the Wreck Warden's.
//
// Camps are `offStream`: they draw from their own private rng sub-streams, never the
// shared world-gen stream, so adding the isle's camps moves no earlier camp's draws
// (the same rule the Proving Shore follows; see the CAMPS array in data.ts).
import type { CampDef, MobTemplate } from '../types';

/** Where the Remnant stands guard: in the lee of the Fallen Giant (the Heavestone POI
 *  at (-122, 2306)), clear of the statue head, its block and the broken columns. */
export const REMNANT_CAMP_CENTER = { x: -124, z: 2292 } as const;

export const QUARTERED_ISLE_MOBS: Record<string, MobTemplate> = {
  // The council's first, failed try at the colossus that would hold Korzul: abandoned
  // half-carved, it has stood guard over its own fallen head ever since.
  remnant_first_colossus: {
    id: 'remnant_first_colossus',
    name: 'Remnant of the First Colossus',
    minLevel: 20,
    maxLevel: 20,
    family: 'elemental',
    hpBase: 155,
    hpPerLevel: 34,
    dmgBase: 17,
    dmgPerLevel: 3.0,
    attackSpeed: 2.3,
    armorPerLevel: 17, // dressed granite over raw rock
    moveSpeed: 8,
    aggroRadius: 14, // it still watches the ground the council gave it
    elite: true,
    loot: [{ copper: 100, chance: 1 }],
    scale: 1,
    // two and a half players tall: a player's melee reaches it from its stone, not
    // from inside the model (combat/player_attack_reach.ts)
    bodyRadius: 1.6,
    color: 0xb59a7a,
  },
};

export const QUARTERED_ISLE_CAMPS: CampDef[] = [
  {
    mobId: 'remnant_first_colossus',
    center: { ...REMNANT_CAMP_CENTER },
    radius: 5,
    count: 1,
    offStream: true,
  },
];
