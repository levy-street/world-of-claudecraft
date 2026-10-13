import type { SimContext } from '../../sim_context';
import type { Aura, Entity } from '../../types';
import { livingGroupRaidInRadius } from '../group_targeting';
import { GLOOMTITHE_AURA_ID } from './presentation';

export const VAMPIRIC_TOUCH_ID = 'vampiric_touch';
export const VAMPIRIC_TOUCH_CHARGES = 2;
export const VAMPIRIC_TOUCH_DAMAGE_MULT = 1.3;
export const VAMPIRIC_TOUCH_HEAL_RATE = 0.2;
export const VAMPIRIC_TOUCH_HEAL_RANGE = 30;

function isShadowPriest(ctx: SimContext, priest: Entity | null): priest is Entity {
  if (!priest || priest.dead || priest.kind !== 'player') return false;
  const meta = ctx.players.get(priest.id);
  return meta?.cls === 'priest' && meta.talents.spec === 'shadow';
}

/** Spend the optional bank only after this caster's new snapshot is accepted. */
export function applyVampiricTouch(
  ctx: SimContext,
  priest: Entity,
  target: Entity,
  dot: Aura,
): boolean {
  if (!isShadowPriest(ctx, priest)) return false;
  const bank = priest.auras.find(
    (aura) => aura.id === GLOOMTITHE_AURA_ID && aura.sourceId === priest.id,
  );
  const empowered = (bank?.stacks ?? 0) >= VAMPIRIC_TOUCH_CHARGES;
  if (empowered) dot.value = Math.round(dot.value * VAMPIRIC_TOUCH_DAMAGE_MULT);
  ctx.applyAura(target, dot);
  if (!target.auras.includes(dot)) return false;
  if (empowered && bank) {
    bank.stacks = (bank.stacks ?? 0) - VAMPIRIC_TOUCH_CHARGES;
    if (bank.stacks === 0) priest.auras.splice(priest.auras.indexOf(bank), 1);
    ctx.emit({ type: 'aura', targetId: priest.id, name: bank.name, gained: bank.stacks > 0 });
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: priest.id,
    targetId: target.id,
    school: 'shadow',
    fx: 'tick',
    ability: VAMPIRIC_TOUCH_ID,
  });
  return true;
}

/** One budget from landed HP loss, shared in stable id order. No healing RNG. */
export function healVampiricTouch(
  ctx: SimContext,
  priest: Entity | null,
  dot: Aura,
  landedHpLoss: number,
): void {
  if (dot.id !== VAMPIRIC_TOUCH_ID || !isShadowPriest(ctx, priest)) return;
  const budget = Math.round(landedHpLoss * VAMPIRIC_TOUCH_HEAL_RATE);
  if (budget <= 0) return;
  const party = ctx.partyOf(priest.id);
  const subgroup = party?.raidGroups.get(priest.id) ?? 1;
  const recipients = livingGroupRaidInRadius(ctx, priest, VAMPIRIC_TOUCH_HEAL_RANGE).filter(
    (member) =>
      member.hp < member.maxHp &&
      ctx.isFriendlyTo(priest, member) &&
      (!party?.raid || (party.raidGroups.get(member.id) ?? 1) === subgroup),
  );
  if (recipients.length === 0) return;
  const share = Math.floor(budget / recipients.length);
  const remainder = budget % recipients.length;
  for (let index = 0; index < recipients.length; index++) {
    const amount = share + (index < remainder ? 1 : 0);
    if (amount > 0)
      ctx.applyHeal(priest, recipients[index], amount, dot.name, VAMPIRIC_TOUCH_ID, false, false);
  }
}
