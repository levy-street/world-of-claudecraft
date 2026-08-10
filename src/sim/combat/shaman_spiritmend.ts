// Spiritmend's owner-scoped Mending Current pool. The remaining healing is the
// aura value itself, so ticking and Chain Heal consumption share one authority.

import type { SimContext } from '../sim_context';
import type { Aura, Entity } from '../types';

export { MENDING_WATERS_MANA_COST, TIDECALL_MANA_COST } from '../content/shaman_tuning';

import {
  lifespringMasteryDepositBonus,
  SHAMAN_TALENT_IDS,
  shamanTalentSelected,
  spiritmendTalentDepositMultiplier,
} from './shaman_talents';

export const MENDING_CURRENT_ID = 'shaman_mending_current';
export const LIFESPRING_WEAPON_ID = 'lifespring_weapon';
export const MENDING_CURRENT_DURATION = 12;
export const MENDING_CURRENT_INTERVAL = 3;
export const MENDING_CURRENT_MAX_HP_CAP = 0.3;
export const MENDING_WATERS_DEPOSIT = 0.5;
export const TIDECALL_DEPOSIT = 1;
export const LIFESPRING_DEPOSIT_BONUS = 0.2;
export const CURRENT_CONSUME_MULTIPLIER = 1.25;
export const UNLEASH_WEAPON_GUARD_ID = 'unleash_weapon';
export const UNLEASH_WEAPON_GUARD_FRACTION = 0.5;
export const UNLEASH_WEAPON_GUARD_DURATION = 8;

function isSpiritmend(ctx: SimContext, player: Entity): boolean {
  if (player.kind !== 'player') return false;
  const meta = ctx.players.get(player.id);
  return meta !== undefined && ctx.playerMods(meta).spec === 'restoration';
}

function currentIndex(target: Entity, sourceId: number): number {
  return target.auras.findIndex(
    (aura) => aura.id === MENDING_CURRENT_ID && aura.sourceId === sourceId,
  );
}

function removeAuraAt(ctx: SimContext, target: Entity, index: number): Aura | null {
  const [aura] = target.auras.splice(index, 1);
  if (!aura) return null;
  ctx.emit({
    type: 'aura',
    targetId: target.id,
    name: aura.name,
    gained: false,
    auraKind: aura.kind,
  });
  return aura;
}

export function mendingCurrent(target: Entity, sourceId: number): Aura | null {
  return (
    target.auras.find((aura) => aura.id === MENDING_CURRENT_ID && aura.sourceId === sourceId) ??
    null
  );
}

/** Pure action-bar predicate for Tidecall's capped-target cue. */
export function mendingCurrentTargetCapped(
  sourceId: number | undefined,
  target: {
    maxHp?: number;
    auras?: readonly { id?: string; sourceId?: number; value?: number }[];
  } | null,
): boolean {
  const maxHp = target?.maxHp;
  if (sourceId === undefined || !maxHp || maxHp <= 0 || !target.auras) return false;
  return target.auras.some(
    (aura) =>
      aura.id === MENDING_CURRENT_ID &&
      aura.sourceId === sourceId &&
      (aura.value ?? 0) >= Math.round(maxHp * MENDING_CURRENT_MAX_HP_CAP),
  );
}

export function spiritmendDepositMultiplier(
  ctx: SimContext,
  source: Entity,
  abilityId: string,
): number {
  const base = abilityId === 'tidecall' ? TIDECALL_DEPOSIT : MENDING_WATERS_DEPOSIT;
  const lifespring = source.auras.some((aura) => aura.id === LIFESPRING_WEAPON_ID)
    ? 1 + LIFESPRING_DEPOSIT_BONUS + lifespringMasteryDepositBonus(ctx, source)
    : 1;
  return base * lifespring * spiritmendTalentDepositMultiplier(ctx, source);
}

function depositRawMendingCurrent(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  requested: number,
): number {
  if (!isSpiritmend(ctx, source) || target.dead || requested <= 0) return 0;
  const cap = Math.max(0, Math.round(target.maxHp * MENDING_CURRENT_MAX_HP_CAP));
  const existing = mendingCurrent(target, source.id);
  const previous = existing?.value ?? 0;
  const next = Math.min(cap, previous + Math.round(requested));
  const previousTier = cap > 0 ? Math.min(3, Math.ceil((previous / cap) * 3)) : 0;
  const nextTier = cap > 0 ? Math.min(3, Math.ceil((next / cap) * 3)) : 0;
  if (existing) {
    existing.value = next;
    existing.remaining = MENDING_CURRENT_DURATION;
    existing.duration = MENDING_CURRENT_DURATION;
    existing.tickInterval = MENDING_CURRENT_INTERVAL;
    existing.tickTimer = MENDING_CURRENT_INTERVAL;
  } else if (next > 0) {
    ctx.applyAura(target, {
      id: MENDING_CURRENT_ID,
      name: 'Mending Current',
      kind: 'hot',
      value: next,
      remaining: MENDING_CURRENT_DURATION,
      duration: MENDING_CURRENT_DURATION,
      tickInterval: MENDING_CURRENT_INTERVAL,
      tickTimer: MENDING_CURRENT_INTERVAL,
      sourceId: source.id,
      school: 'nature',
    });
  }
  if (nextTier > previousTier) {
    ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: target.id,
      school: 'nature',
      fx: 'wardBloom',
    });
  }
  return next - previous;
}

/** Deposit from calculated healing before overheal, then cap and refresh. */
export function depositMendingCurrent(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  calculatedHealing: number,
  abilityId: 'healing_wave' | 'tidecall',
): number {
  if (!isSpiritmend(ctx, source) || target.dead || calculatedHealing <= 0) return 0;
  const deposit = Math.max(
    0,
    Math.round(calculatedHealing * spiritmendDepositMultiplier(ctx, source, abilityId)),
  );
  const added = depositRawMendingCurrent(ctx, source, target, deposit);
  if (
    abilityId === 'tidecall' &&
    source.auras.some((aura) => aura.id === LIFESPRING_WEAPON_ID) &&
    shamanTalentSelected(ctx, source, SHAMAN_TALENT_IDS.livingWeapon)
  ) {
    let best: Entity | null = null;
    let bestFrac = Infinity;
    let bestDist = Infinity;
    for (const candidate of ctx.entities.values()) {
      if (
        candidate.id === target.id ||
        candidate.dead ||
        candidate.hp >= candidate.maxHp ||
        (candidate.id !== source.id && !ctx.isFriendlyTo(source, candidate))
      ) {
        continue;
      }
      const dx = candidate.pos.x - target.pos.x;
      const dz = candidate.pos.z - target.pos.z;
      const distance = dx * dx + dz * dz;
      if (distance > 100) continue;
      const fraction = candidate.maxHp > 0 ? candidate.hp / candidate.maxHp : 1;
      if (
        best === null ||
        fraction < bestFrac ||
        (fraction === bestFrac &&
          (distance < bestDist || (distance === bestDist && candidate.id < best.id)))
      ) {
        best = candidate;
        bestFrac = fraction;
        bestDist = distance;
      }
    }
    if (best) depositRawMendingCurrent(ctx, source, best, calculatedHealing * 0.5);
  }
  return added;
}

/**
 * Handles one scheduled pool tick. Returns true only for Mending Current so the
 * generic HoT path can skip its fixed-per-tick interpretation.
 */
export function tickMendingCurrent(ctx: SimContext, target: Entity, aura: Aura): boolean {
  if (aura.id !== MENDING_CURRENT_ID || aura.kind !== 'hot') return false;
  const source = ctx.entities.get(aura.sourceId);
  if (!source || source.dead || !isSpiritmend(ctx, source)) {
    aura.value = 0;
    aura.remaining = 0;
    return true;
  }
  const ticksIncludingThis = Math.floor(Math.max(0, aura.remaining) / MENDING_CURRENT_INTERVAL) + 1;
  const proposed = Math.min(aura.value, Math.ceil(aura.value / ticksIncludingThis));
  aura.value = Math.max(0, aura.value - proposed);
  if (proposed > 0) {
    ctx.applyHeal(source, target, proposed, 'Mending Current', MENDING_CURRENT_ID, false, false);
  }
  return true;
}

/** Consume only this healer's pool after the canonical Chain Heal hop lands. */
export function consumeMendingCurrent(ctx: SimContext, source: Entity, target: Entity): number {
  if (!isSpiritmend(ctx, source)) return 0;
  const index = currentIndex(target, source.id);
  if (index < 0) return 0;
  const current = removeAuraAt(ctx, target, index);
  const proposed = Math.max(0, Math.round((current?.value ?? 0) * CURRENT_CONSUME_MULTIPLIER));
  if (proposed > 0 && !target.dead) {
    ctx.applyHeal(source, target, proposed, 'Mending Current', MENDING_CURRENT_ID, false, false);
    ctx.emit({
      type: 'spellfx',
      sourceId: source.id,
      targetId: target.id,
      school: 'nature',
      fx: 'echoBurst',
    });
    if (shamanTalentSelected(ctx, source, SHAMAN_TALENT_IDS.echoingElements)) {
      ctx.applyAura(target, {
        id: 'shaman_echoing_elements_heal',
        name: 'Echoing Elements',
        kind: 'hot',
        value: Math.max(1, Math.round(proposed * 0.4)),
        remaining: 2,
        duration: 2,
        tickInterval: 2,
        tickTimer: 2,
        sourceId: source.id,
        school: 'nature',
      });
    }
    if (shamanTalentSelected(ctx, source, SHAMAN_TALENT_IDS.deepReservoir)) {
      depositRawMendingCurrent(ctx, source, target, (current?.value ?? 0) * 0.25);
    }
  }
  return proposed;
}

/**
 * Collapses one owned Mending Current into an immediate single-target rescue.
 * The guard is based on effective healing, so overhealing cannot inflate it.
 */
export function unleashMendingCurrent(ctx: SimContext, source: Entity, target: Entity): number {
  if (!isSpiritmend(ctx, source) || target.dead) return 0;
  const index = currentIndex(target, source.id);
  if (index < 0) return 0;
  const current = removeAuraAt(ctx, target, index);
  const proposed = Math.max(0, Math.round((current?.value ?? 0) * CURRENT_CONSUME_MULTIPLIER));
  if (proposed <= 0) return 0;
  const healed = ctx.applyHeal(
    source,
    target,
    proposed,
    'Unleash Weapon',
    'unleash_weapon',
    false,
    false,
  );
  const guard = Math.max(0, Math.round(healed * UNLEASH_WEAPON_GUARD_FRACTION));
  if (guard > 0) {
    ctx.applyAura(target, {
      id: UNLEASH_WEAPON_GUARD_ID,
      name: 'Unleash Weapon',
      kind: 'absorb',
      value: guard,
      remaining: UNLEASH_WEAPON_GUARD_DURATION,
      duration: UNLEASH_WEAPON_GUARD_DURATION,
      sourceId: source.id,
      school: 'nature',
    });
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: source.id,
    targetId: target.id,
    school: 'nature',
    fx: 'echoBurst',
  });
  return healed;
}

export function clearSpiritmendCurrents(ctx: SimContext, sourceId: number): void {
  for (const entity of ctx.entities.values()) {
    for (let index = entity.auras.length - 1; index >= 0; index--) {
      const aura = entity.auras[index];
      if (aura.id === MENDING_CURRENT_ID && aura.sourceId === sourceId) {
        removeAuraAt(ctx, entity, index);
      }
    }
  }
}

export function clearSpiritmendState(ctx: SimContext, player: Entity): void {
  clearSpiritmendCurrents(ctx, player.id);
  for (let index = player.auras.length - 1; index >= 0; index--) {
    if (player.auras[index].id === LIFESPRING_WEAPON_ID) removeAuraAt(ctx, player, index);
  }
}
