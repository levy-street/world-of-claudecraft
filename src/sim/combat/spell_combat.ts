import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export function spellCritBonusFromAuras(p: Entity): number {
  let bonus = 0;
  for (const aura of p.auras) {
    if (aura.kind === 'buff_spellcrit') bonus += aura.value;
  }
  return bonus;
}

export function spellDamageMultFromAuras(p: Entity): number {
  let bonus = 0;
  for (const aura of p.auras) {
    if (aura.kind === 'buff_spelldmg') bonus += aura.value;
  }
  return 1 + bonus;
}

export function spellHasteMultFromAuras(p: Entity): number {
  let bonus = 0;
  for (const aura of p.auras) {
    if (aura.kind === 'buff_spellhaste') bonus += aura.value;
  }
  return 1 + bonus;
}

export function hasCastShield(p: Entity): boolean {
  return p.auras.some((aura) => aura.kind === 'cast_shield');
}

export function noteSpellHit(ctx: SimContext, caster: Entity, crit: boolean): void {
  const meta = caster.kind === 'player' ? (ctx.resolve(caster.id)?.meta ?? null) : null;
  if (!meta || !ctx.playerMods(meta).global.hotStreak) return;
  if (!crit) {
    caster.spellCritStreak = 0;
    return;
  }
  const next = (caster.spellCritStreak ?? 0) + 1;
  if (next < 2) {
    caster.spellCritStreak = next;
    return;
  }
  caster.spellCritStreak = 0;
  ctx.applyAura(caster, {
    id: 'hot_streak_instant',
    name: 'Hot Streak',
    kind: 'next_cast_instant',
    remaining: 60,
    duration: 60,
    value: 1,
    sourceId: caster.id,
    school: 'fire',
  });
  ctx.applyAura(caster, {
    id: 'hot_streak_free',
    name: 'Hot Streak',
    kind: 'next_cast_free',
    remaining: 60,
    duration: 60,
    value: 1,
    sourceId: caster.id,
    school: 'fire',
  });
}
