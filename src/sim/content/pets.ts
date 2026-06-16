// src/sim/content/pets.ts — class pet templates (summoned, not spawned in the world).
// These mob templates are never placed in a camp; the sim conjures them from an
// ability effect (e.g. the warlock's Summon Imp/Voidwalker) and assigns them an owner.
//
// Balance (level cap 20). Reference — warlock Shadow Bolt avg/ hit: 15.5 (L1) ->
// 27.5 (L8) -> 47.5 (L14) -> 76 (L20), i.e. ~9 -> 25 DPS. Pets are tuned to sit
// clearly below the master's own output and to scale smoothly with level.

import type { MobTemplate } from '../types';

export const PET_MOBS: Record<string, MobTemplate> = {
  // Imp (learned L5) — ranged DPS demon. Heels at your side and auto-casts Firebolt
  // at your target. Firebolt = min..max + perLevel*(level-1) every `speed`s, tuned to
  // ~45% of the warlock's Shadow Bolt DPS: ~11/hit @L5 -> ~29/hit @L20 (~4 -> ~11 DPS).
  // Squishy (it never melees), so HP stays low.
  warlock_imp: {
    id: 'warlock_imp', name: 'Imp', minLevel: 1, maxLevel: 1, family: 'humanoid',
    hpBase: 28, hpPerLevel: 7, dmgBase: 1, dmgPerLevel: 0.4, attackSpeed: 2.0,
    armorPerLevel: 2, moveSpeed: 7, aggroRadius: 0, loot: [],
    scale: 0.6, color: 0xff5522, // fel-red tint applied by the renderer
    petRanged: { min: 4, max: 8, range: 30, speed: 2.5, school: 'fire', name: 'Firebolt', perLevel: 1.2 },
  },
  // Voidwalker (learned L10) — tank demon. Durable melee guardian that Growls/taunts
  // to hold threat (petGrowls), the demonic analogue of a tamed beast. HP ~1.5x the
  // warlock's (60+20/lvl: 240 @L10, 440 @L20), high armor, deliberately modest damage —
  // it holds aggro by taunting, not by out-DPSing. HP/damage scale via createMob.
  warlock_voidwalker: {
    id: 'warlock_voidwalker', name: 'Voidwalker', minLevel: 1, maxLevel: 1, family: 'humanoid',
    hpBase: 60, hpPerLevel: 20, dmgBase: 2, dmgPerLevel: 1.2, attackSpeed: 2.0,
    armorPerLevel: 16, moveSpeed: 7, aggroRadius: 0, loot: [],
    scale: 1.4, color: 0x6a3aa0, // void-purple tint applied by the renderer
    petGrowls: true, // tank demon: Growls/taunts like a tamed beast
  },
};
