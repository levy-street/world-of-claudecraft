// Shared progression identifiers and the one-way gate opened by Ignivar's death.
// The second encounter itself is deliberately unauthored: this module only owns
// movement between raid rooms, never boss mechanics.

import {
  IGNIVAR_APPROACH_GUARDIAN_IDS,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_GATE_LOCKED_TEMPLATE,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
} from './ignivar_raid_ids';
import type { InstanceSlot } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

function unlockGateTo(ctx: SimContext, instance: InstanceSlot, destinationId: string): void {
  const gate = instance.objectIds
    .map((id) => ctx.entities.get(id))
    .find(
      (entity) =>
        entity?.templateId === IGNIVAR_GATE_LOCKED_TEMPLATE && entity.dungeonId === destinationId,
    );
  if (!gate) return;
  gate.templateId = 'dungeon_door';
  gate.lootable = true;
  ctx.dungeonDoorIds ??= [];
  if (!ctx.dungeonDoorIds.includes(gate.id)) {
    ctx.dungeonDoorIds.push(gate.id);
  }
}

export function ignivarApproachGuardiansDefeated(ctx: SimContext, instance: InstanceSlot): boolean {
  if (instance.dungeonId !== IGNIVAR_FORGE_APPROACH_ID) return false;
  return IGNIVAR_APPROACH_GUARDIAN_IDS.every(
    (templateId) =>
      !instance.mobIds.some((id) => {
        const mob = ctx.entities.get(id);
        return mob?.templateId === templateId && !mob.dead;
      }),
  );
}

export function updateIgnivarRaidProgression(ctx: SimContext): void {
  for (const instance of ctx.instances) {
    if (instance.partyKey === null || !ignivarApproachGuardiansDefeated(ctx, instance)) continue;
    unlockGateTo(ctx, instance, IGNIVAR_RAID_ARENA_ID);
  }
}

export function unlockIgnivarRaidGate(ctx: SimContext, boss: Entity): void {
  const instance = ctx.instances.find((candidate) => candidate.mobIds.includes(boss.id));
  if (!instance || instance.dungeonId !== IGNIVAR_RAID_ARENA_ID) return;
  unlockGateTo(ctx, instance, IGNIVAR_SECOND_WING_ID);
}
