// Shared progression identifiers and the ordered gates around Ignivar's death.
// This module owns movement between raid rooms, never either boss encounter.

import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_GATE_LOCKED_TEMPLATE,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
  IGNIVAR_TRASH_AUTOMATON_IDS,
} from './ignivar_raid_ids';
import type { InstanceSlot } from './sim';
import type { SimContext } from './sim_context';
import type { Entity } from './types';

export function unlockGateTo(
  ctx: SimContext,
  instance: InstanceSlot,
  destinationId: string,
  lockedTemplate: string = IGNIVAR_GATE_LOCKED_TEMPLATE,
): Entity | null {
  const gate = instance.objectIds
    .map((id) => ctx.entities.get(id))
    .find((entity) => entity?.templateId === lockedTemplate && entity.dungeonId === destinationId);
  if (!gate) return null;
  gate.templateId = 'dungeon_door';
  gate.lootable = true;
  ctx.dungeonDoorIds ??= [];
  if (!ctx.dungeonDoorIds.includes(gate.id)) {
    ctx.dungeonDoorIds.push(gate.id);
  }
  return gate;
}

export function ignivarApproachGuardiansDefeated(ctx: SimContext, instance: InstanceSlot): boolean {
  if (instance.dungeonId !== IGNIVAR_FORGE_APPROACH_ID) return false;
  return ignivarRaidAutomataDefeated(ctx, instance);
}

function ignivarRaidAutomataDefeated(ctx: SimContext, instance: InstanceSlot): boolean {
  return IGNIVAR_TRASH_AUTOMATON_IDS.every(
    (templateId) =>
      !instance.mobIds.some((id) => {
        const mob = ctx.entities.get(id);
        return mob?.templateId === templateId && !mob.dead;
      }),
  );
}

export function updateIgnivarRaidProgression(ctx: SimContext): void {
  for (const instance of ctx.instances) {
    if (instance.partyKey === null) continue;
    if (ignivarApproachGuardiansDefeated(ctx, instance)) {
      unlockGateTo(ctx, instance, IGNIVAR_RAID_ARENA_ID);
    } else if (
      instance.dungeonId === IGNIVAR_MOLTEN_ASSEMBLY_ID &&
      ignivarRaidAutomataDefeated(ctx, instance)
    ) {
      unlockGateTo(ctx, instance, IGNIVAR_SECOND_WING_ID);
    }
  }
}

export function unlockIgnivarRaidGate(ctx: SimContext, boss: Entity): void {
  const instance = ctx.instances.find((candidate) => candidate.mobIds.includes(boss.id));
  if (!instance || instance.dungeonId !== IGNIVAR_RAID_ARENA_ID) return;
  unlockGateTo(ctx, instance, IGNIVAR_MOLTEN_ASSEMBLY_ID);
}
