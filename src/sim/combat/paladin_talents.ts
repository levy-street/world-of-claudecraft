import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';

export const AURA_MASTERY_AURA_ID = 'aura_mastery';
export const PERPETUAL_SUN_GENERATION_AURA_ID = 'perpetual_sun_generation';

export function hasAuraMastery(entity: Entity): boolean {
  return entity.auras.some((aura) => aura.id === AURA_MASTERY_AURA_ID);
}

export function masteredPaladinAuraValue(entity: Entity, auraId: string, value: number): number {
  if (!hasAuraMastery(entity)) return value;
  return auraId === 'devotion_ward' || auraId === 'retribution_aura' ? value * 3 : value;
}

export function advancePaladinTalentCounter(
  player: Entity,
  key: 'paladin_zeal' | 'paladin_dawn_echo',
  every = 3,
): boolean {
  if (!player.procState) player.procState = { counters: {}, icds: {} };
  const next = (player.procState.counters[key] ?? 0) + 1;
  if (next >= every) {
    player.procState.counters[key] = 0;
    return true;
  }
  player.procState.counters[key] = next;
  return false;
}

export function applyRequitalAutoAttack(ctx: SimContext, attacker: Entity, target: Entity): void {
  if (attacker.dead || target.dead) return;
  let damage = 0;
  for (const aura of attacker.auras) {
    if (aura.id !== 'retribution_aura' || aura.kind !== 'thorns') continue;
    damage += masteredPaladinAuraValue(attacker, aura.id, aura.value);
  }
  if (damage <= 0) return;
  ctx.dealDamage(
    attacker,
    target,
    damage,
    false,
    'holy',
    'Requital Aura',
    'hit',
    true,
    undefined,
    false,
  );
}

export function applyRecurringGraceShield(
  ctx: SimContext,
  paladin: Entity,
  overhealing: number,
): void {
  if (overhealing <= 0) return;
  const cap = Math.max(1, Math.round(paladin.maxHp * 0.1));
  const existing = paladin.auras.find(
    (aura) =>
      aura.id === 'recurring_grace_absorb' &&
      aura.kind === 'absorb' &&
      aura.sourceId === paladin.id,
  );
  const value = Math.min(cap, (existing?.value ?? 0) + overhealing);
  ctx.applyAura(paladin, {
    id: 'recurring_grace_absorb',
    name: 'Recurring Grace',
    kind: 'absorb',
    value,
    remaining: 10,
    duration: 10,
    sourceId: paladin.id,
    school: 'holy',
  });
}

export function unleashPerpetualSun(ctx: SimContext, caster: Entity): void {
  const enemies = [...ctx.entities.values()]
    .filter(
      (entity) =>
        !entity.dead && ctx.isHostileTo(caster, entity) && dist2d(caster.pos, entity.pos) <= 10,
    )
    .sort((a, b) => a.id - b.id);
  for (const enemy of enemies) {
    ctx.dealDamage(
      caster,
      enemy,
      150,
      false,
      'holy',
      'Perpetual Sun',
      'hit',
      true,
      undefined,
      false,
    );
  }

  const party = ctx.partyOf(caster.id);
  const allyIds = party?.members ?? [caster.id];
  for (const id of [...allyIds].sort((a, b) => a - b)) {
    const ally = ctx.entities.get(id);
    if (!ally || ally.dead || dist2d(caster.pos, ally.pos) > 20) continue;
    ctx.applyHeal(caster, ally, 150, 'Perpetual Sun', null, false, false, false);
  }

  ctx.applyAura(caster, {
    id: PERPETUAL_SUN_GENERATION_AURA_ID,
    name: 'Perpetual Sun',
    kind: 'internal_cd',
    value: 2,
    remaining: 5,
    duration: 5,
    sourceId: caster.id,
    school: 'holy',
  });
}

export type DawnEchoOutcome =
  | { kind: 'damage'; target: Entity; amount: number; school: string }
  | { kind: 'healing'; target: Entity; amount: number };

export function repeatDawnEcho(ctx: SimContext, caster: Entity, outcome: DawnEchoOutcome): boolean {
  if (outcome.target.dead || outcome.amount <= 0) return false;
  const amount = Math.max(1, Math.round(outcome.amount * 0.4));
  if (outcome.kind === 'healing') {
    return (
      ctx.applyHeal(caster, outcome.target, amount, 'Dawn Echo', null, false, false, false, true) >
      0
    );
  }
  const hpBefore = outcome.target.hp;
  ctx.dealDamage(
    caster,
    outcome.target,
    amount,
    false,
    outcome.school,
    'Dawn Echo',
    'hit',
    true,
    undefined,
    false,
  );
  return outcome.target.hp < hpBefore;
}
