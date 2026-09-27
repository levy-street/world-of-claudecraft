// The weekly pick on the wire: the client command, the server validator and
// dispatch, and the owner snapshot keys both ways.
import { describe, expect, it, vi } from 'vitest';
import {
  chooseWeeklyQuestWire,
  commendWeeklyQuestWire,
  dispatchWorldQuestWire,
  isWorldQuestWireCommand,
} from '../server/quest_command_wire';
import { emitQuestSelfKeys } from '../server/quest_snapshot_wire';
import { applyQuestSelfWire, type QuestSelfMirrors } from '../src/net/quest_snapshot_wire';
import type { Sim } from '../src/sim/sim';
import { COMMAND_NAMES } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

function mirrors(): QuestSelfMirrors {
  return {
    questLog: new Map(),
    questsDone: new Set(),
    worldQuestCycle: '',
    worldQuestExpiresAtMs: 0,
    worldQuestLog: new Map(),
    weeklyQuest: null,
    weeklyQuestResetAtMs: 0,
  };
}

describe('weekly quest wire', () => {
  it('sends the pick as its own command and validates it before the authoritative call', () => {
    expect(COMMAND_NAMES).toContain('world_quest_weekly_choose');
    expect(isWorldQuestWireCommand('world_quest_weekly_choose')).toBe(true);
    const client = bareClient(7);
    const send = vi.fn();
    Object.assign(client, { cmd: send });
    client.chooseWeeklyQuest('wk_raid');
    expect(send).toHaveBeenCalledExactlyOnceWith({
      cmd: 'world_quest_weekly_choose',
      quest: 'wk_raid',
    });
    const choose = vi.fn();
    const sim = { chooseWeeklyQuest: choose } as unknown as Sim;
    dispatchWorldQuestWire(sim, send.mock.calls[0][0], 7);
    expect(choose).toHaveBeenCalledExactlyOnceWith('wk_raid', 7);
    for (const quest of [undefined, null, 3, {}, ['wk_raid']])
      chooseWeeklyQuestWire(sim, { cmd: 'world_quest_weekly_choose', quest } as never, 7);
    expect(choose).toHaveBeenCalledTimes(1);
  });

  it('mirrors the pick and the reset instant, clears on null, and drops malformed rows', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {
      wkq: { questId: 'wk_dungeons', week: 'wk_2', count: 2, state: 'active' },
      wkexp: 1_800_000_000_000,
    });
    expect(target.weeklyQuest).toEqual({
      questId: 'wk_dungeons',
      week: 'wk_2',
      count: 2,
      state: 'active',
    });
    expect(target.weeklyQuestResetAtMs).toBe(1_800_000_000_000);
    // An omitted key keeps the mirror; an explicit null clears it.
    applyQuestSelfWire(target, {});
    expect(target.weeklyQuest?.questId).toBe('wk_dungeons');
    applyQuestSelfWire(target, { wkq: { questId: 'nope' } });
    expect(target.weeklyQuest).toBeNull();
    applyQuestSelfWire(target, { wkq: null, wkexp: -1 });
    expect(target.weeklyQuest).toBeNull();
    expect(target.weeklyQuestResetAtMs).toBe(1_800_000_000_000);
  });

  it('emits the two owner keys beside the world-quest family', () => {
    const emitted: Record<string, unknown> = {};
    const meta = {
      questLog: new Map(),
      questsDone: new Set(),
      worldQuestCycle: 'wq1_3',
      worldQuestLog: new Map(),
      weeklyQuest: { questId: 'wk_raid', week: 'wk_2', count: 0, state: 'active' },
    };
    const sim = { worldQuestExpiresAtMs: 5, weeklyQuestResetAtMs: 9 };
    emitQuestSelfKeys(
      (key, value) => {
        emitted[key] = value;
      },
      sim as never,
      meta as never,
    );
    expect(emitted.wkq).toEqual(meta.weeklyQuest);
    expect(emitted.wkexp).toBe(9);
  });

  it('sends the commendation claim as its own command and validates the faction before the call', () => {
    expect(COMMAND_NAMES).toContain('world_quest_weekly_commend');
    expect(isWorldQuestWireCommand('world_quest_weekly_commend')).toBe(true);
    const client = bareClient(7);
    const send = vi.fn();
    Object.assign(client, { cmd: send });
    client.commendWeeklyQuest('church_order');
    expect(send).toHaveBeenCalledExactlyOnceWith({
      cmd: 'world_quest_weekly_commend',
      faction: 'church_order',
    });
    const commend = vi.fn();
    const sim = { commendWeeklyQuest: commend } as unknown as Sim;
    dispatchWorldQuestWire(sim, send.mock.calls[0][0], 7);
    expect(commend).toHaveBeenCalledExactlyOnceWith('church_order', 7);
    for (const faction of [undefined, null, 3, {}, ['rift_watch']])
      commendWeeklyQuestWire(sim, { cmd: 'world_quest_weekly_commend', faction } as never, 7);
    expect(commend).toHaveBeenCalledTimes(1);
  });

  it('mirrors the claimed commendation on the pick and drops a junk one', () => {
    const target = mirrors();
    applyQuestSelfWire(target, {
      wkq: {
        questId: 'wk_raid',
        week: 'wk_2',
        count: 1,
        state: 'completed',
        commended: 'automatons',
      },
    });
    expect(target.weeklyQuest?.commended).toBe('automatons');
    applyQuestSelfWire(target, {
      wkq: { questId: 'wk_raid', week: 'wk_2', count: 1, state: 'completed', commended: 'nobody' },
    });
    expect(target.weeklyQuest?.commended).toBeUndefined();
  });
});
