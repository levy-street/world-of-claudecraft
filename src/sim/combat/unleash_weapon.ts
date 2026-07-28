// Unleash Weapon (Elemental Discharge): the Enhancement shaman discharges the
// energy of its ACTIVE weapon enchant at the target. It deals a base hit that
// scales with Attack Power, adds a rider keyed to whichever enchant the shaman
// is running, then consumes that enchant, so the one button changes with it:
//   - Anchorbound Weapon (threat imbue) -> a threat spike to snap the target on.
//   - Pyrebrand (fire imbue)            -> a short fire DoT.
//   - Rimebound (frost imbue)           -> a movement slow.
//   - Stonebound / no enchant           -> just the physical hit.
// Its own module so effect_dispatch stays a thin switch and a Vitest can pin each
// enchant branch. Draws rng only for the hit roll + crit, exactly like a nuke.
import type { SimContext } from '../sim_context';
import { directHitBonus } from '../spell_scaling';
import { addThreat } from '../threat';
import type { AbilityDef, Entity } from '../types';
import { consumeNextAttackCrit } from './empower_next';

// Flat bonus threat from the earth-anchored discharge (a tank tool: a threat
// spike layered on top of the hit, stance/imbue-scaled at the call site).
const UNLEASH_ANCHOR_THREAT = 60;

function consumeWeaponEnchant(
  ctx: SimContext,
  p: Entity,
  enchant: Entity['auras'][number] | undefined,
): void {
  if (!enchant) return;
  const index = p.auras.indexOf(enchant);
  if (index < 0) return;
  p.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: p.id, name: enchant.name, gained: false });
}

export function runUnleashWeapon(
  ctx: SimContext,
  p: Entity,
  target: Entity,
  ability: AbilityDef,
  min: number,
  max: number,
): void {
  // Which weapon enchant is running? Rockbiter/Flametongue/Frostbrand ride the
  // shared 'imbue' aura (keyed by id); Anchorbound Weapon is its own kind.
  const imbue = p.auras.find((a) => a.kind === 'imbue');
  const anchored = p.auras.find((a) => a.kind === 'earthbound_weapon');
  const activeEnchant = imbue ?? anchored;

  let school: Entity['auras'][number]['school'] = 'physical';
  if (imbue?.id === 'flametongue_weapon') school = 'fire';
  else if (imbue?.id === 'frostbrand_weapon') school = 'frost';
  else if (anchored) school = 'nature';

  let dmg =
    ctx.rng.range(min, max) +
    directHitBonus(ctx.effectiveAttackPower(p), ability, ability.castTime);
  const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : ctx.spellCrit(p));
  if (crit) dmg *= 1.5 + p.critDmgSpellBonus;
  ctx.dealDamage(
    p,
    target,
    Math.round(dmg),
    crit,
    school,
    ability.name,
    'hit',
    false,
    undefined,
    true,
  );
  if (!target.dead) {
    if (anchored) {
      addThreat(target, p.id, UNLEASH_ANCHOR_THREAT * ctx.threatMod(p, school));
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
        sourceId: p.id,
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
        sourceId: p.id,
        school: 'frost',
      });
    }
    ctx.enterCombat(p, target);
  }
  consumeWeaponEnchant(ctx, p, activeEnchant);
}
