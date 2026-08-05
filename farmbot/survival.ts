// Pure emergency-button picking for the combat survival rule (phase 11): one
// defensive action per tick, in priority order, or null. No IO, no clock: the
// cooldown mirror rides the player entity, the shared potion cooldown rides
// the caller's lastPotionAtMs (updated on use).
//
//   hp < 40% -> Ward of Faith (divine_protection: absorb, offGcd, 180s cd)
//   hp < 20% -> Last Rite (lay_on_hands: flat heal, 600s cd)
//   hp < 35% -> best potionHp potion in the bags (shared 120s potion cd)
//
// The two casts are paladin-only by known-list membership, so other classes
// simply never match them; the potion arm is class-agnostic.

import type { ResolvedAbility } from '../src/sim/sim';
import { type Entity, type InvSlot, type ItemDef, POTION_COOLDOWN } from '../src/sim/types';

export const DIVINE_PROTECTION_ID = 'divine_protection'; // Ward of Faith
export const LAY_ON_HANDS_ID = 'lay_on_hands'; // Last Rite

const DIVINE_PROTECTION_HP_FRAC = 0.4;
const LAY_ON_HANDS_HP_FRAC = 0.2;
const POTION_HP_FRAC = 0.35;

export interface EmergencyAction {
  kind: 'cast' | 'use';
  id: string;
  // How to issue a cast: Ward of Faith is targetless (castAbility), Last
  // Rite is friendly-targeted (castAbilityOn self). Potions use useItem.
  selfTarget: boolean;
}

export function pickEmergencyAction(
  known: readonly ResolvedAbility[],
  player: Entity,
  inventory: readonly InvSlot[],
  itemDef: (itemId: string) => ItemDef | undefined,
  lastPotionAtMs: number,
  nowMs: number,
): EmergencyAction | null {
  const hpFrac = player.maxHp > 0 ? player.hp / player.maxHp : 1;
  const knownId = (id: string): boolean => known.some((k) => k.def.id === id);
  const offCd = (id: string): boolean => (player.cooldowns.get(id) ?? 0) <= 0;

  if (
    hpFrac < DIVINE_PROTECTION_HP_FRAC &&
    knownId(DIVINE_PROTECTION_ID) &&
    offCd(DIVINE_PROTECTION_ID)
  ) {
    // Ward of Faith: absorb, instant, offGcd, requiresTarget false.
    return { kind: 'cast', id: DIVINE_PROTECTION_ID, selfTarget: false };
  }
  const gcdFree = !(player.gcdRemaining && player.gcdRemaining > 0);
  if (
    hpFrac < LAY_ON_HANDS_HP_FRAC &&
    knownId(LAY_ON_HANDS_ID) &&
    offCd(LAY_ON_HANDS_ID) &&
    gcdFree
  ) {
    // Last Rite: free, friendly-targeted, so it needs an explicit self target.
    return { kind: 'cast', id: LAY_ON_HANDS_ID, selfTarget: true };
  }
  if (hpFrac < POTION_HP_FRAC && nowMs - lastPotionAtMs >= POTION_COOLDOWN * 1000) {
    let best: string | null = null;
    let bestPower = 0;
    for (const slot of inventory) {
      const def = itemDef(slot.itemId);
      if (def?.kind !== 'potion') continue;
      const power = def.potionHp ?? 0;
      if (power > bestPower) {
        bestPower = power;
        best = slot.itemId;
      }
    }
    if (best) return { kind: 'use', id: best, selfTarget: false };
  }
  return null;
}
