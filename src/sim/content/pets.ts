// src/sim/content/pets.ts — class pet templates (summoned, not spawned in the world).
// These mob templates are never placed in a camp; the sim conjures them from an
// ability effect (e.g. the warlock's Summon Imp/Voidwalker) and assigns them an owner.

import type { MobTemplate } from '../types';

export const PET_MOBS: Record<string, MobTemplate> = {
  // Warlock starter demon. A ranged Firebolt caster (see `petRanged`): it stands
  // off and nukes rather than meleeing, and is conjured/despawned, never tamed.
  warlock_imp: {
    id: 'warlock_imp', name: 'Imp', minLevel: 1, maxLevel: 1, family: 'humanoid',
    hpBase: 24, hpPerLevel: 6, dmgBase: 1, dmgPerLevel: 0.4, attackSpeed: 2.0,
    armorPerLevel: 1, moveSpeed: 7, aggroRadius: 0, loot: [],
    scale: 0.6, color: 0xff5522, // fel-red tint applied by the renderer
    // Firebolt scales with the pet's (owner's) level: base + perLevel * (level - 1).
    petRanged: { min: 4, max: 6, range: 30, speed: 2.0, school: 'fire', name: 'Firebolt', perLevel: 1.3 },
  },
  // Warlock tank demon. A durable melee guardian that taunts (petGrowls) to hold
  // threat, the demonic analogue of a hunter's tamed beast. Melee damage/HP scale
  // through createMob; summoned/despawned, never tamed.
  warlock_voidwalker: {
    id: 'warlock_voidwalker', name: 'Voidwalker', minLevel: 1, maxLevel: 1, family: 'humanoid',
    hpBase: 60, hpPerLevel: 18, dmgBase: 2, dmgPerLevel: 1.0, attackSpeed: 2.0,
    armorPerLevel: 14, moveSpeed: 7, aggroRadius: 0, loot: [],
    scale: 1.4, color: 0x6a3aa0, // void-purple tint applied by the renderer
    petGrowls: true, // tank demon: Growls/taunts like a tamed beast
  },
};
