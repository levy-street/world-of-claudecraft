// First-entry welcome for Ignivar's boss room. InstanceSlot owns a durable
// character-keyed ledger that survives encounter wipes and relogs and is cleared
// only with the claim. This module decides and emits the personal yell, so later
// entrants hear it without replaying it for the raid.

import { IGNIVAR_DIALOGUE } from '../encounters/ignivar_dialogue';
import { IGNIVAR_RAID_ARENA_ID } from '../ignivar_raid_ids';
import { emitMobYellToPlayer } from '../mob/yells';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { IGNIVAR_BOSS_ID } from '../types';

export interface RaidBossRoomWelcome {
  bossTemplateId: string;
  text: string;
}

export function raidBossRoomWelcomeFor(dungeonId: string): RaidBossRoomWelcome | null {
  if (dungeonId === IGNIVAR_RAID_ARENA_ID) {
    return { bossTemplateId: IGNIVAR_BOSS_ID, text: IGNIVAR_DIALOGUE.roomEntry };
  }
  return null;
}

export function emitFirstRaidBossRoomWelcome(
  ctx: SimContext,
  instance: InstanceSlot,
  pid: number,
): void {
  const characterId = ctx.players.get(pid)?.characterId;
  const welcomeKey = characterId === undefined ? `entity:${pid}` : `character:${characterId}`;
  if (instance.raidBossWelcomeKeys.has(welcomeKey)) return;
  const welcome = raidBossRoomWelcomeFor(instance.dungeonId);
  if (!welcome) return;
  const boss = instance.mobIds
    .map((id) => ctx.entities.get(id))
    .find((entity) => entity?.templateId === welcome.bossTemplateId);
  if (!boss) return;
  emitMobYellToPlayer(ctx, boss, welcome.text, pid);
  instance.raidBossWelcomeKeys.add(welcomeKey);
}
