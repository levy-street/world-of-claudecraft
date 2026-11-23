// The quest half of a plain NPC talk (src/sim/quests/npc_quest_talk.ts), moved out of
// Sim.talkToNpc: an available quest the NPC gives is accepted, and on the next talk a ready
// quest it takes in turns in before anything is offered.
import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { turnInOrAcceptAtNpc } from '../src/sim/quests/npc_quest_talk';
import { questState } from '../src/sim/quests/quest_commands';
import { Sim } from '../src/sim/sim';
import { type Entity, isQuestTurnInNpc } from '../src/sim/types';

describe('turnInOrAcceptAtNpc', () => {
  it('accepts the first available quest, then turns it in once ready', () => {
    const s = new Sim({ seed: 7, playerClass: 'warrior' });
    const meta = s.players.get(s.player.id);
    if (!meta) throw new Error('no meta');
    // a giver that also takes the quest back, with an available plain quest
    let found: { npc: Entity; qid: string } | null = null;
    for (const e of s.entities.values()) {
      if (e.kind !== 'npc' || !e.questIds?.length) continue;
      const qid = e.questIds.find(
        (id) =>
          QUESTS[id]?.giverNpcId === e.templateId &&
          !QUESTS[id].completionEffect &&
          isQuestTurnInNpc(QUESTS[id], e.templateId) &&
          questState(s.ctx, id, meta.entityId) === 'available',
      );
      if (qid) {
        found = { npc: e, qid };
        break;
      }
    }
    if (!found) throw new Error('no plain giver in the starting world');
    const { npc, qid } = found;
    // stand at the giver, as a talk does
    s.player.pos = { x: npc.pos.x + 1, y: npc.pos.y, z: npc.pos.z };
    // the module accepts the first plain available quest in the NPC's list
    const first = npc.questIds.find(
      (id) =>
        QUESTS[id].giverNpcId === npc.templateId &&
        !QUESTS[id].completionEffect &&
        questState(s.ctx, id, meta.entityId) === 'available',
    );
    expect(first).toBe(qid);
    expect(meta.questLog.has(qid)).toBe(false);
    turnInOrAcceptAtNpc(s.ctx, npc, meta);
    expect(meta.questLog.get(qid)?.state).toBe('active');
    // a second talk while it is still active neither turns it in nor accepts it twice
    turnInOrAcceptAtNpc(s.ctx, npc, meta);
    expect(meta.questLog.get(qid)?.state).toBe('active');
    const entry = meta.questLog.get(qid);
    if (!entry) throw new Error('no log entry');
    entry.state = 'ready';
    turnInOrAcceptAtNpc(s.ctx, npc, meta);
    expect(meta.questLog.has(qid)).toBe(false);
    expect(meta.questsDone.has(qid)).toBe(true);
  });
});
