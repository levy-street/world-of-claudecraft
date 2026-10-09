import { createMob } from '../entity';
import type { SimContext } from '../sim_context';
import {
  DT,
  dist2d,
  type Entity,
  type GuardianState,
  type MobTemplate,
  steadyAngleTo,
} from '../types';

export interface GuardianConfig extends Omit<GuardianState, 'attackTimer'> {
  name: string;
  color: number;
  scale: number;
}

const GUARDIAN_TEMPLATE: MobTemplate = {
  id: 'temporary_guardian',
  name: 'Guardian',
  minLevel: 1,
  maxLevel: 20,
  family: 'elemental',
  hpBase: 200,
  hpPerLevel: 20,
  dmgBase: 1,
  dmgPerLevel: 0,
  attackSpeed: 2,
  armorPerLevel: 0,
  moveSpeed: 0,
  aggroRadius: 0,
  loot: [],
  scale: 0.8,
  color: 0x51246f,
};

export function guardianOf(ctx: SimContext, ownerId: number, key: string): Entity | null {
  for (const entity of ctx.entities.values()) {
    if (entity.ownerId === ownerId && entity.guardianState?.key === key) return entity;
  }
  return null;
}

export function dismissGuardian(ctx: SimContext, guardian: Entity): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: guardian.id,
    targetId: guardian.id,
    school: guardian.guardianState?.school ?? 'shadow',
    fx: 'echoBurst',
  });
  ctx.dropEntity(guardian.id);
}

export function dismissOwnedGuardians(ctx: SimContext, ownerId: number): void {
  for (const entity of [...ctx.entities.values()]) {
    if (entity.ownerId === ownerId && entity.guardianState) dismissGuardian(ctx, entity);
  }
}

export function summonGuardian(ctx: SimContext, owner: Entity, config: GuardianConfig): Entity {
  const existing = guardianOf(ctx, owner.id, config.key);
  if (existing) dismissGuardian(ctx, existing);

  const template: MobTemplate = {
    ...GUARDIAN_TEMPLATE,
    id: `guardian_${config.key}`,
    name: config.name,
    scale: config.scale,
    color: config.color,
  };
  const pos = ctx.groundPos(owner.pos.x + 1.5, owner.pos.z + 1.5);
  const guardian = createMob(ctx.nextId++, template, owner.level, pos);
  guardian.ownerId = owner.id;
  guardian.hostile = false;
  guardian.name = config.name;
  guardian.aiState = 'idle';
  guardian.aggroTargetId = null;
  guardian.inCombat = false;
  guardian.loot = null;
  guardian.lootable = false;
  guardian.guardianState = {
    key: config.key,
    remaining: config.remaining,
    attackTimer: Math.min(0.5, config.attackInterval),
    attackInterval: config.attackInterval,
    minDamage: config.minDamage,
    maxDamage: config.maxDamage,
    spellPowerCoeff: config.spellPowerCoeff,
    school: config.school,
    abilityId: config.abilityId,
    abilityName: config.abilityName,
    preferredTargetId: config.preferredTargetId,
    maxRange: config.maxRange,
    requiredTargetAuraId: config.requiredTargetAuraId,
    dismissWhenUntargeted: config.dismissWhenUntargeted,
    // Only a melee guardian carries the key, so every standing guardian's
    // state stays exactly as before.
    ...(config.melee ? { melee: { ...config.melee } } : {}),
  };
  ctx.addEntity(guardian);
  ctx.emit({
    type: 'spellfx',
    sourceId: owner.id,
    targetId: guardian.id,
    school: config.school,
    fx: 'echoBurst',
  });
  return guardian;
}

function guardianTarget(ctx: SimContext, guardian: Entity, owner: Entity): Entity | null {
  const state = guardian.guardianState;
  if (!state) return null;
  const validTarget = (target: Entity): boolean =>
    !target.dead &&
    ctx.isHostileTo(owner, target) &&
    dist2d(owner.pos, target.pos) <= state.maxRange &&
    (state.requiredTargetAuraId === undefined ||
      target.auras.some(
        (aura) => aura.id === state.requiredTargetAuraId && aura.sourceId === owner.id,
      ));
  const preferred =
    state.preferredTargetId === null ? null : (ctx.entities.get(state.preferredTargetId) ?? null);
  if (preferred && validTarget(preferred)) return preferred;

  const candidates = ctx
    .hostilesInRadius(owner, owner.pos, state.maxRange)
    .filter(validTarget)
    .map((entity) => ({
      entity,
      distance: dist2d(owner.pos, entity.pos),
    }));
  candidates.sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id);
  return candidates[0]?.entity ?? null;
}

/** Returns false when the guardian despawned and must not receive later mob updates. */
export function updateGuardian(ctx: SimContext, guardian: Entity): boolean {
  const state = guardian.guardianState;
  if (!state) return true;
  const owner = guardian.ownerId === null ? null : (ctx.entities.get(guardian.ownerId) ?? null);
  state.remaining -= DT;
  if (!owner || owner.dead || state.remaining <= 0) {
    dismissGuardian(ctx, guardian);
    return false;
  }

  if (state.melee) return updateMeleeGuardian(ctx, guardian, owner, state, state.melee);

  state.attackTimer -= DT;
  if (state.attackTimer > 0) return true;
  const target = guardianTarget(ctx, guardian, owner);
  if (!target) {
    if (state.dismissWhenUntargeted) {
      dismissGuardian(ctx, guardian);
      return false;
    }
    state.attackTimer = Math.min(0.25, state.attackInterval);
    return true;
  }

  state.attackTimer += state.attackInterval;
  guardian.facing = Math.atan2(target.pos.x - guardian.pos.x, target.pos.z - guardian.pos.z);
  ctx.emit({
    type: 'spellfx',
    sourceId: guardian.id,
    targetId: target.id,
    school: state.school,
    fx: 'projectile',
  });
  ctx.dealDamage(
    guardian,
    target,
    ctx.rng.range(state.minDamage, state.maxDamage) +
      Math.round(owner.spellPower * (state.spellPowerCoeff ?? 0)),
    false,
    state.school,
    state.abilityName,
    'hit',
    true,
    undefined,
    true,
    false,
    false,
    state.abilityId,
    false,
  );
  return ctx.entities.has(guardian.id);
}

/** How close a melee guardian with no target keeps to its owner. */
const MELEE_GUARDIAN_HEEL = 3;

/** A melee guardian (GuardianState.melee): it assists its owner's current
 *  hostile target (else its preferred one, else the nearest enemy), runs to it
 *  and bites in melee reach on its attack interval. With no target it runs back
 *  to its owner's side. No rng beyond the bite's own damage roll. */
function updateMeleeGuardian(
  ctx: SimContext,
  guardian: Entity,
  owner: Entity,
  state: GuardianState,
  melee: NonNullable<GuardianState['melee']>,
): boolean {
  const assist = owner.targetId === null ? null : (ctx.entities.get(owner.targetId) ?? null);
  if (assist && !assist.dead && ctx.isHostileTo(owner, assist)) state.preferredTargetId = assist.id;
  // The swing timer winds down while it runs, so it bites on arrival.
  state.attackTimer = Math.max(0, state.attackTimer - DT);
  const target = guardianTarget(ctx, guardian, owner);
  if (!target) {
    if (state.dismissWhenUntargeted) {
      dismissGuardian(ctx, guardian);
      return false;
    }
    if (dist2d(guardian.pos, owner.pos) > MELEE_GUARDIAN_HEEL)
      ctx.moveToward(guardian, owner.pos, melee.moveSpeed, true);
    return true;
  }
  if (dist2d(guardian.pos, target.pos) > melee.reach) {
    // A spirit runs straight through brush and shallows to its prey.
    ctx.moveToward(guardian, target.pos, melee.moveSpeed, true);
    return true;
  }
  guardian.facing = steadyAngleTo(guardian.pos, target.pos, guardian.facing);
  if (state.attackTimer > 0) return true;
  state.attackTimer = state.attackInterval;
  ctx.dealDamage(
    guardian,
    target,
    ctx.rng.range(state.minDamage, state.maxDamage),
    false,
    state.school,
    state.abilityName,
    'hit',
    true,
    undefined,
    true,
    false,
    false,
    state.abilityId,
    false,
  );
  return ctx.entities.has(guardian.id);
}
