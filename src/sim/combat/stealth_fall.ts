// Class stealth survives a fall (Stalk and the rogue stealths).
//
// Taking or dealing real damage breaks stealth (combat/damage.ts). Environmental
// fall damage used to take a cat out of Stalk, or a rogue out of Duskveil or
// Smokefade, the moment they landed, which made dropping off a ledge onto prey
// impossible. A fall is not an attack: nobody struck the player and nobody saw
// it, so a null-source 'Falling' hit no longer breaks these class stealths.
// Every other stealth-kind aura (Greater Invisibility, the invisibility
// potion, a quest disguise) and every other damage source keep the old rule.
//
// Pure predicate, no rng and no mutation, so damage.ts stays the one funnel
// that decides whether breakStealth runs.
import type { Entity } from '../types';

/** The environmental damage label the movement kernel stamps on a fall
 *  (player_motion.ts). */
export const FALLING_DAMAGE_LABEL = 'Falling';
/** Stalk's aura id: the bare ability id selfBuffAuraId gives its stealth buff. */
export const STALK_AURA_ID = 'prowl';
/** The class stealth auras a fall leaves in place: Stalk (druid), Duskveil
 *  and Smokefade (rogue), each the bare ability id of its stealth buff. */
export const FALL_SAFE_STEALTH_AURA_IDS: ReadonlySet<string> = new Set([
  STALK_AURA_ID,
  'stealth',
  'vanish',
]);

/** Does this hit leave the target's stealth in place? True only for fall
 *  damage (no source, the 'Falling' label) on a target hidden by one of the
 *  fall-safe class stealths. */
export function fallDamageKeepsStealth(
  source: Entity | null,
  target: Entity,
  ability: string | null,
): boolean {
  if (source !== null || ability !== FALLING_DAMAGE_LABEL) return false;
  return target.auras.some(
    (aura) => aura.kind === 'stealth' && FALL_SAFE_STEALTH_AURA_IDS.has(aura.id),
  );
}
