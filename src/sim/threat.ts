// Classic-MMO-style threat. Values follow the community-verified classic-era
// research (Kenco's threat research / the classic warrior threat tables):
//  - threat = (damage * abilityMult + flat bonus) * stance/form modifiers
//  - Defensive Stance and Bear Form multiply threat by 1.3, Cat Form by 0.71.
//    Burning Oath (Righteous Fury) multiplies HOLY damage threat; classic ran
//    1.6, but ClaudeCraft's Faithwarden kit stacks per-ability multipliers and
//    the Oathward mastery on top, so it runs 1.3 here (v0.38 tank threat
//    parity pass) to keep the composed total in band.
//  - each point of effective healing = 0.5 threat, split among all enemies
//    in combat with the healer's party
//  - a mob switches targets only when an attacker in melee range exceeds
//    110% of the current target's threat, or 130% at range
//  - Taunt/Growl set the caster's threat to the table's top value and force
//    the mob to attack the caster for 3 seconds
import type { Entity } from './types';
import { dist2d } from './types';

export const MELEE_SWITCH_MULT = 1.1;
// Boss-summoned adds spawn with this much threat on the boss's current target
// (the tank): enough that normal healing cannot peel a fresh wave, low enough
// that sustained DPS focus still rips one loose. Consumed by Sim.spawnBossAdds
// (the five-man summoners) AND the Nythraxis encounter-script spawners, so the
// two paths cannot drift. Pinned by tests/summon_threat_seed.test.ts.
export const SUMMONED_ADD_THREAT_SEED = 750;
export const RANGED_SWITCH_MULT = 1.3;
export const HEAL_THREAT_FACTOR = 0.5;
export const DEFENSIVE_STANCE_THREAT_MULT = 1.3;
export const BEAR_FORM_THREAT_MULT = 1.3;
export const CAT_FORM_THREAT_MULT = 0.71;
export const RIGHTEOUS_FURY_THREAT_MULT = 1.3; // holy school only
export const TAUNT_FORCE_SECONDS = 3;
// An attacker this far (yards, 2D) from an OPEN-WORLD mob is no longer part of
// its fight: the engaged pass (combat/engaged_combat.ts) drops them off the hate
// table instead of holding them in combat. What makes 100 safe is the 40 yd
// action envelope: the longest chain that keeps someone in the fight is a
// healer at max range on a raider at max range from the mob, about 85 yd, so
// the margin is about 15 yd. That margin is the constant's whole defence: the
// reach DESTROYS threat rather than suspending it, so an ability or a
// displacement mechanic that ever moves someone further than this returns them
// to the fight on zero threat, not the threat they had; widen the reach with
// any such addition. It sits under every instance slot pitch (hundreds of
// yards), so teleporting away releases on the next tick: the classic map-change
// threat drop. The open-world boss encounter hold uses the same radius so the
// two rules agree. Inside a claimed instance slot distance never drops anyone;
// leaving the slot does (instances/instance_combat_hold.ts).
export const THREAT_DROP_RANGE = 100;
// Stealth shrinks detection at equal level; higher-level observers pierce it
// more easily, lower-level observers struggle. Shared by mobs and players.
export const STEALTH_DETECTION_MULT = 0.25;
export const STEALTH_DETECTION_PER_LEVEL = 0.08;
export const STEALTH_DETECTION_MIN_MULT = 0.1;
export const STEALTH_DETECTION_MAX_MULT = 1;

/** Stance/form threat modifier for everything `source` does (flat bonus
 *  threat included, as in classic). School-specific modifiers (Righteous
 *  Fury) only apply to matching damage. */
export function threatModifier(source: Entity, school: string): number {
  let mod = 1;
  for (const a of source.auras) {
    if (a.kind === 'defensive_stance') mod *= DEFENSIVE_STANCE_THREAT_MULT;
    else if (a.kind === 'form_bear') mod *= BEAR_FORM_THREAT_MULT;
    else if (a.kind === 'form_cat') mod *= CAT_FORM_THREAT_MULT;
    else if (a.kind === 'righteous_fury' && school === 'holy') mod *= RIGHTEOUS_FURY_THREAT_MULT;
    else if (a.kind === 'buff_threat') mod *= a.value;
    else if (a.kind === 'sacred_form') mod *= a.value3 ?? 0.5;
  }
  return mod;
}

export function stealthDetectionMultiplier(observerLevel: number, stealthedLevel: number): number {
  const raw =
    STEALTH_DETECTION_MULT + (observerLevel - stealthedLevel) * STEALTH_DETECTION_PER_LEVEL;
  return Math.max(STEALTH_DETECTION_MIN_MULT, Math.min(STEALTH_DETECTION_MAX_MULT, raw));
}

export function stealthDetectionRadius(
  observer: Entity,
  stealthed: Entity,
  baseRadius: number,
): number {
  return baseRadius * stealthDetectionMultiplier(observer.level, stealthed.level);
}

/** Hunter Play Dead (feign death): no mob or pet perceives or pulls the 'corpse'. */
export function isFeigningDeath(target: Entity): boolean {
  return target.auras.some((a) => a.kind === 'feign_death');
}

export function hasEscapeStealth(target: Entity): boolean {
  return target.auras.some((a) => a.id === 'vanish' && a.kind === 'stealth');
}

export function canDetectStealthedTarget(
  observer: Entity,
  target: Entity,
  baseRadius: number,
): boolean {
  // Play Dead (hunter feign death): a mob never notices a 'corpse'.
  if (isFeigningDeath(target)) return false;
  if (!target.auras.some((a) => a.kind === 'stealth')) return true;
  if (hasEscapeStealth(target)) return false;
  return dist2d(observer.pos, target.pos) <= stealthDetectionRadius(observer, target, baseRadius);
}

// PvP stealth detection (Stealth Rework). An enemy PLAYER or PET spots a
// stealthed player through the same level-scaled multiplier mobs use
// (stealthDetectionMultiplier), on a base radius that is full inside a narrow
// cone around the observer's facing (PVP_STEALTH_DETECTION_CONE_DEG wide) and
// halved everywhere else, so flanking or sneaking up from behind gets you twice
// as close. The base is the mob aggro-radius cap (MAX_AGGRO_RADIUS in
// mob/targeting.ts), which puts an equal-level detection at 5 yd inside the
// cone and 2.5 yd outside it. Smokefade (Vanish) stays a true escape: nothing
// sees through it.
export const PVP_STEALTH_DETECTION_BASE = 20;
export const PVP_STEALTH_DETECTION_REAR_MULT = 0.5;
/** Full width of the front detection cone, in degrees (half each side). */
export const PVP_STEALTH_DETECTION_CONE_DEG = 45;
const CONE_HALF_COS = Math.cos(((PVP_STEALTH_DETECTION_CONE_DEG / 2) * Math.PI) / 180);
// SPOTTING and KEEPING differ. Spotting a stealther needs the cone rule above
// (full radius inside the cone, halved outside it). Once spotted ("held"), the reveal
// keeps the FRONT radius whatever the arc, plus this many extra yards, so a
// rogue on the edge, or an observer turning on the spot, never flickers in and
// out of view. The server holds an entity the viewer already has; the sim's own
// gates (casting, auto-attack, pet sight, the stealth-entry drop) always use
// the held radius, so they never refuse an action against a target the client
// is legitimately still shown.
export const PVP_STEALTH_DETECTION_HYSTERESIS = 1;

/** True when `target` stands inside `observer`'s front detection cone
 *  (PVP_STEALTH_DETECTION_CONE_DEG wide, centred on its facing); a target on
 *  the observer's own spot counts. Forward is (sin f, cos f), the movement
 *  kernel's axis. */
export function inFrontCone(observer: Entity, target: Entity): boolean {
  const dx = target.pos.x - observer.pos.x;
  const dz = target.pos.z - observer.pos.z;
  const along = Math.sin(observer.facing) * dx + Math.cos(observer.facing) * dz;
  return along >= CONE_HALF_COS * Math.hypot(dx, dz);
}

/** The radius inside which a hostile observer spots (or, `held`, keeps) a
 *  stealthed player. */
export function pvpStealthDetectionRadius(observer: Entity, target: Entity, held = false): number {
  const base =
    held || inFrontCone(observer, target)
      ? PVP_STEALTH_DETECTION_BASE
      : PVP_STEALTH_DETECTION_BASE * PVP_STEALTH_DETECTION_REAR_MULT;
  const radius = stealthDetectionRadius(observer, target, base);
  return held ? radius + PVP_STEALTH_DETECTION_HYSTERESIS : radius;
}

// Greater Invisibility reads "Vanish for 20 sec" and already drops every lock
// the way Vanish does (dropSelfFromHostileFocus), so against PLAYERS and PETS
// it is an escape too. Mobs keep their own rule (hasEscapeStealth).
const PVP_ESCAPE_STEALTH_IDS: ReadonlySet<string> = new Set(['vanish', 'greater_invisibility']);

export function hasPvpEscapeStealth(target: Entity): boolean {
  return target.auras.some((a) => a.kind === 'stealth' && PVP_ESCAPE_STEALTH_IDS.has(a.id));
}

/** Distance half of the PvP rule, for a target already known to be stealthed
 *  (the server keys on the cached Entity.stealthed flag). `held` is the keep
 *  rule (see PVP_STEALTH_DETECTION_HYSTERESIS). Pure: no clock, no rng. */
export function withinPvpStealthDetection(observer: Entity, target: Entity, held = false): boolean {
  if (hasPvpEscapeStealth(target)) return false;
  const r = pvpStealthDetectionRadius(observer, target, held);
  const dx = target.pos.x - observer.pos.x;
  const dz = target.pos.z - observer.pos.z;
  return dx * dx + dz * dz <= r * r;
}

/** Can a HOSTILE observer (an enemy player or pet) perceive `target`? Anything
 *  that is not a stealthed player is always visible; Vanish and Greater
 *  Invisibility never are. Pure: no clock, no rng. */
export function hostileCanSeeStealthed(observer: Entity, target: Entity, held = false): boolean {
  if (target.kind !== 'player' || !target.auras.some((a) => a.kind === 'stealth')) return true;
  return withinPvpStealthDetection(observer, target, held);
}

/** The sim's own gate for a hostile action (cast, channel, auto-attack) against
 *  `target`: Vanish hides any target, and a stealthed player is hidden once it
 *  is beyond the observer's held detection radius. */
export function hiddenFromHostile(observer: Entity, target: Entity): boolean {
  return hasEscapeStealth(target) || !hostileCanSeeStealthed(observer, target, true);
}

// What a PET perceives. A feigning hunter is never seen. A stealthed player is
// seen through the same PvP rule as an enemy player (hostileCanSeeStealthed,
// the pet as the observer, reveal hysteresis included because the pet holds a
// live lock). Without a pet to measure from the answer stays the old blind one.
export function petCanSeeStealthedTarget(target: Entity, pet?: Entity): boolean {
  if (target.auras.some((a) => a.kind === 'feign_death')) return false;
  if (!target.auras.some((a) => a.kind === 'stealth')) return true;
  if (!pet) return false;
  return hostileCanSeeStealthed(pet, target, true);
}

export function addThreat(mob: Entity, sourceId: number, amount: number): void {
  if (mob.dead || amount <= 0) return;
  mob.threat.set(sourceId, (mob.threat.get(sourceId) ?? 0) + amount);
}

export function clearThreat(mob: Entity): void {
  mob.threat.clear();
  mob.forcedTargetId = null;
  mob.forcedTargetTimer = 0;
}

/** Remove ONE attacker from the hate table (they left the instance or otherwise
 *  stopped existing for this mob). A taunt lock (forcedTargetId) pointing at
 *  that attacker is released with the entry. */
export function dropThreat(mob: Entity, sourceId: number): void {
  mob.threat.delete(sourceId);
  if (mob.forcedTargetId === sourceId) {
    mob.forcedTargetId = null;
    mob.forcedTargetTimer = 0;
  }
}

/** True when `attacker` stands beyond THREAT_DROP_RANGE of the mob (flat). */
export function beyondThreatRange(mob: Entity, attacker: Entity): boolean {
  return dist2d(mob.pos, attacker.pos) > THREAT_DROP_RANGE;
}

/** Highest threat value on the table (0 when empty) — taunt matches this. */
export function topThreatValue(mob: Entity): number {
  let top = 0;
  for (const v of mob.threat.values()) if (v > top) top = v;
  return top;
}

/** Top-N table entries, highest first, for the wire / meters. */
export function threatEntries(mob: Entity, limit: number): [number, number][] {
  return [...mob.threat.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, t]) => [id, Math.round(t)]);
}
