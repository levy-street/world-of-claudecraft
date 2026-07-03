// Pure predicates for the optional "Auto-Attack on Ability Use" QoL setting: given
// an ability's (rank-resolved) effects, decide whether using it should also engage
// the player's white-swing auto-attack, and given the player's current target, decide
// whether engaging would actually connect (rather than error). Host-agnostic (type-only
// sim import), so a Vitest drives them directly; the HUD gates on the player's setting.

import type { AbilityEffect, Entity } from '../sim/types';

// Auto-attack classification of EVERY AbilityEffect type. Because this is a Record over
// the discriminant union, adding a new effect to `AbilityEffect` (src/sim/types.ts) is a
// COMPILE error here until it is classified, which is what keeps the sets below honest:
//   'damage'  - deals damage to a target, so the ability is an "attack" (Sinister Strike,
//               Fireball, Mortal Strike, Eviscerate, the AOEs) and should start auto-attack.
//   'breakCC' - crowd control that BREAKS when the target takes damage. The sim flags these
//               auras `breaksOnDamage` at their emit sites (`incapacitate`/`polymorph` in
//               combat/effect_dispatch.ts); a swing would shatter the CC, so an ability
//               applying one must NEVER start auto-attack even when it also deals damage
//               (gouge does both). A future break-on-damage CC effect MUST be classified
//               here, not 'other', or a damage+CC ability built on it would break its own CC.
//   'other'   - heal/buff/utility/non-breaking CC (stun, root, slow): irrelevant either way.
type AutoAttackClass = 'damage' | 'breakCC' | 'other';

const EFFECT_CLASS: Record<AbilityEffect['type'], AutoAttackClass> = {
  weaponDamage: 'damage',
  weaponStrike: 'damage',
  directDamage: 'damage',
  interrupt: 'other',
  finisherDamage: 'damage',
  dot: 'damage',
  aoeDamage: 'damage',
  groundAoE: 'damage',
  aoeRoot: 'damage',
  drainTick: 'damage',
  judgement: 'damage',
  incapacitate: 'breakCC',
  polymorph: 'breakCC',
  heal: 'other',
  hot: 'other',
  absorb: 'other',
  imbue: 'other',
  lifeTap: 'other',
  buffTarget: 'other',
  slow: 'other',
  root: 'other',
  stun: 'other',
  aoeAttackSpeed: 'other',
  aoeAttackPower: 'other',
  selfBuff: 'other',
  finisherHaste: 'other',
  finisherStun: 'other',
  gainResource: 'other',
  selfDamagePctMax: 'other',
  charge: 'other',
  sunder: 'other',
  taunt: 'other',
  tamePet: 'other',
  dismissPet: 'other',
  summonPet: 'other',
  summonDemon: 'other',
};

/**
 * Whether using an ability with these effects should engage auto-attack: it deals
 * damage and applies no damage-breakable CC. The caller is responsible for gating
 * this on the player's `startAttackOnAbilityUse` setting AND on `hasAutoAttackTarget`
 * (some damaging abilities are requiresTarget:false self/ground AOEs that cast with no
 * hostile target, where an unconditional engage would error).
 */
export function abilityStartsAutoAttack(effects: AbilityEffect[]): boolean {
  let damaging = false;
  for (const e of effects) {
    const cls = EFFECT_CLASS[e.type];
    if (cls === 'breakCC') return false;
    if (cls === 'damage') damaging = true;
  }
  return damaging;
}

/**
 * Whether the player's current target is a live, hostile MOB, i.e. one a white swing
 * would actually engage. Gating the auto-attack convenience on this keeps a targetless
 * AOE (Arcane Explosion, Frost Nova, Thunder Clap, ...) from flashing a spurious
 * "Invalid attack target." toast on every cast. Only mobs carry `hostile:true`
 * (players/NPCs default false) and the server mirrors the flag onto the wire, so the
 * same read holds for the offline Sim and the online ClientWorld.
 *
 * Deliberately narrower than the sim's `isHostileTo`, which also treats an enemy player
 * in an active duel/arena as hostile (players are `hostile:false`): replicating that PvP
 * state on the client is not worth it, so the convenience is PvE-mob scope. That is safe,
 * no error, just no auto-engage in PvP, where the explicit Attack button still works.
 */
export function hasAutoAttackTarget(target: Entity | null | undefined): boolean {
  return !!target && !target.dead && target.hostile;
}
