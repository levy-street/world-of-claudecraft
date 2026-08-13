import type { SimContext } from '../sim_context';
import { dist2d, type Entity, type Vec3 } from '../types';

export const UMBRAL_ANCHOR_ID = 'umbral_anchor';
export const UMBRAL_ANCHOR_COOLDOWN = 45;
export const UMBRAL_ANCHOR_MAX_RANGE = 40;

function anchorAura(entity: Entity) {
  return entity.auras.find(
    (aura) =>
      aura.id === UMBRAL_ANCHOR_ID && aura.kind === 'warlock_anchor' && aura.sourceId === entity.id,
  );
}

export function umbralAnchorPosition(entity: Entity): Vec3 | null {
  const aura = anchorAura(entity);
  if (!aura || aura.value2 === undefined || aura.value3 === undefined) return null;
  return { x: aura.value, y: aura.value2, z: aura.value3 };
}

export function hasUmbralAnchor(entity: Entity): boolean {
  return anchorAura(entity) !== undefined;
}

/** Returns a pre-billing cast error when an existing anchor is too far away. */
export function umbralAnchorCastError(entity: Entity, maxRange: number): string | null {
  const anchor = umbralAnchorPosition(entity);
  if (!anchor) return null;
  return dist2d(entity.pos, anchor) > maxRange ? 'Your Umbral Anchor is out of range.' : null;
}

export function placeOrRecallUmbralAnchor(
  ctx: SimContext,
  warlock: Entity,
  duration: number,
  maxRange: number,
): boolean {
  const anchor = umbralAnchorPosition(warlock);
  if (!anchor) {
    ctx.applyAura(warlock, {
      id: UMBRAL_ANCHOR_ID,
      name: 'Umbral Anchor',
      kind: 'warlock_anchor',
      remaining: duration,
      duration,
      value: warlock.pos.x,
      value2: warlock.pos.y,
      value3: warlock.pos.z,
      sourceId: warlock.id,
      school: 'shadow',
    });
    ctx.emit({
      type: 'spellfxAt',
      x: warlock.pos.x,
      z: warlock.pos.z,
      school: 'shadow',
      fx: 'nova',
      radius: 2.4,
    });
    return false;
  }

  // The lifecycle rejects an invalid recall before billing. Keep this guard so
  // direct effect invocations can never turn the anchor into an unlimited teleport.
  if (dist2d(warlock.pos, anchor) > maxRange) return false;

  const from = { ...warlock.pos };
  warlock.pos = { ...anchor };
  warlock.prevPos = { ...anchor };
  warlock.vy = 0;
  warlock.onGround = true;
  warlock.jumping = false;
  warlock.fallStartY = anchor.y;
  warlock.chargeTargetId = null;
  warlock.chargePath = [];
  warlock.leap = null;
  ctx.rebucket(warlock);

  for (let index = warlock.auras.length - 1; index >= 0; index--) {
    const aura = warlock.auras[index];
    if (
      aura.id !== UMBRAL_ANCHOR_ID ||
      aura.kind !== 'warlock_anchor' ||
      aura.sourceId !== warlock.id
    ) {
      continue;
    }
    warlock.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: warlock.id, name: aura.name, gained: false });
  }

  for (const point of [from, anchor]) {
    ctx.emit({
      type: 'spellfxAt',
      x: point.x,
      z: point.z,
      school: 'shadow',
      fx: 'nova',
      radius: 2.4,
    });
  }
  return true;
}
