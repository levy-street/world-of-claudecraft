import {
  SLAGSNARE_2PC_GUTTING_STRIKE_FOCUS,
  SLAGSNARE_4PC_MOMENTUM_ICD_SEC,
  setBonusFlag,
} from '../content/ignivar_set_bonuses';
import { GRAVITY, JUMP_VELOCITY } from '../player_motion';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { armorReduction, dist2d } from '../types';
import { hasUnbreakableMovementLock } from './cc';
import { grantHunterFocus, onHunterTrailbreak } from './hunter_shared';

export const BLOODHOOK_BLEED_ID = 'bloodhook_bleed';
export const HUNTING_MOMENTUM_ID = 'hunting_momentum';
export const FIELDCRAFT_REENTRY_ID = 'fieldcraft_reentry';
/** Slagsnare 4pc: the once-per-8-sec Woundrend momentum-preserve lockout. */
export const SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID = 'slagsnare_momentum_icd';
const BLOODHOOK_PENDING_ID = 'bloodhook_pending';
/** Base Focus a landed Gutting Strike grants (the Slagsnare 2pc bends it). */
const GUTTING_STRIKE_BASE_FOCUS = 15;

function removeAura(ctx: SimContext, entity: Entity, id: string): void {
  const index = entity.auras.findIndex((aura) => aura.id === id);
  if (index < 0) return;
  const [aura] = entity.auras.splice(index, 1);
  ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
}

function applyPrimaryWound(
  ctx: SimContext,
  hunter: Entity,
  target: Entity,
  total: number,
  duration: number,
  interval: number,
): void {
  const ticks = Math.max(1, Math.round(duration / interval));
  ctx.applyAura(target, {
    id: BLOODHOOK_BLEED_ID,
    name: 'Bloodhook Wound',
    kind: 'dot',
    remaining: duration,
    duration,
    value: Math.max(1, Math.round(total / ticks)),
    tickInterval: interval,
    tickTimer: interval,
    sourceId: hunter.id,
    school: 'physical',
  });
  ctx.enterCombat(hunter, target);
}

function fieldcraftPhysicalDamage(
  ctx: SimContext,
  hunter: Entity,
  target: Entity,
  min: number,
  max: number,
  ability: string,
  damageMult = 1,
): number {
  const crit = ctx.rng.chance(hunter.critChance);
  let amount = (ctx.rng.range(min, max) + hunter.rangedPower * 0.08) * damageMult;
  if (crit) amount *= 2 + hunter.critDmgPhysBonus;
  amount *= 1 - armorReduction(ctx.effectiveArmor(target), hunter.level);
  const dealt = Math.max(1, Math.round(amount));
  ctx.dealDamage(hunter, target, dealt, crit, 'physical', ability, 'hit', false, undefined, true);
  return dealt;
}

export function bloodhookStartError(
  ctx: SimContext,
  hunter: Entity,
  target: Entity | null,
): string | null {
  if (!target || target.dead || !ctx.isHostileTo(hunter, target)) return 'You have no target.';
  if (hasUnbreakableMovementLock(hunter)) return 'You cannot move.';
  const path = ctx.findChargePath(hunter, target);
  if (path.length === 0) return 'No safe path to that target.';
  const end = path[path.length - 1];
  if (dist2d(end, target.pos) > 4) return 'No safe path to that target.';
  return null;
}

export function startBloodhook(
  ctx: SimContext,
  hunter: Entity,
  target: Entity | null,
  effect: {
    bleedTotal: number;
    bleedDuration: number;
    bleedInterval: number;
    rangedPowerCoeff: number;
    damageMult?: number;
  },
): void {
  if (!target) return;
  hunter.chargeTargetId = target.id;
  hunter.chargeTimeLeft = 3;
  hunter.chargePath = ctx.findChargePath(hunter, target);
  ctx.applyAura(hunter, {
    id: BLOODHOOK_PENDING_ID,
    name: 'Bloodhook',
    kind: 'internal_cd',
    remaining: 3,
    duration: 3,
    value: target.id,
    value2:
      (effect.bleedTotal + hunter.rangedPower * effect.rangedPowerCoeff) * (effect.damageMult ?? 1),
    value3: effect.bleedDuration,
    tickInterval: effect.bleedInterval,
    sourceId: hunter.id,
    school: 'physical',
  });
  ctx.enterCombat(hunter, target);
}

export function finishBloodhook(
  ctx: SimContext,
  hunter: Entity,
  target: Entity | null,
  arrived: boolean,
): void {
  const pending = hunter.auras.find((aura) => aura.id === BLOODHOOK_PENDING_ID);
  if (!pending) return;
  removeAura(ctx, hunter, BLOODHOOK_PENDING_ID);
  if (!arrived || !target || target.dead || target.id !== pending.value) {
    hunter.cooldowns.delete('bloodhook');
    return;
  }
  const woundTotal = pending.value2 ?? 36;
  applyPrimaryWound(
    ctx,
    hunter,
    target,
    woundTotal,
    pending.value3 ?? 12,
    pending.tickInterval ?? 3,
  );
  const bloodtrail = hunter.auras.some((aura) => aura.kind === 'hunter_bloodtrail');
  if (bloodtrail) {
    const nearby = ctx
      .hostilesInRadius(hunter, target.pos, 5)
      .filter((enemy) => enemy.id !== target.id && !enemy.dead)
      .sort((a, b) => dist2d(a.pos, target.pos) - dist2d(b.pos, target.pos) || a.id - b.id)
      .slice(0, 2);
    for (const enemy of nearby) {
      applyPrimaryWound(
        ctx,
        hunter,
        enemy,
        Math.round(woundTotal * 0.6),
        pending.value3 ?? 12,
        pending.tickInterval ?? 3,
      );
    }
  }
  const momentum = hunter.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID);
  if (hunter.auras.some((aura) => aura.id === FIELDCRAFT_REENTRY_ID) && momentum) {
    const stacks = momentum.stacks ?? 1;
    fieldcraftPhysicalDamage(
      ctx,
      hunter,
      target,
      18 * (1 + 0.15 * stacks),
      24 * (1 + 0.15 * stacks),
      'Bloodhook Re-entry',
    );
    removeAura(ctx, hunter, FIELDCRAFT_REENTRY_ID);
    if (stacks >= 3) removeAura(ctx, hunter, HUNTING_MOMENTUM_ID);
  }
}

function slagsnarePreservesMomentum(ctx: SimContext, hunter: Entity, meta: PlayerMeta): boolean {
  if (ctx.playerMods(meta).selected[setBonusFlag('slagsnare', 4)] !== true) return false;
  return !hunter.auras.some((aura) => aura.id === SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID);
}

function armSlagsnarePreserveLockout(ctx: SimContext, hunter: Entity): void {
  ctx.applyAura(hunter, {
    id: SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID,
    // The localized 'Hunting Momentum' string is deliberately reused (the
    // Oathpyre bulwark precedent): the lockout is Momentum's own once-per-8s
    // preserve, and a new aura name would need a dictionary row across every
    // locale. The distinct id keeps it from ever replacing the stacks aura.
    name: 'Hunting Momentum',
    kind: 'internal_cd',
    remaining: SLAGSNARE_4PC_MOMENTUM_ICD_SEC,
    duration: SLAGSNARE_4PC_MOMENTUM_ICD_SEC,
    value: 1,
    sourceId: hunter.id,
    school: 'physical',
  });
}

function setMomentum(ctx: SimContext, hunter: Entity, stacks: number): void {
  ctx.applyAura(hunter, {
    id: HUNTING_MOMENTUM_ID,
    name: 'Hunting Momentum',
    kind: 'hunter_momentum',
    remaining: 8,
    duration: 8,
    value: stacks,
    stacks,
    sourceId: hunter.id,
    school: 'physical',
  });
}

function petFollowup(ctx: SimContext, hunter: Entity, target: Entity, amount = 18): void {
  const pet = ctx.petOf(hunter.id);
  if (!pet || pet.dead || target.dead) return;
  ctx.dealDamage(pet, target, amount, false, 'physical', 'Bloodtrail Follow-up', 'hit', true);
}

export function onFieldcraftWeaponStrike(
  ctx: SimContext,
  hunter: Entity,
  target: Entity,
  abilityId: string,
  dealt: number,
): void {
  const meta = ctx.players.get(hunter.id);
  if (meta?.cls !== 'hunter' || meta.talents.spec !== 'survival' || dealt <= 0) return;
  if (abilityId === 'raptor_strike') {
    // Slagsnare 2pc: the module-constant grant rises 15 -> 20 for wearers.
    // preResolved stays false, so the Harrier and Efficient Rhythm riders
    // apply after, exactly as they do for the base grant.
    const guttingFocus =
      ctx.playerMods(meta).selected[setBonusFlag('slagsnare', 2)] === true
        ? SLAGSNARE_2PC_GUTTING_STRIKE_FOCUS
        : GUTTING_STRIKE_BASE_FOCUS;
    grantHunterFocus(ctx, hunter, guttingFocus, 'raptor_strike');
    const current = hunter.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID)?.stacks ?? 0;
    setMomentum(ctx, hunter, Math.min(3, current + 1));
    if (hunter.auras.some((aura) => aura.id === FIELDCRAFT_REENTRY_ID)) {
      const stacks = Math.min(3, current + 1);
      const bonus = Math.max(1, Math.round(dealt * 0.15 * stacks));
      ctx.dealDamage(hunter, target, bonus, false, 'physical', 'Hunting Momentum', 'hit', true);
      removeAura(ctx, hunter, FIELDCRAFT_REENTRY_ID);
      if (stacks >= 3) removeAura(ctx, hunter, HUNTING_MOMENTUM_ID);
    }
    return;
  }
  if (abilityId !== 'mongoose_bite') return;
  const wound = target.auras.find(
    (aura) => aura.id === BLOODHOOK_BLEED_ID && aura.sourceId === hunter.id,
  );
  if (wound) {
    ctx.dealDamage(
      hunter,
      target,
      Math.round(wound.value),
      false,
      'physical',
      'Woundrend',
      'hit',
      true,
    );
    wound.remaining = wound.duration;
    wound.tickTimer = wound.tickInterval;
  }
  const momentum = hunter.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID);
  if (momentum) {
    momentum.remaining = momentum.duration;
    const stacks = momentum.stacks ?? 1;
    if (stacks >= 3) {
      const bonus = Math.max(1, Math.round(dealt * 0.15 * stacks));
      ctx.dealDamage(hunter, target, bonus, false, 'physical', 'Hunting Momentum', 'hit', true);
      // Slagsnare 4pc: the Woundrend consume (this site ONLY; the Re-entry
      // consumers keep spending the stacks) preserves the 3 stacks, once per
      // 8 sec. The lockout's 8 sec deliberately MATCHES the Momentum window,
      // and the refresh above already restarted that window, so preserved
      // stacks carry a full 8 sec. The payoff damage above stays at 3-stack
      // value either way. Deterministic, no rng.
      if (slagsnarePreservesMomentum(ctx, hunter, meta)) {
        armSlagsnarePreserveLockout(ctx, hunter);
      } else {
        removeAura(ctx, hunter, HUNTING_MOMENTUM_ID);
      }
    }
  }
  if (hunter.auras.some((aura) => aura.kind === 'hunter_bloodtrail'))
    petFollowup(ctx, hunter, target);
}

export function runShrapnelCharge(
  ctx: SimContext,
  hunter: Entity,
  target: Entity | null,
  effect: {
    primaryMin: number;
    primaryMax: number;
    splashMin: number;
    splashMax: number;
    radius: number;
    maxTargets: number;
    spreadTotal: number;
    spreadDuration: number;
    spreadInterval: number;
    damageMult?: number;
  },
  abilityName: string,
): void {
  if (!target || target.dead) return;
  const empowered = hunter.auras.some((aura) => aura.kind === 'hunter_bloodtrail');
  const radius = effect.radius + (empowered ? 2 : 0);
  fieldcraftPhysicalDamage(
    ctx,
    hunter,
    target,
    effect.primaryMin * (empowered ? 1.25 : 1),
    effect.primaryMax * (empowered ? 1.25 : 1),
    abilityName,
    effect.damageMult,
  );
  const primaryWound = target.auras.find(
    (aura) => aura.id === BLOODHOOK_BLEED_ID && aura.sourceId === hunter.id,
  );
  if (primaryWound) {
    ctx.dealDamage(
      hunter,
      target,
      Math.round(primaryWound.value * (empowered ? 1.5 : 1)),
      false,
      'physical',
      abilityName,
      'hit',
      true,
    );
  }
  const nearby = ctx
    .hostilesInRadius(hunter, target.pos, radius)
    .filter((enemy) => enemy.id !== target.id && !enemy.dead && ctx.hasLineOfSight(target, enemy))
    .sort((a, b) => dist2d(a.pos, target.pos) - dist2d(b.pos, target.pos) || a.id - b.id)
    .slice(0, Math.max(0, effect.maxTargets - 1));
  for (const enemy of nearby) {
    fieldcraftPhysicalDamage(
      ctx,
      hunter,
      enemy,
      effect.splashMin,
      effect.splashMax,
      abilityName,
      effect.damageMult,
    );
    const ticks = Math.max(1, Math.round(effect.spreadDuration / effect.spreadInterval));
    ctx.applyAura(enemy, {
      id: 'shrapnel_wound',
      name: 'Shrapnel Wound',
      kind: 'dot',
      remaining: effect.spreadDuration,
      duration: effect.spreadDuration,
      value: Math.max(1, Math.round((effect.spreadTotal * (effect.damageMult ?? 1)) / ticks)),
      tickInterval: effect.spreadInterval,
      tickTimer: effect.spreadInterval,
      sourceId: hunter.id,
      school: 'physical',
    });
  }
}

export function trailbreak(ctx: SimContext, hunter: Entity, distance: number): void {
  onHunterTrailbreak(ctx, hunter);
  const flightSeconds = (2 * JUMP_VELOCITY) / GRAVITY;
  const horizontalSpeed = distance / flightSeconds;
  hunter.vx = -Math.sin(hunter.facing) * horizontalSpeed;
  hunter.vz = -Math.cos(hunter.facing) * horizontalSpeed;
  hunter.vy = JUMP_VELOCITY;
  hunter.onGround = false;
  hunter.jumping = true;
  hunter.fallStartY = hunter.pos.y;
  const momentum = hunter.auras.find((aura) => aura.id === HUNTING_MOMENTUM_ID);
  if (!momentum) return;
  momentum.remaining = momentum.duration;
  ctx.applyAura(hunter, {
    id: FIELDCRAFT_REENTRY_ID,
    name: 'Armed Re-entry',
    kind: 'hunter_reentry',
    remaining: 12,
    duration: 12,
    value: momentum.stacks ?? 1,
    stacks: momentum.stacks,
    sourceId: hunter.id,
    school: 'physical',
  });
}

export function clearFieldcraftState(ctx: SimContext, hunter: Entity): void {
  removeAura(ctx, hunter, HUNTING_MOMENTUM_ID);
  removeAura(ctx, hunter, FIELDCRAFT_REENTRY_ID);
  removeAura(ctx, hunter, BLOODHOOK_PENDING_ID);
  removeAura(ctx, hunter, SLAGSNARE_MOMENTUM_PRESERVE_ICD_ID);
  for (const entity of ctx.entities.values()) {
    entity.auras = entity.auras.filter(
      (aura) =>
        aura.sourceId !== hunter.id ||
        (aura.id !== BLOODHOOK_BLEED_ID && aura.id !== 'shrapnel_wound'),
    );
  }
}
