import type { MobTemplate } from '../types';

// Mage summoned pets (owner design 2026-07-11). The frost mage's Water
// Elemental: a ranged Waterbolt caster in the Emberkin mold, summoned (never
// tamed) and owned like a warlock demon (Sim.updatePet drives it). Its
// Waterbolt autos fire against the owner's target with no rotation input, and
// Water Jet is a commanded pet-bar channel: a sustained beam that leaves a
// slowing frost burn ticking on the target (pet_ai's jet rider).
export const MAGE_PET_MOBS: Record<string, MobTemplate> = {
  water_elemental: {
    id: 'water_elemental',
    name: 'Water Elemental',
    minLevel: 1,
    maxLevel: 60,
    family: 'elemental',
    // ranged caster: modest health, steady Waterbolt damage from range
    hpBase: 40,
    hpPerLevel: 14,
    dmgBase: 5,
    dmgPerLevel: 1.0,
    attackSpeed: 2.2,
    armorPerLevel: 10,
    moveSpeed: 5.2,
    aggroRadius: 8,
    loot: [],
    scale: 0.6,
    color: 0x8ed2ff,
    petRanged: {
      range: 25,
      school: 'frost',
      // Water Jet: every 4th attack channels a beam instead of a bolt, leaving
      // `total` frost damage ticking over `duration` (pet_ai, deterministic).
      // Three seconds of visibly sustained pressure: one damage tick per second
      // while the elemental remains locked into the bubble-beam channel.
      jet: { total: 30, duration: 3, interval: 1, slow: 0.6, cooldown: 8 },
    },
    petCanTaunt: false,
  },
};
