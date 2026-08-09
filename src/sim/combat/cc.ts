// Crowd-control & status aura predicates, extracted from the Sim monolith (C3).
//
// These are pure, side-effect-free reads over `e.auras`: no rng, no emit, no
// mutation, no SimContext. They answer "is this entity stunned / rooted / silenced /
// disarmed / locked-out, how blinded, how slowed-to-cast" by scanning active auras.
// Moved verbatim from Sim (PRIME DIRECTIVE: same predicates, same branches, same
// iteration); the ~37 in-sim.ts callers now call these free functions directly.
//
// `src/sim`-pure: imports only sibling sim types (no DOM/Three/render/ui/game/net,
// no Math.random/Date.now), enforced by tests/architecture.test.ts.

import type { Aura, DamageBreakBudget, Entity } from '../types';

// Some scripted encounter control is part of the encounter timeline rather
// than ordinary combat CC. Player immunity, cleanse, dispel, control-break, and
// damage-break paths all consult this predicate. Expiry and encounter-owned
// cleanup deliberately do not, so the encounter remains the lifecycle owner.
export function isUnbreakableControlAura(aura: Pick<Aura, 'unbreakableControl'>): boolean {
  return aura.unbreakableControl === true;
}

// The hard-CC kinds that pin a target in place. Exactly the set isRooted below
// reports, so a caller that needs "held still, and by whom" can walk the auras
// itself against this set instead of re-listing the kinds and drifting from it
// (frost_mage's frozen check is the one such caller today).
export const MOVEMENT_LOCK_AURA_KINDS: ReadonlySet<Aura['kind']> = new Set([
  'stun',
  'stasis',
  'root',
  'incapacitate',
  'polymorph',
]);

export function hasUnbreakableMovementLock(
  entity: Pick<Entity, 'auras'>,
  excludedAura?: Aura,
): boolean {
  return entity.auras.some(
    (aura) =>
      aura !== excludedAura &&
      MOVEMENT_LOCK_AURA_KINDS.has(aura.kind) &&
      isUnbreakableControlAura(aura),
  );
}

export function damageBreakThreshold(maxHp: number, budget: DamageBreakBudget): number {
  return Math.min(budget.max, Math.max(budget.min, Math.round(maxHp * budget.maxHpPct)));
}

// A stun freezes everything: movement, casts, melee, abilities. Stasis,
// incapacitate, and polymorph share the same total-lockout shape.
export function isStunned(e: Entity): boolean {
  return e.auras.some(
    (a) =>
      a.kind === 'stun' ||
      a.kind === 'stasis' ||
      a.kind === 'incapacitate' ||
      a.kind === 'polymorph',
  );
}

export function isInStasis(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'stasis');
}

// The FEAR family inside the `incapacitate` kind. There is deliberately no
// `fear` AuraKind: a fear is an incapacitate that also sends the victim
// fleeing (updateFearMovement) and takes the 'fear' diminishing-returns
// category, and folding that into a new kind would move every isStunned /
// MOVEMENT_LOCK_AURA_KINDS / dispel / HUD branch at once. So fear identity is
// carried by the aura ID plus the source ability's `fearDr` flag, and this is
// the ONE rule that reads it, so no consumer re-derives the set and drifts.
//
// Two arms, because the sim applies fear three ways:
//   1. The SHARED id, applied literally by the AoE fear effect
//      (combat/effect_dispatch.ts 'aoeFear'), by the mob flee driver
//      (mob/locomotion.ts) and by Banshee's Wail (mob/mob_swing.ts). Matched by
//      id alone so a mob-applied fear never depends on the warlock ability
//      continuing to exist.
//   2. A per-ability `<abilityId>_incap` aura whose ability sets `fearDr`
//      (Harrow, Morrowlash today). The caller supplies the flag rather than
//      this leaf importing the content tables, which would pull all of
//      `sim/data.ts` into a module `player_motion`/`climb`/`aura_classify`
//      already sit downstream of.
// Every OTHER incapacitate (Gouge, Sap, Blind, Hibernate, Wyvern Sting,
// Startle Shot, Dragon's Breath, the staged-cone daze, temporal_hourglass) is
// deliberately NOT a fear: those hold the victim in place rather than sending
// it running, so the reads that key off this must not claim them.
export const SHARED_FEAR_AURA_ID = 'fear_incap';
export const INCAPACITATE_AURA_SUFFIX = '_incap';

// The ability id an `<abilityId>_incap` aura was authored by, or null when the
// id does not follow the incapacitate convention at all.
export function incapacitateSourceAbilityId(auraId: string): string | null {
  if (!auraId.endsWith(INCAPACITATE_AURA_SUFFIX)) return null;
  const base = auraId.slice(0, -INCAPACITATE_AURA_SUFFIX.length);
  return base.length > 0 ? base : null;
}

export function isFearAura(
  aura: { id: string; kind: string },
  usesFearDr: (abilityId: string) => boolean,
): boolean {
  if (aura.kind !== 'incapacitate') return false;
  if (aura.id === SHARED_FEAR_AURA_ID) return true;
  const source = incapacitateSourceAbilityId(aura.id);
  return source !== null && usesFearDr(source);
}

export function isRooted(e: Entity): boolean {
  return isStunned(e) || e.auras.some((a) => a.kind === 'root');
}

export function isRootedOrChilled(e: Entity): boolean {
  return isRooted(e) || e.auras.some((a) => a.kind === 'slow');
}

// Silence locks out spell (non-physical) casts but leaves physical abilities,
// movement and melee untouched, unlike a stun, which freezes everything.
export function isSilenced(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'silence');
}

// Extra chance for the entity's own weapon swings to whiff while blinded.
// Returns the strongest active blind aura's value (0 when not blinded).
export function blindMissBonus(e: Entity): number {
  let bonus = 0;
  for (const a of e.auras) if (a.kind === 'blind' && a.value > bonus) bonus = a.value;
  return bonus;
}

// Disarm suppresses weapon swings (auto-attack, melee and ranged) but leaves
// movement, spells and instant abilities untouched (the inverse of silence).
export function isDisarmed(e: Entity): boolean {
  return e.auras.some((a) => a.kind === 'disarm');
}

// A school lockout denies casts of one specific school only (a counterspell),
// leaving every other school (and physical abilities) untouched.
export function isLockedOut(e: Entity, school: Aura['school']): boolean {
  return e.auras.some((a) => a.kind === 'lockout' && a.school === school);
}

// Curse of Tongues: returns the spell cast-time multiplier (>=1) imposed by any
// active `tongues` aura, or 1 when unafflicted. Non-stacking across sources, the
// strongest curse wins (refresh-by-id keeps a single source from compounding).
export function tonguesMult(e: Entity): number {
  let m = 1;
  for (const a of e.auras) if (a.kind === 'tongues') m = Math.max(m, a.value);
  return m;
}
