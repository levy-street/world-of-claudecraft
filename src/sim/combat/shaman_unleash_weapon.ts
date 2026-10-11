import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { LIFESPRING_WEAPON_ID, mendingCurrent, unleashMendingCurrent } from './shaman_spiritmend';
import { addThunderCharges } from './shaman_thundercall';
import {
  advanceWarspiritCadence,
  applyStoneboundJolt,
  GALEHEART_WEAPON_ID,
  STONEBOUND_WEAPON_ID,
} from './shaman_warspirit';
import { spellDamageMultFromAuras } from './spell_combat';

export const PYREBRAND_WEAPON_ID = 'flametongue_weapon';
export const GALEHEART_UNLEASH_HASTE_ID = 'shaman_galeheart_unleash_haste';
export const STONEBOUND_UNLEASH_GUARD_ID = 'shaman_stonebound_unleash_guard';

export const PYREBRAND_UNLEASH_MIN = 54;
export const PYREBRAND_UNLEASH_MAX = 64;
export const PYREBRAND_UNLEASH_SPELL_POWER_COEFFICIENT = 0.3;
export const PYREBRAND_UNLEASH_THUNDER = 2;
export const GALEHEART_UNLEASH_HASTE = 1.2;
export const GALEHEART_UNLEASH_HASTE_DURATION = 6;
export const STONEBOUND_UNLEASH_DAMAGE_REDUCTION = 0.2;
export const STONEBOUND_UNLEASH_GUARD_DURATION = 4;

export type UnleashWeaponEnchant = 'pyrebrand' | 'galeheart' | 'stonebound' | 'lifespring';

export function activeUnleashWeaponEnchant(player: Entity): UnleashWeaponEnchant | null {
  if (player.auras.some((aura) => aura.id === PYREBRAND_WEAPON_ID)) return 'pyrebrand';
  if (player.auras.some((aura) => aura.id === GALEHEART_WEAPON_ID)) return 'galeheart';
  if (player.auras.some((aura) => aura.id === STONEBOUND_WEAPON_ID)) return 'stonebound';
  if (player.auras.some((aura) => aura.id === LIFESPRING_WEAPON_ID)) return 'lifespring';
  return null;
}

function entityForTargetId(ctx: SimContext, targetId: number | null): Entity | null {
  if (targetId === null) return null;
  const target = ctx.entities.get(targetId);
  return target && !target.dead ? target : null;
}

export function resolveUnleashWeaponTarget(
  ctx: SimContext,
  player: Entity,
  targetOverride: number | null,
): Entity | null {
  const enchant = activeUnleashWeaponEnchant(player);
  const override = entityForTargetId(ctx, targetOverride);
  const selected = entityForTargetId(ctx, player.targetId);
  if (enchant === 'lifespring') {
    for (const candidate of [override, selected]) {
      if (candidate && (candidate.id === player.id || ctx.isFriendlyTo(player, candidate))) {
        return candidate;
      }
    }
    return player;
  }
  for (const candidate of [override, selected]) {
    if (candidate && ctx.isHostileTo(player, candidate)) return candidate;
  }
  return null;
}

export function unleashWeaponCastError(player: Entity, target: Entity | null): string | null {
  const enchant = activeUnleashWeaponEnchant(player);
  if (!enchant) return 'That ability is not ready yet.';
  if (enchant === 'lifespring') {
    if (!target || !mendingCurrent(target, player.id)) return 'That ability is not ready yet.';
    return null;
  }
  return target ? null : 'You have no target.';
}

function applyPyrebrandUnleash(ctx: SimContext, player: Entity, target: Entity): void {
  let damage =
    ctx.rng.range(PYREBRAND_UNLEASH_MIN, PYREBRAND_UNLEASH_MAX) +
    Math.round(player.spellPower * PYREBRAND_UNLEASH_SPELL_POWER_COEFFICIENT);
  damage *= spellDamageMultFromAuras(player);
  const crit = ctx.rng.chance(ctx.spellCrit(player));
  if (crit) damage *= 1.5 + player.critDmgSpellBonus;
  ctx.dealDamage(
    player,
    target,
    Math.max(1, Math.round(damage)),
    crit,
    'fire',
    'Unleash Weapon',
    'hit',
    false,
    undefined,
    true,
    false,
    false,
    'unleash_weapon',
  );
  addThunderCharges(ctx, player, PYREBRAND_UNLEASH_THUNDER);
}

function applyGaleheartUnleash(ctx: SimContext, player: Entity, target: Entity): void {
  const connected = ctx.meleeSwing(player, target, 0, 'Unleash Weapon', {
    weaponMult: 1,
    onDealt: (amount) => advanceWarspiritCadence(ctx, player, target, amount),
  });
  if (!connected) return;
  ctx.applyAura(player, {
    id: GALEHEART_UNLEASH_HASTE_ID,
    name: 'Unleash Weapon',
    kind: 'buff_haste',
    value: GALEHEART_UNLEASH_HASTE,
    remaining: GALEHEART_UNLEASH_HASTE_DURATION,
    duration: GALEHEART_UNLEASH_HASTE_DURATION,
    sourceId: player.id,
    school: 'nature',
  });
}

function applyStoneboundUnleash(ctx: SimContext, player: Entity, target: Entity): void {
  const connected = ctx.meleeSwing(player, target, 0, 'Unleash Weapon', {
    weaponMult: 0.75,
  });
  if (connected) applyStoneboundJolt(ctx, player, target);
  ctx.applyAura(player, {
    id: STONEBOUND_UNLEASH_GUARD_ID,
    name: 'Unleash Weapon',
    kind: 'buff_dr',
    value: STONEBOUND_UNLEASH_DAMAGE_REDUCTION,
    remaining: STONEBOUND_UNLEASH_GUARD_DURATION,
    duration: STONEBOUND_UNLEASH_GUARD_DURATION,
    sourceId: player.id,
    school: 'nature',
  });
}

export function runUnleashWeapon(ctx: SimContext, player: Entity, target: Entity | null): void {
  if (!target || target.dead) return;
  switch (activeUnleashWeaponEnchant(player)) {
    case 'pyrebrand':
      applyPyrebrandUnleash(ctx, player, target);
      break;
    case 'galeheart':
      applyGaleheartUnleash(ctx, player, target);
      break;
    case 'stonebound':
      applyStoneboundUnleash(ctx, player, target);
      break;
    case 'lifespring':
      unleashMendingCurrent(ctx, player, target);
      break;
  }
}
