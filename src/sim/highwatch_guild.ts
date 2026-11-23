// The Highwatch guild's residents on the map (content/highwatch_guild.ts): raised at world init
// under their reserved ids, only where the active world carries their records (the built-in
// world and its Studio map), and never twice.

import {
  CONTRACT_CLERK_NPC_ID,
  GUILD_QUARTERMASTER_NPC_ID,
  GUILD_RECRUITER_NPC_ID,
  GUILDMASTER_NPC_ID,
  HIGHWATCH_GUILD_ENTITY_IDS,
  HIGHWATCH_GUILD_TALK_RANGE,
} from './content/highwatch_guild';
import { createNpc } from './entity';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, WorldContent } from './types';

export function spawnHighwatchGuildResidents(ctx: SimContext, world: WorldContent): void {
  for (const [npcId, entityId] of Object.entries(HIGHWATCH_GUILD_ENTITY_IDS)) {
    const def = world.npcs[npcId];
    if (!def?.dynamic) continue;
    if (ctx.entities.has(entityId)) continue;
    ctx.addEntity(createNpc(entityId, def, ctx.groundPos(def.pos.x, def.pos.z)));
  }
}

/** Talking to a guild resident: the clerk opens the guild window on the week's contracts, the
 *  quartermaster on his stock, the recruiter the Dungeon Finder (structured personal events:
 *  the client owns every visible string). The guildmaster is gossip only: false, so the plain
 *  talk takes her. True when the talk was a working resident's. */
export function talkToGuildResident(
  ctx: SimContext,
  npc: Entity,
  meta: PlayerMeta,
  player: Entity,
): boolean {
  if (npc.kind !== 'npc') return false;
  const entityId = (HIGHWATCH_GUILD_ENTITY_IDS as Readonly<Record<string, number>>)[npc.templateId];
  if (entityId === undefined || npc.id !== entityId) return false;
  if (npc.templateId === GUILDMASTER_NPC_ID) return false;
  if (npc.dead) return true;
  const near =
    Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) <= HIGHWATCH_GUILD_TALK_RANGE &&
    Math.abs(player.pos.y - npc.pos.y) <= 3;
  if (!near) return true;
  const pid = meta.entityId;
  if (npc.templateId === CONTRACT_CLERK_NPC_ID) {
    ctx.emit({ type: 'guildHallOpen', tab: 'contracts', pid });
  } else if (npc.templateId === GUILD_QUARTERMASTER_NPC_ID) {
    ctx.emit({ type: 'guildHallOpen', tab: 'quartermaster', pid });
  } else if (npc.templateId === GUILD_RECRUITER_NPC_ID) {
    ctx.emit({ type: 'guildRecruiterOpen', pid });
  }
  return true;
}
