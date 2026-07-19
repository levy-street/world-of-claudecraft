import type { SimContext } from '../sim_context';
import { directHitBonus } from '../spell_scaling';
import { addThreat } from '../threat';
import type { AbilityDef, Entity } from '../types';
import { consumeNextAttackCrit } from './empower_next';

const STONEBOUND_DISCHARGE_THREAT = 60;

export function runUnleashWeapon(
  ctx: SimContext,
  player: Entity,
  target: Entity,
  ability: AbilityDef,
  min: number,
  max: number,
): void {
  const imbue = player.auras.find((aura) => aura.kind === 'imbue');
  const meta = ctx.players.get(player.id);
  const stonebound =
    imbue?.id === 'rockbiter_weapon' &&
    meta?.cls === 'shaman' &&
    ctx.playerMods(meta).spec === 'enhancement';

  let school: AbilityDef['school'] = 'physical';
  if (imbue?.id === 'flametongue_weapon') school = 'fire';
  else if (imbue?.id === 'frostbrand_weapon') school = 'frost';
  else if (stonebound) school = 'nature';

  let damage =
    ctx.rng.range(min, max) + directHitBonus(ctx.effectiveAttackPower(player), ability, 0);
  const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, player) ? 1 : ctx.spellCrit(player));
  if (crit) damage *= 1.5 + player.critDmgSpellBonus;
  ctx.dealDamage(
    player,
    target,
    Math.round(damage),
    crit,
    school,
    ability.name,
    'hit',
    false,
    undefined,
    true,
    false,
    false,
    ability.id,
  );
  if (target.dead) return;

  if (stonebound) {
    addThreat(target, player.id, STONEBOUND_DISCHARGE_THREAT * ctx.threatMod(player, school));
  } else if (imbue?.id === 'flametongue_weapon') {
    ctx.applyAura(target, {
      id: `${ability.id}_flame`,
      name: ability.name,
      kind: 'dot',
      remaining: 6,
      duration: 6,
      value: Math.max(1, Math.round(imbue.value)),
      tickInterval: 2,
      tickTimer: 2,
      sourceId: player.id,
      school: 'fire',
    });
  } else if (imbue?.id === 'frostbrand_weapon') {
    ctx.applyAura(target, {
      id: `${ability.id}_slow`,
      name: ability.name,
      kind: 'slow',
      remaining: 6,
      duration: 6,
      value: 0.5,
      sourceId: player.id,
      school: 'frost',
    });
  }
  ctx.enterCombat(player, target);
}
