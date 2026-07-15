// Classic-MMO-style threat. Values follow the community-verified classic-era
// research (Kenco's threat research / the classic warrior threat tables):
//  - threat = (damage * abilityMult + flat bonus) * stance/form modifiers
//  - Defensive Stance and Bear Form multiply threat by 1.3, Cat Form by 0.71,
//    Righteous Fury multiplies HOLY damage threat by 1.6
//  - each point of effective healing = 0.5 threat, split among all enemies
//    in combat with the healer's party
//  - a mob switches targets only when an attacker in melee range exceeds
//    110% of the current target's threat, or 130% at range
//  - Taunt/Growl set the caster's threat to the table's top value and force
//    the mob to attack the caster for 3 seconds
import type { Entity } from './types';

export const MELEE_SWITCH_MULT = 1.1;
export const RANGED_SWITCH_MULT = 1.3;
export const HEAL_THREAT_FACTOR = 0.5;
export const DEFENSIVE_STANCE_THREAT_MULT = 1.3;
export const BEAR_FORM_THREAT_MULT = 1.3;
export const CAT_FORM_THREAT_MULT = 0.71;
export const RIGHTEOUS_FURY_THREAT_MULT = 1.6; // holy school only
export const TAUNT_FORCE_SECONDS = 3;
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
