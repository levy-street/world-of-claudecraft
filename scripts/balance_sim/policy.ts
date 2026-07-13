// The per-tick fighter driver: one shared, deterministic policy for all specs
// so bout outcomes measure kit power, not policy quality. Priority order per
// decision: defensive, emergency self heal, interrupt, gap closer, rotation.
// Ability gating follows the shouldTryAbility heuristics proven in
// scripts/nythraxis_matrix.ts, extended with the PvP gates (roots, fear, slows).

import type { Sim } from '../../src/sim/sim';
import { dist2d, type Entity, MELEE_RANGE } from '../../src/sim/types';
import { face } from './arena';
import type { BalanceSpec } from './spec_catalog';

const DOT_ABILITIES = new Set([
  'immolate',
  'corruption',
  'curse_of_agony',
  'shadow_word_pain',
  'moonfire',
  'insect_swarm',
  'flame_shock',
  'serpent_sting',
  'rend',
  'rip',
  'rupture',
]);
const SELF_BUFF_ABILITIES = new Set([
  'lightning_shield',
  'aspect_of_the_hawk',
  'battle_shout',
  'blessing_of_might',
  'righteous_fury',
  'devotion_aura',
  'retribution_aura',
  'seal_of_righteousness',
  'instant_poison',
  'defensive_stance',
  'bear_form',
  'cat_form',
  'barkskin',
  'rockbiter_weapon',
  'demon_skin',
  'frost_armor',
  'arcane_intellect',
  'power_word_fortitude',
  'ice_barrier',
  'evasion',
  'power_word_shield',
  'renew',
  'rejuvenation',
]);
const TARGET_DEBUFF_ABILITIES = new Set([
  'demoralizing_roar',
  'faerie_fire',
  'hamstring',
  'wing_clip',
  'concussive_shot',
  'fear',
  'entangling_roots',
]);
const FIVE_COMBO_FINISHERS = new Set(['eviscerate', 'rip', 'rupture', 'ferocious_bite']);
const COMBO_STUNS = new Set(['kidney_shot']);
const ROOT_ABILITIES = new Set(['frost_nova', 'entangling_roots']);
const STUN_ABILITIES = new Set(['hammer_of_justice', 'kidney_shot', 'bash']);
export const CONTROL_AURA_KINDS = new Set(['stun', 'root', 'polymorph', 'incapacitate', 'silence']);

function auraActive(entity: Entity, id: string, sourceId?: number): boolean {
  return entity.auras.some(
    (a) => a.id === id && (sourceId === undefined || a.sourceId === sourceId) && a.remaining > 0.2,
  );
}

function hasAuraKind(entity: Entity, kinds: Set<string>): boolean {
  return entity.auras.some((a) => kinds.has(a.kind) && a.remaining > 0.2);
}

export function shouldTryAbility(caster: Entity, target: Entity, ability: string): boolean {
  if (DOT_ABILITIES.has(ability) && auraActive(target, ability, caster.id)) return false;
  if (SELF_BUFF_ABILITIES.has(ability) && auraActive(caster, ability)) return false;
  if (TARGET_DEBUFF_ABILITIES.has(ability) && auraActive(target, ability, caster.id)) return false;
  if (FIVE_COMBO_FINISHERS.has(ability) && caster.comboPoints < 5) return false;
  if (COMBO_STUNS.has(ability) && caster.comboPoints < 3) return false;
  if (ROOT_ABILITIES.has(ability) && hasAuraKind(target, new Set(['root', 'stun']))) return false;
  if (STUN_ABILITIES.has(ability) && hasAuraKind(target, new Set(['stun']))) return false;
  if (ability === 'frost_nova' && dist2d(caster.pos, target.pos) > 8) return false;
  if ((ability === 'maul' || ability === 'heroic_strike') && caster.queuedOnSwing === ability)
    return false;
  if (
    ability === 'sunder_armor' &&
    (target.auras.find((a) => a.kind === 'sunder')?.stacks ?? 0) >= 5
  )
    return false;
  if (
    ability === 'judgement' &&
    !caster.auras.some((a) => a.kind === 'imbue' && a.value2 !== undefined)
  )
    return false;
  return true;
}

// A cast attempt "worked" when any casting-relevant state moved; castAbility
// itself returns void, so diff the state like the raid matrix does.
export function tryCast(sim: Sim, pid: number, targetId: number, ability: string): boolean {
  const p = sim.entities.get(pid);
  if (!p || p.dead || p.castingAbility) return false;
  p.targetId = targetId;
  const target = sim.entities.get(targetId);
  if (target && targetId !== pid) face(p, target);
  const before = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}|${p.comboPoints}`;
  sim.castAbility(ability, pid);
  const after = `${p.castingAbility}|${p.gcdRemaining}|${p.queuedOnSwing}|${p.resource}|${p.auras.length}|${p.comboPoints}`;
  return before !== after;
}

export interface FighterHandle {
  pid: number;
  spec: BalanceSpec;
  // Reported on every accepted cast attempt; castStart events only cover
  // cast-time spells, so instants would otherwise go uncounted.
  onCast?: (ability: string) => void;
  // Set by driveFighter after the opener lands: openers are one-shot moves
  // (charge, opening fear), not part of the sustained rotation.
  openerDone?: boolean;
}

// Drive one fighter for one tick against one enemy. Movement is intentionally
// simple and symmetric: melee chase straight in, ranged hold ground (hunters
// back out of their dead zone). Kiting skill is out of scope; the same policy
// applies to every spec so comparisons stay apples to apples.
export function driveFighter(sim: Sim, fighter: FighterHandle, enemyId: number): void {
  const { pid, spec } = fighter;
  const cast = (targetId: number, ability: string): boolean => {
    const ok = tryCast(sim, pid, targetId, ability);
    if (ok) fighter.onCast?.(ability);
    return ok;
  };
  const p = sim.entities.get(pid);
  const enemy = sim.entities.get(enemyId);
  const meta = sim.players.get(pid);
  if (!p || !enemy || !meta || p.dead || enemy.dead) return;

  face(p, enemy);
  const gap = dist2d(p.pos, enemy.pos);
  const minRange = spec.cls === 'hunter' ? 9 : 0;
  meta.moveInput.forward = spec.melee && gap > MELEE_RANGE - 0.8;
  meta.moveInput.back = minRange > 0 && gap < minRange;

  p.targetId = enemyId;
  sim.startAutoAttack(pid);
  if (sim.petOf(pid) && sim.tickCount % 20 === 0) sim.petAttack(pid);

  if (p.castingAbility) return;

  const hpFrac = p.hp / p.maxHp;
  if (hpFrac < 0.5) {
    for (const ability of spec.defensives ?? []) {
      if (!shouldTryAbility(p, enemy, ability)) continue;
      if (cast(pid, ability)) return;
    }
  }
  if (spec.healRotation && hpFrac < (spec.selfHealPct ?? 0)) {
    for (const ability of spec.healRotation) {
      if (SELF_BUFF_ABILITIES.has(ability) && auraActive(p, ability)) continue;
      if (cast(pid, ability)) return;
    }
  }
  if (spec.interrupt && enemy.castingAbility && cast(enemyId, spec.interrupt)) return;
  if (
    spec.opener &&
    !fighter.openerDone &&
    gap > MELEE_RANGE + 2 &&
    gap < 25 &&
    cast(enemyId, spec.opener)
  ) {
    fighter.openerDone = true;
    return;
  }
  for (const ability of spec.rotation) {
    if (!shouldTryAbility(p, enemy, ability)) continue;
    if (cast(enemyId, ability)) return;
  }
}

// Ticks where the entity sits under hard control, for the CC-pressure metric.
export function underControl(entity: Entity): boolean {
  return hasAuraKind(entity, CONTROL_AURA_KINDS);
}
