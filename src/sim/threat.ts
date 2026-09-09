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

export function hasEscapeStealth(target: Entity): boolean {
  return target.auras.some((a) => a.id === 'vanish' && a.kind === 'stealth');
}

export function canDetectStealthedTarget(
  observer: Entity,
  target: Entity,
  baseRadius: number,
): boolean {
  if (!target.auras.some((a) => a.kind === 'stealth')) return true;
  if (hasEscapeStealth(target)) return false;
  return dist2d(observer.pos, target.pos) <= stealthDetectionRadius(observer, target, baseRadius);
}

// A PET never perceives a stealthed enemy at all (Rogue Duskveil/Smokestep and
// Druid Stalk all apply a kind:'stealth' aura), matching exactly what an enemy
// PLAYER sees. Deliberately NOT the classic proximity model mobs use
// (canDetectStealthedTarget): a hunter/warlock/mage pet gets zero close-range
// stealth detection, so a rogue's opener and Vanish work against the pair the
// same way they work against the player. Pure: no clock, no rng.
export function petCanSeeStealthedTarget(target: Entity): boolean {
  return !target.auras.some((a) => a.kind === 'stealth');
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
