// Healing core, extracted from the Sim monolith (C2).
//
// This module owns the healing pipeline: applyHeal (the heal core, carrying the
// single rng.chance(spellCrit) crit draw), the outgoing/incoming heal multipliers
// (hexOutputMult / healingTakenMult), the heal-absorb shield drain
// (consumeHealAbsorb), the Find-Weakness crit-vuln bonus (critVulnBonus, read by
// dealDamage), and the effective-healing threat fan-out (healingThreat +
// threatEntryMatchesEntity).
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// a sibling function in this module. Statement order, branch order, the heal math's
// multiplication + Math.round order, the in-place mutation (the refactor's
// immutability waiver: `target.hp +=`, `a.value -=`, the conditional `auras.filter`),
// and the healing-threat scan order/guards are preserved exactly so the parity gate's
// full-state trace AND rng draw-order log stay byte-identical. The ONLY rng draw in
// this slice is `ctx.rng.chance(ctx.spellCrit(source))` in applyHeal, fired AFTER the
// `target.dead` early return (no draw is spent on a dead target); its global stream
// position must not move.
//
// spellCrit + threatMod STAY on Sim (shared entry points), consumed via the seam.
// addThreat + HEAL_THREAT_FACTOR are direct imports from the already-pure threat.ts
// (not SimContext callbacks).
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts).

import type { SimContext } from '../sim_context';
import { addThreat, HEAL_THREAT_FACTOR } from '../threat';
import type { Entity } from '../types';
import { runWeaponProcs } from './equip_procs';
import { onSpellCrit } from './talent_procs';

// Combined incoming-healing multiplier from Mortal Wound debuffs (classic
// Mortal Strike): each reduces healing the target receives; multiple stack
// multiplicatively. 1 = unaffected, 0 = fully suppressed.
export function healingTakenMult(ctx: SimContext, target: Entity): number {
  let mult = 1;
  for (const a of target.auras) {
    if (a.kind === 'mortal_wound') mult *= 1 - a.value;
  }
  return mult < 0 ? 0 : mult;
}

// Weakening Hex: while a `hex` aura rides the source, the damage AND healing it
// deals are scaled by (1 - value). Read by dealDamage (outgoing damage) and
// applyHeal (outgoing healing) so a hexed player's whole output is throttled.
export function hexOutputMult(ctx: SimContext, source: Entity | null): number {
  if (!source) return 1;
  let mult = 1;
  for (const a of source.auras) {
    if (a.kind === 'hex') mult *= 1 - a.value;
  }
  return mult < 0 ? 0 : mult;
}

// Consume the victim's Heal-Absorb shields (classic necrotic blight): each such
// aura holds a remaining budget of healing it devours. Drains `healed` against
// every active shield, decrementing their stored budget and dropping any that
// run dry. Returns the healing that survives (>= 0). A no-op when none are set.
export function consumeHealAbsorb(ctx: SimContext, target: Entity, healed: number): number {
  if (healed <= 0) return healed;
  let remaining = healed;
  let depleted = false;
  for (const a of target.auras) {
    if (a.kind !== 'heal_absorb' || a.value <= 0) continue;
    const eaten = Math.min(remaining, a.value);
    a.value -= eaten;
    remaining -= eaten;
    if (a.value <= 0) depleted = true;
    if (remaining <= 0) break;
  }
  if (depleted)
    target.auras = target.auras.filter((a) => !(a.kind === 'heal_absorb' && a.value <= 0));
  return remaining;
}

// "Find Weakness" vulnerability: the largest active critvuln aura adds its
// fraction to the damage of CRITICAL hits the target takes (read in dealDamage).
export function critVulnBonus(ctx: SimContext, target: Entity): number {
  let bonus = 0;
  for (const a of target.auras) {
    if (a.kind === 'critvuln' && a.value > bonus) bonus = a.value;
  }
  return bonus;
}

export function applyHeal(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  amount: number,
  ability: string,
  abilityId: string | null = null,
  // Some heals can never crit (e.g. Chronomancy Rewind, PRD "no puede hacer
  // critico"). Passing false SKIPS the crit roll entirely, so it draws NO rng and
  // keeps the shared stream in the same order as if the heal had not fired at all.
  canCrit = true,
  // Derived copies such as Power Echo must not behave like a second healing
  // action for equipped-weapon procs. Keep this separate from canCrit: callers
  // can suppress either source of rng independently without bypassing normal
  // healing, threat, absorbs, or emitted combat text.
  canTriggerWeaponProcs = true,
  // Returns the effective heal applied (post-crit, post-mult, post-overheal-clamp,
  // the same number emitted). Callers that ignore it are unaffected; Power Echo
  // reads it to repeat a direct heal at a fraction of the resolved amount.
): number {
  if (target.dead) return 0;
  const crit = canCrit ? ctx.rng.chance(ctx.spellCrit(source)) : false;
  let healed = Math.round(
    amount *
      (crit ? 1.5 + source.critDmgHealBonus : 1) *
      hexOutputMult(ctx, source) *
      healingTakenMult(ctx, target),
  );
  healed = consumeHealAbsorb(ctx, target, healed);
  healed = Math.min(healed, target.maxHp - target.hp);
  target.hp += healed;
  ctx.emit({
    type: 'heal2',
    sourceId: source.id,
    targetId: target.id,
    amount: healed,
    crit,
    ability,
  });
  healingThreat(ctx, source, target, healed);
  // Talent procs listening for critical heals (deterministic, no rng draw).
  if (crit && source.kind === 'player') onSpellCrit(ctx, source, abilityId, target);
  // Legendary on-heal weapon procs (e.g. Deathless Heartwood's Lifebloom). No-op
  // (no rng draw) unless the healer wields a proc weapon with a heal proc.
  if (canTriggerWeaponProcs) runWeaponProcs(ctx, source, target, 'heal');
  return healed;
}

// Classic healing threat: 0.5 per point of EFFECTIVE healing (overheal is
// free), split evenly among every mob already fighting the healed target.
// Party membership does not change threat; it only affects social systems.
export function healingThreat(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  healed: number,
): void {
  if (source.kind !== 'player' || healed <= 0) return;
  const total = healed * HEAL_THREAT_FACTOR * ctx.threatMod(source, 'physical');
  const aware: Entity[] = [];
  for (const m of ctx.entities.values()) {
    if (m.kind !== 'mob' || m.dead || !m.hostile || !m.inCombat || m.threat.size === 0) continue;
    if (threatEntryMatchesEntity(ctx, m, target)) aware.push(m);
  }
  if (aware.length === 0) return;
  const per = total / aware.length;
  for (const m of aware) addThreat(m, source.id, per);
}

/** True when a hate-table entry belongs to the healed entity or its pet. */
export function threatEntryMatchesEntity(ctx: SimContext, mob: Entity, e: Entity): boolean {
  if (mob.threat.has(e.id)) return true;
  if (e.kind !== 'player') return false;
  for (const id of mob.threat.keys()) {
    const entry = ctx.entities.get(id);
    if (entry?.ownerId === e.id) return true;
  }
  return false;
}
