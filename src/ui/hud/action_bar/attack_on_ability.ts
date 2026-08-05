// Pure predicates for the optional "Auto-Attack on Ability Use" QoL setting: given
// an ability's (rank-resolved) effects, decide whether using it should also engage
// the player's white-swing auto-attack, and given the player's current target, decide
// whether engaging would actually connect (rather than error). Host-agnostic (type-only
// sim import), so a Vitest drives them directly; the HUD gates on the player's setting.

import type { AbilityEffect, Entity } from '../../../sim/types';
import type { ArenaInfo, DuelInfo } from '../../../world_api/duel_arena';

// Auto-attack classification of EVERY AbilityEffect type. Because this is a Record over
// the discriminant union, adding a new effect to `AbilityEffect` (src/sim/types.ts) is a
// COMPILE error here until it is classified, which is what keeps the sets below honest:
//   'damage'  - deals damage to a target, so the ability is an "attack" (Sinister Strike,
//               Fireball, Mortal Strike, Eviscerate, the AOEs) and should start auto-attack.
//   'breakCC' - crowd control that BREAKS when the target takes damage. The sim flags these
//               auras `breaksOnDamage` at their emit sites (`incapacitate`/`polymorph`/`aoeFear` in
//               combat/effect_dispatch.ts); a swing would shatter the CC, so an ability
//               applying one must NEVER start auto-attack even when it also deals damage
//               (gouge does both). A future break-on-damage CC effect MUST be classified
//               here, not 'other', or handled from its effect data as `aoeRoot` is below,
//               or a damage+CC ability built on it would break its own CC.
//   'other'   - heal/buff/utility/non-breaking CC (stun, root, slow): irrelevant either way.
type AutoAttackClass = 'damage' | 'breakCC' | 'other';

const EFFECT_CLASS: Record<AbilityEffect['type'], AutoAttackClass> = {
  weaponDamage: 'damage',
  weaponStrike: 'damage',
  directDamage: 'damage',
  interrupt: 'other',
  dispel: 'other',
  // Silence locks the school but does not break on damage, so it never blocks the engage.
  silence: 'other',
  aoeFear: 'breakCC',
  clearCooldowns: 'other',
  aoeAllyAbsorb: 'other',
  greaterInvisibility: 'other',
  breakRoots: 'other',
  breakControl: 'other',
  cleanseSelf: 'other',
  repositionToAim: 'other',
  blinkForward: 'other',
  finisherDamage: 'damage',
  dot: 'damage',
  extendDot: 'other',
  // Detonate-style: the consumed DoT's remaining damage lands immediately.
  consumeDot: 'damage',
  aoeDamage: 'damage',
  chainDamage: 'damage',
  aoeHeal: 'other',
  chainHeal: 'other',
  groundAoE: 'damage',
  frozenOrb: 'damage',
  aoeRoot: 'damage',
  empoweredCone: 'damage',
  consumeAura: 'other',
  drainTick: 'damage',
  judgement: 'damage',
  incapacitate: 'breakCC',
  polymorph: 'breakCC',
  heal: 'other',
  // Chronomancy Temporal Echo: places a friendly mark (its Arcane-damage-to-heal
  // conversion is separate); the ability itself deals no damage and breaks no CC.
  temporalEcho: 'other',
  massTemporalEcho: 'other',
  resurrectAlly: 'other',
  massResurrectGroup: 'other',
  perfectMoment: 'other',
  temporalHourglass: 'breakCC',
  rewind: 'other',
  feralCharge: 'other',
  hot: 'other',
  absorb: 'other',
  imbue: 'other',
  lifeTap: 'other',
  buffTarget: 'other',
  debuffTargetSource: 'other',
  slow: 'other',
  root: 'other',
  stun: 'other',
  aoeAttackSpeed: 'other',
  aoeAttackPower: 'other',
  // Choice-row talents: an AoE slow is a non-breaking snare.
  aoeSlow: 'other',
  aoeAllyAttackPower: 'other',
  aoeAllyHaste: 'other',
  aoeAllySureCrit: 'other',
  aoeKnockback: 'other',
  aoeAllyDamage: 'other',
  selfBuff: 'other',
  petBuff: 'other',
  applyDebuff: 'other',
  finisherHaste: 'other',
  enrageChance: 'other',
  finisherStun: 'other',
  gainResource: 'other',
  selfDamagePctMax: 'other',
  selfHealPctMax: 'other',
  selfHotPctMax: 'other',
  aoeAllyMaxHp: 'other',
  partyMeleeBuff: 'other',
  charge: 'other',
  sunder: 'other',
  faerieFire: 'other',
  absorbSpentResource: 'other',
  aoeTaunt: 'other',
  taunt: 'other',
  tamePet: 'other',
  dismissPet: 'other',
  summonPet: 'other',
  summonDemon: 'other',
  // Vale Cup sport moves (docs/prd/vale-cup.md): no-damage, harvest-truce
  // utility. None of them should engage auto-attack on use (the paired stun on
  // Shoulder is non-breaking CC, and nothing on the pitch deals damage).
  ballKick: 'other',
  ballPass: 'other',
  ballShoot: 'other',
  sportDash: 'other',
  sportShove: 'other',
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
    if (e.type === 'aoeRoot' && e.breakOnDamage !== undefined) return false;
    const cls = EFFECT_CLASS[e.type];
    if (cls === 'breakCC') return false;
    if (
      cls === 'damage' ||
      (e.type === 'consumeAura' && e.deal !== undefined) ||
      (e.type === 'repositionToAim' && e.landingAoe !== undefined)
    ) {
      damaging = true;
    }
  }
  return damaging;
}

/**
 * Whether the player's current target is a live target a white swing would actually
 * engage: either a hostile MOB (`hostile:true`; players/NPCs default false, and the
 * server mirrors the flag onto the wire, so the same read holds for the offline Sim and
 * the online ClientWorld), or a player who is PvP-hostile right now per
 * `isPvpHostileTarget` (an active duel/arena opponent). Gating the auto-attack
 * convenience on this keeps a targetless AOE (Arcane Explosion, Frost Nova, Thunder
 * Clap, ...) from flashing a spurious "Invalid attack target." toast on every cast.
 *
 * `pvpHostile` mirrors the sim's `isHostileTo`, which also treats an enemy player in an
 * active duel/arena as hostile (players are otherwise always `hostile:false`, since this
 * game has no open-world FFA PvP): the caller computes it via `isPvpHostileTarget` from
 * the already-mirrored `IWorld.duelInfo`/`IWorld.arenaInfo`, so no new wire state is
 * needed. Defaults to false so an omitted argument keeps the original PvE-only behavior.
 */
export function hasAutoAttackTarget(
  target: Entity | null | undefined,
  pvpHostile = false,
): boolean {
  return !!target && !target.dead && (target.hostile || pvpHostile);
}

/**
 * Whether a player target is PvP-hostile right now: an active duel opponent, or an
 * active-arena opponent/enemy. Mirrors the private `isHostilePlayer` the renderer
 * already computes for nameplate coloring (`src/render/renderer.ts`), so the "Auto-Attack
 * on Ability Use" QoL setting recognizes the same PvP-hostile state instead of gating on
 * the mob-only `hostile` flag, which a player target never carries.
 *
 * Deliberately narrower than the sim's `isHostileTo`: it does not cover the jail brawl,
 * the warden arm, an enemy player's PET (resolved through `pvpController`), or the Vale
 * Cup cross-team arm. That matches the renderer's own nameplate predicate (a parity
 * choice, not a defect); if a third copy of this verdict shows up, extract one shared
 * pure module both the renderer and this file consume.
 */
export function isPvpHostileTarget(
  targetId: number | null | undefined,
  duelInfo: DuelInfo | null | undefined,
  arenaInfo: ArenaInfo | null | undefined,
): boolean {
  if (targetId === null || targetId === undefined) return false;
  if (duelInfo?.state === 'active' && duelInfo.otherPid === targetId) return true;
  const match = arenaInfo?.match;
  return (
    !!match &&
    match.state === 'active' &&
    (match.oppPid === targetId || match.enemies.some((e) => e.pid === targetId))
  );
}

/**
 * Whether the auto-attack engage must WAIT for the cast to finish instead of
 * firing at cast start. Starting auto-attack aggros the target immediately
 * (sim startAutoAttack: aggroMob + threat + combat), so engaging at the START
 * of a timed cast (Smite, Fireball, ...) pulled the mob before any damage
 * existed, an aggro-before-damage bug. A timed cast therefore defers the
 * engage to its successful castStop (the moment its damage lands, when aggro
 * is legitimate); an instant ability keeps engaging at once, since its damage
 * applies in the same tick anyway.
 */
export function deferAutoAttackUntilCastEnd(castTime: number): boolean {
  return castTime > 0;
}
