import { GOURDLIGHT_EVE_ID, GOURDLIGHT_SWEET_ID } from '../content/gourdlight_eve';
import {
  GOURDLIGHT_PUMPKINS,
  type GourdlightPumpkin,
  HAUNTED_PUMPKIN_TEMPLATE,
} from '../content/gourdlight_pumpkins';
import { createGroundObject } from '../entity';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { markGourdlightPumpkinHunt } from './gourdlight_deed_marks';
import { activeSeasonalEventOf } from './seasonal_state';

// Reserved IDs never consume the normal entity allocator or world RNG.
const ENTITY_BASE = -910000;
export function hauntedPumpkinForEntity(
  entity: Pick<Entity, 'id' | 'templateId'>,
): GourdlightPumpkin | undefined {
  return entity.templateId === HAUNTED_PUMPKIN_TEMPLATE
    ? GOURDLIGHT_PUMPKINS[ENTITY_BASE - entity.id]
    : undefined;
}

export function updateHauntedPumpkins(ctx: SimContext, active: string | null): void {
  for (let i = 0; i < GOURDLIGHT_PUMPKINS.length; i++) {
    const id = ENTITY_BASE - i;
    if (active !== GOURDLIGHT_EVE_ID) {
      if (ctx.entities.get(id)?.templateId === HAUNTED_PUMPKIN_TEMPLATE) ctx.dropEntity(id);
    } else if (!ctx.entities.has(id)) {
      const def = GOURDLIGHT_PUMPKINS[i];
      ctx.addEntity(
        createGroundObject(id, 'haunted_pumpkin', 'Haunted Pumpkin', ctx.groundPos(def.x, def.z)),
      );
    }
  }
}

export function discoverHauntedPumpkin(ctx: SimContext, obj: Entity, meta: PlayerMeta): boolean {
  const def = hauntedPumpkinForEntity(obj);
  if (
    !def ||
    activeSeasonalEventOf(ctx.seasonal) !== GOURDLIGHT_EVE_ID ||
    meta.hauntedPumpkins.has(def.id)
  )
    return false;
  if (!ctx.canAddItem(GOURDLIGHT_SWEET_ID, 1, meta.entityId)) {
    ctx.error(meta.entityId, 'Your bags are full.');
    return false;
  }
  ctx.addItem(GOURDLIGHT_SWEET_ID, 1, meta.entityId);
  meta.hauntedPumpkins.add(def.id);
  const zone = GOURDLIGHT_PUMPKINS.filter((p) => p.zoneId === def.zoneId);
  ctx.emit({
    type: 'seasonal',
    what: 'pumpkinFound',
    pumpkinId: def.id,
    zoneId: def.zoneId,
    count: zone.filter((p) => meta.hauntedPumpkins.has(p.id)).length,
    total: zone.length,
    sweets: 1,
    pid: meta.entityId,
  });
  if (GOURDLIGHT_PUMPKINS.every((p) => meta.hauntedPumpkins.has(p.id))) {
    ctx.grantDeed(meta, 'feat_pumpkin_hunter');
    // the whole-event checklist's hunt leaf (lifetime, unlike the edition's ledger)
    markGourdlightPumpkinHunt(ctx, meta);
  }
  return true;
}
