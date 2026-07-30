// Draw-free, quest-local dressing for the optional Undermount surface chain.
// The global zone roster stays unchanged, so ordinary world initialization and
// parity keep their established entity ids and shared RNG cadence.

import { MOBS } from '../data';
import { createGroundObject, createMob } from '../entity';
import type { SimContext } from '../sim_context';
import type { Entity, Vec3 } from '../types';

export const UNDERMOUNT_RUNE_ITEM_ID = 'undermount_rune_rubbing';
export const UNDERMOUNT_FOREMAN_ID = 'wyrmcult_dig_foreman';

// Fixed points are tuning around Runeseeker Maerin at (-170, 606).
export const UNDERMOUNT_RUNE_POSITIONS = [
  { x: -164, z: 601 },
  { x: -160, z: 609 },
  { x: -166, z: 616 },
] as const;

const UNDERMOUNT_DIG_MOBS = [
  { templateId: UNDERMOUNT_FOREMAN_ID, x: -186, z: 615 },
  { templateId: 'wyrmcult_zealot', x: -181, z: 611 },
  { templateId: 'wyrmcult_zealot', x: -190, z: 609 },
  { templateId: 'wyrmcult_zealot', x: -192, z: 617 },
] as const;

function nearbyEntity(
  ctx: SimContext,
  predicate: (entity: Entity) => boolean,
  pos: Pick<Vec3, 'x' | 'z'>,
): boolean {
  return [...ctx.entities.values()].some(
    (entity) => predicate(entity) && Math.hypot(entity.pos.x - pos.x, entity.pos.z - pos.z) < 1,
  );
}

function ensureRuneFaces(ctx: SimContext): void {
  for (const pos of UNDERMOUNT_RUNE_POSITIONS) {
    if (
      nearbyEntity(
        ctx,
        (entity) => entity.kind === 'object' && entity.objectItemId === UNDERMOUNT_RUNE_ITEM_ID,
        pos,
      )
    ) {
      continue;
    }
    ctx.addEntity(
      createGroundObject(
        ctx.nextId++,
        UNDERMOUNT_RUNE_ITEM_ID,
        'Undermount Rune Face',
        ctx.groundPos(pos.x, pos.z),
      ),
    );
  }
}

function ensureDigOpposition(ctx: SimContext): void {
  for (const spawn of UNDERMOUNT_DIG_MOBS) {
    if (
      nearbyEntity(
        ctx,
        (entity) => entity.kind === 'mob' && entity.templateId === spawn.templateId,
        spawn,
      )
    ) {
      continue;
    }
    const template = MOBS[spawn.templateId];
    if (!template) continue;
    const mob = createMob(
      ctx.nextId++,
      template,
      template.maxLevel,
      ctx.groundPos(spawn.x, spawn.z),
    );
    mob.leashAnchor = { ...mob.pos };
    ctx.addEntity(mob);
  }
}

export function ensureUndermountPrequestEntities(ctx: SimContext, questId: string): void {
  if (questId === 'q_undermount_heat') ensureRuneFaces(ctx);
  if (questId === 'q_undermount_ledger') ensureDigOpposition(ctx);
}
