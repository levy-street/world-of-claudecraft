// Warlock Soulwell: a temporary, party-gated interactable that refills each
// eligible player to three stones. Pure sim module: the server owns every
// membership and capacity decision.

import { isBlocked } from './colliders';
import { createGroundObject } from './entity';
import type { SimContext } from './sim_context';
import type { Entity, Vec3 } from './types';

export const SOULWELL_ABILITY_ID = 'soulwell';
export const SOULWELL_OBJECT_ITEM_ID = 'soulwell';
export const SOUL_STONE_ITEM_ID = 'soul_stone';
export const SOUL_STONE_MAX = 3;
export const SOUL_STONE_HEAL_PCT_MAX = 0.25;
export const SOULWELL_DURATION = 180;
export const SOULWELL_FOOTPRINT_RADIUS = 1.45;
export const SOULWELL_WARD_DURATION = 30;

const SPAWN_DISTANCES = [2.6, 3.4, 4.2, 4.8] as const;
const SPAWN_ANGLE_OFFSETS = [
  0,
  Math.PI / 2,
  -Math.PI / 2,
  Math.PI,
  Math.PI / 4,
  -Math.PI / 4,
  (Math.PI * 3) / 4,
  (-Math.PI * 3) / 4,
] as const;

function isOwnedSoulwell(entity: Entity, ownerId: number): boolean {
  return (
    entity.kind === 'object' &&
    entity.objectItemId === SOULWELL_OBJECT_ITEM_ID &&
    entity.soulwell?.ownerId === ownerId
  );
}

function overlapsGroundObject(ctx: SimContext, casterId: number, x: number, z: number): boolean {
  for (const entity of ctx.entities.values()) {
    if (entity.id === casterId || entity.kind !== 'object') continue;
    if (Math.hypot(entity.pos.x - x, entity.pos.z - z) < SOULWELL_FOOTPRINT_RADIUS + 0.8) {
      return true;
    }
  }
  return false;
}

export function soulwellSpawnPosition(ctx: SimContext, caster: Entity): Vec3 | null {
  // Front is the natural placement. If authored geometry occupies it, walk a
  // fixed fan around the caster. The order is deterministic for replay/server
  // parity and keeps the interactable close enough to reach immediately.
  for (const distance of SPAWN_DISTANCES) {
    for (const offset of SPAWN_ANGLE_OFFSETS) {
      const angle = caster.facing + offset;
      const x = caster.pos.x + Math.sin(angle) * distance;
      const z = caster.pos.z + Math.cos(angle) * distance;
      if (
        !isBlocked(ctx.cfg.seed, x, z, SOULWELL_FOOTPRINT_RADIUS) &&
        !overlapsGroundObject(ctx, caster.id, x, z)
      ) {
        return ctx.groundPos(x, z);
      }
    }
  }

  // A fully enclosed custom-map position may have no valid footprint within
  // interaction range. Refuse that placement instead of intersecting scenery
  // or spawning an object its caster cannot reach.
  return null;
}

export function summonSoulwell(
  ctx: SimContext,
  caster: Entity,
  duration = SOULWELL_DURATION,
): Entity | null {
  const spawnPosition = soulwellSpawnPosition(ctx, caster);
  if (!spawnPosition) return null;

  // One live well per Warlock. Recasting replaces the old entity atomically
  // before the new one enters the roster, so clients never see two usable wells.
  for (const entity of [...ctx.entities.values()]) {
    if (isOwnedSoulwell(entity, caster.id)) ctx.dropEntity(entity.id);
  }

  const well = createGroundObject(ctx.nextId++, SOULWELL_OBJECT_ITEM_ID, 'Soulwell', spawnPosition);
  well.templateId = SOULWELL_ABILITY_ID;
  well.despawnTimer = duration;
  const partyMembers = ctx.partyOf(caster.id)?.members ?? [];
  const ownerMeta = ctx.players.get(caster.id);
  well.soulwell = {
    ownerId: caster.id,
    eligiblePlayerIds: [...new Set([caster.id, ...partyMembers])],
    wardAbsorbPctMax: ownerMeta ? ctx.playerMods(ownerMeta).global.warlockSoulwellWardPct : 0,
    wardedPlayerIds: [],
  };
  ctx.addEntity(well);
  return well;
}

/**
 * Returns false only when `object` is not a Soulwell. A true result means the
 * Soulwell owned the interaction, including a safely refused attempt.
 */
export function interactSoulwell(ctx: SimContext, object: Entity, actorId: number): boolean {
  if (
    object.kind !== 'object' ||
    object.objectItemId !== SOULWELL_OBJECT_ITEM_ID ||
    !object.soulwell
  ) {
    return false;
  }

  const state = object.soulwell;
  if (!state.eligiblePlayerIds.includes(actorId)) {
    ctx.error(actorId, 'That ally is not in your group.');
    return true;
  }

  const actor = ctx.entities.get(actorId);
  if (actor?.inCombat) {
    ctx.error(actorId, "You can't do that while in combat.");
    return true;
  }
  if (
    actor?.kind === 'player' &&
    state.wardAbsorbPctMax > 0 &&
    !state.wardedPlayerIds.includes(actorId)
  ) {
    state.wardedPlayerIds.push(actorId);
    ctx.applyAura(actor, {
      id: SOULWELL_ABILITY_ID,
      name: 'Soulwell',
      kind: 'absorb',
      remaining: SOULWELL_WARD_DURATION,
      duration: SOULWELL_WARD_DURATION,
      value: Math.round(actor.maxHp * state.wardAbsorbPctMax),
      sourceId: state.ownerId,
      school: 'shadow',
    });
  }

  const existing = ctx.countItem(SOUL_STONE_ITEM_ID, actorId);
  const grant = Math.max(0, SOUL_STONE_MAX - existing);
  if (grant === 0) {
    ctx.error(actorId, 'You have enough of those.');
    return true;
  }
  if (!ctx.canAddItem(SOUL_STONE_ITEM_ID, grant, actorId)) {
    ctx.error(actorId, 'Your bags are full.');
    return true;
  }

  ctx.addItem(SOUL_STONE_ITEM_ID, grant, actorId);
  return true;
}
