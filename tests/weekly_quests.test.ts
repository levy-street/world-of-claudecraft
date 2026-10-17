// The weekly emissary (src/sim/weekly_quests.ts): the Tuesday week id, the
// talk that opens the window, the guarded pick, credit from the three hook
// families, the one-time purse, the weekly roll, and the save shape.
import { describe, expect, it } from 'vitest';
import {
  WEEKLY_EMISSARY_NPC_DEF,
  WEEKLY_EMISSARY_NPC_ID,
  WEEKLY_QUEST_REWARD,
  WEEKLY_QUESTS,
} from '../src/sim/content/weekly_quests';
import { NPCS } from '../src/sim/data';
import { FACTION_IDS, LOW_LEVEL_MAX_STANDING, MAX_STANDING } from '../src/sim/factions';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import {
  onBattlegroundMatchForWeeklyQuests,
  onDungeonClearedForWeeklyQuests,
  onWorldBossKilledForWeeklyQuests,
  resetWeeklyQuestIfNeeded,
  sanitizeWeeklyQuestProgress,
  weeklyQuestRewardCopper,
  weeklyQuestWeekForResetDay,
} from '../src/sim/weekly_quests';

function armed(resetDay = '2026-09-10'): Sim {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', devCommands: true });
  sim.resetDay = resetDay;
  sim.chat('/dev weekly');
  sim.tick();
  return sim;
}

function eventsOf(sim: Sim, type: SimEvent['type']): SimEvent[] {
  return sim.tick().filter((event) => event.type === type);
}

describe('the weekly week id', () => {
  it('rolls on the epoch weekday (a Tuesday) and refuses a malformed day', () => {
    expect(weeklyQuestWeekForResetDay('2026-09-01')).toBe('wk_0');
    expect(weeklyQuestWeekForResetDay('2026-09-07')).toBe('wk_0');
    expect(weeklyQuestWeekForResetDay('2026-09-08')).toBe('wk_1');
    expect(weeklyQuestWeekForResetDay('2026-08-31')).toBe('wk_-1');
    expect(weeklyQuestWeekForResetDay('')).toBe('');
    expect(weeklyQuestWeekForResetDay('2026-13-40')).toBe('');
  });

  it('registers the emissary as a real NPC with the window flag', () => {
    expect(NPCS[WEEKLY_EMISSARY_NPC_DEF.id]).toBe(WEEKLY_EMISSARY_NPC_DEF);
    expect(WEEKLY_EMISSARY_NPC_DEF.weeklyEmissary).toBe(true);
    expect(WEEKLY_QUESTS.map((quest) => quest.kind)).toEqual([
      'dungeons',
      'raid',
      'battlegrounds',
      'worldboss',
    ]);
  });
});

describe('the emissary', () => {
  it('stands in town, opens the window on a talk, and refuses a talk from afar', () => {
    const sim = armed();
    const npc = sim.entities.get(WEEKLY_EMISSARY_NPC_ID);
    expect(npc?.templateId).toBe(WEEKLY_EMISSARY_NPC_DEF.id);
    sim.talkToNpc(WEEKLY_EMISSARY_NPC_ID);
    expect(eventsOf(sim, 'worldQuestWeeklyOpen')).toHaveLength(1);
    sim.player.pos = sim.groundPos(sim.player.pos.x + 30, sim.player.pos.z);
    sim.talkToNpc(WEEKLY_EMISSARY_NPC_ID);
    expect(eventsOf(sim, 'worldQuestWeeklyOpen')).toHaveLength(0);
  });

  it('takes one charge a week, beside him, alive, for a real quest', () => {
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    sim.chooseWeeklyQuest('nope');
    expect(sim.weeklyQuest).toBeNull();
    sim.player.dead = true;
    sim.chooseWeeklyQuest('wk_dungeons');
    expect(sim.weeklyQuest).toBeNull();
    sim.player.dead = false;
    const here = { ...sim.player.pos };
    sim.player.pos = sim.groundPos(here.x + 30, here.z);
    sim.chooseWeeklyQuest('wk_dungeons');
    expect(sim.weeklyQuest).toBeNull();
    sim.player.pos = here;
    sim.chooseWeeklyQuest('wk_dungeons');
    expect(sim.weeklyQuest).toEqual({
      questId: 'wk_dungeons',
      week: 'wk_1',
      count: 0,
      state: 'active',
    });
    expect(eventsOf(sim, 'worldQuestWeeklyChosen')).toMatchObject([{ questId: 'wk_dungeons' }]);
    // The other three are locked for the week; so is a second copy of the same.
    sim.chooseWeeklyQuest('wk_raid');
    sim.chooseWeeklyQuest('wk_dungeons');
    expect(meta.weeklyQuest?.questId).toBe('wk_dungeons');
  });

  it('credits dungeon clears, pays once at the count, and ignores raid rooms and repeats', () => {
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    sim.chooseWeeklyQuest('wk_dungeons');
    sim.tick();
    const copper = meta.copper;
    const caches = sim.countItem(WEEKLY_QUEST_REWARD.cacheItemId);
    // A raid room is the raid charge, not this one.
    onDungeonClearedForWeeklyQuests(sim.ctx, 'ignivar_raid_arena', [meta]);
    expect(meta.weeklyQuest?.count).toBe(0);
    onDungeonClearedForWeeklyQuests(sim.ctx, 'hollow_crypt', [meta]);
    onDungeonClearedForWeeklyQuests(sim.ctx, 'sunken_bastion', [meta]);
    expect(eventsOf(sim, 'worldQuestWeeklyProgress')).toMatchObject([
      { questId: 'wk_dungeons', count: 1, required: 3 },
      { questId: 'wk_dungeons', count: 2, required: 3 },
    ]);
    expect(meta.copper).toBe(copper);
    onDungeonClearedForWeeklyQuests(sim.ctx, 'hollow_crypt', [meta]);
    expect(meta.weeklyQuest).toEqual({
      questId: 'wk_dungeons',
      week: 'wk_1',
      count: 3,
      state: 'completed',
    });
    expect(meta.copper).toBe(copper + weeklyQuestRewardCopper(sim.player.level));
    expect(sim.countItem(WEEKLY_QUEST_REWARD.cacheItemId)).toBe(
      caches + WEEKLY_QUEST_REWARD.cacheCount,
    );
    expect(eventsOf(sim, 'worldQuestWeeklyDone')).toMatchObject([{ questId: 'wk_dungeons' }]);
    // Done is done: no second purse, no reopening this week.
    onDungeonClearedForWeeklyQuests(sim.ctx, 'hollow_crypt', [meta]);
    expect(meta.copper).toBe(copper + weeklyQuestRewardCopper(sim.player.level));
    sim.chooseWeeklyQuest('wk_raid');
    expect(meta.weeklyQuest?.questId).toBe('wk_dungeons');
  });

  it('credits the raid, battleground, and world-boss charges from their own hooks', () => {
    const raid = armed();
    raid.chooseWeeklyQuest('wk_raid');
    const raidMeta = raid.meta(raid.playerId)!;
    onDungeonClearedForWeeklyQuests(raid.ctx, 'hollow_crypt', [raidMeta]);
    expect(raidMeta.weeklyQuest?.count).toBe(0);
    onDungeonClearedForWeeklyQuests(raid.ctx, 'nythraxis_boss_arena', [raidMeta]);
    expect(raidMeta.weeklyQuest?.state).toBe('completed');

    const bg = armed();
    bg.chooseWeeklyQuest('wk_battlegrounds');
    const bgMeta = bg.meta(bg.playerId)!;
    onWorldBossKilledForWeeklyQuests(bg.ctx, [bgMeta]);
    expect(bgMeta.weeklyQuest?.count).toBe(0);
    for (let i = 0; i < 3; i++) onBattlegroundMatchForWeeklyQuests(bg.ctx, bgMeta);
    expect(bgMeta.weeklyQuest?.state).toBe('completed');

    const boss = armed();
    boss.chooseWeeklyQuest('wk_worldboss');
    const bossMeta = boss.meta(boss.playerId)!;
    onBattlegroundMatchForWeeklyQuests(boss.ctx, bossMeta);
    expect(bossMeta.weeklyQuest?.count).toBe(0);
    onWorldBossKilledForWeeklyQuests(boss.ctx, [bossMeta]);
    expect(bossMeta.weeklyQuest?.state).toBe('completed');
  });

  it('rolls the charge at the next week and lets a fresh pick be taken', () => {
    const sim = armed();
    sim.chooseWeeklyQuest('wk_worldboss');
    expect(sim.weeklyQuest?.week).toBe('wk_1');
    sim.resetDay = '2026-09-16';
    expect(sim.weeklyQuest).toBeNull();
    sim.chooseWeeklyQuest('wk_raid');
    expect(sim.weeklyQuest).toEqual({
      questId: 'wk_raid',
      week: 'wk_2',
      count: 0,
      state: 'active',
    });
    expect(sim.weeklyQuestResetAtMs).toBeGreaterThan(0);
  });

  it('saves the pick, restores it, and drops malformed rows', () => {
    const sim = armed();
    expect(sim.serializeCharacter(sim.playerId)?.weeklyQuest).toBeUndefined();
    sim.chooseWeeklyQuest('wk_battlegrounds');
    const saved = sim.serializeCharacter(sim.playerId);
    expect(saved?.weeklyQuest).toEqual({
      questId: 'wk_battlegrounds',
      week: 'wk_1',
      count: 0,
      state: 'active',
    });
    const restored = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = '2026-09-10';
    const pid = restored.addPlayer('warrior', 'Restored', { state: saved! });
    expect(restored.meta(pid)?.weeklyQuest).toEqual(saved?.weeklyQuest);
    expect(sanitizeWeeklyQuestProgress(null)).toBeNull();
    expect(
      sanitizeWeeklyQuestProgress({ questId: 'nope', week: 'wk_1', count: 0, state: 'active' }),
    ).toBeNull();
    expect(
      sanitizeWeeklyQuestProgress({ questId: 'wk_raid', week: 'x', count: 0, state: 'active' }),
    ).toBeNull();
    expect(
      sanitizeWeeklyQuestProgress({ questId: 'wk_raid', week: 'wk_1', count: 9, state: 'active' }),
    ).toEqual({ questId: 'wk_raid', week: 'wk_1', count: 1, state: 'active' });
    // The carried mark survives only on a finished, unclaimed pick.
    const finishedRow = { questId: 'wk_raid', week: 'wk_1', count: 1, state: 'completed' };
    expect(sanitizeWeeklyQuestProgress({ ...finishedRow, carried: true })).toEqual({
      ...finishedRow,
      carried: true,
    });
    expect(
      sanitizeWeeklyQuestProgress({ ...finishedRow, commended: 'rift_watch', carried: true }),
    ).toEqual({ ...finishedRow, commended: 'rift_watch' });
    expect(sanitizeWeeklyQuestProgress({ ...finishedRow, state: 'active', carried: true })).toEqual(
      { ...finishedRow, count: 1, state: 'active' },
    );
    expect(sanitizeWeeklyQuestProgress({ ...finishedRow, carried: 'yes' })).toEqual(finishedRow);
  });
});

describe('the commendation', () => {
  function finished(): Sim {
    const sim = armed();
    sim.chat('/dev level 20');
    sim.chooseWeeklyQuest('wk_dungeons');
    for (let i = 0; i < 3; i++) sim.chat('/dev weekly credit');
    sim.tick();
    expect(sim.meta(sim.playerId)?.weeklyQuest?.state).toBe('completed');
    return sim;
  }

  it('gives one faction the standing once the charge is finished, once a week', () => {
    const sim = finished();
    sim.commendWeeklyQuest('rift_watch');
    const loot = eventsOf(sim, 'loot');
    expect(loot.map((event) => (event as { text: string }).text)).toContain(
      '+1000 Rift Watch Standing.',
    );
    const meta = sim.meta(sim.playerId);
    expect(meta?.factions.rift_watch).toBe(1000);
    expect(meta?.weeklyQuest?.commended).toBe('rift_watch');
    // The choice is spent: a second faction gets nothing, and so does the same one.
    sim.commendWeeklyQuest('church_order');
    sim.commendWeeklyQuest('rift_watch');
    expect(meta?.factions).toEqual({ rift_watch: 1000, church_order: 0, automatons: 0 });
    expect(sim.weeklyQuest?.commended).toBe('rift_watch');
  });

  it('refuses before the charge is finished, an unknown faction, and a faction with no headroom', () => {
    const sim = armed();
    sim.chooseWeeklyQuest('wk_dungeons');
    sim.commendWeeklyQuest('rift_watch');
    expect(sim.meta(sim.playerId)?.factions.rift_watch).toBe(0);
    for (let i = 0; i < 3; i++) sim.chat('/dev weekly credit');
    sim.tick();
    sim.commendWeeklyQuest('nobody');
    expect(sim.meta(sim.playerId)?.weeklyQuest?.commended).toBeUndefined();
    // Level 1 sits under the low-level cap; a faction already at it is refused
    // and the choice stays open for another.
    sim.chat('/dev rep automatons 3000');
    sim.commendWeeklyQuest('automatons');
    expect(sim.meta(sim.playerId)?.weeklyQuest?.commended).toBeUndefined();
    expect(sim.meta(sim.playerId)?.factions.automatons).toBe(3000);
    sim.commendWeeklyQuest('church_order');
    expect(sim.meta(sim.playerId)?.factions.church_order).toBe(1000);
    expect(sim.meta(sim.playerId)?.weeklyQuest?.commended).toBe('church_order');
  });

  it('holds an unclaimed commendation past the weekly reset until it is redeemed', () => {
    const sim = finished();
    const meta = sim.meta(sim.playerId)!;
    sim.resetDay = '2026-09-16';
    const held = {
      questId: 'wk_dungeons',
      week: 'wk_1',
      count: 3,
      state: 'completed',
      carried: true,
    };
    expect(sim.weeklyQuest).toEqual(held);
    // A new charge waits for the claim (even the same kind), and this week's
    // clears credit nothing.
    sim.chooseWeeklyQuest('wk_raid');
    sim.chooseWeeklyQuest('wk_dungeons');
    onDungeonClearedForWeeklyQuests(sim.ctx, 'hollow_crypt', [meta]);
    const weeklyEvents = sim
      .tick()
      .filter((event) => event.type.startsWith('worldQuestWeekly'))
      .map((event) => event.type);
    expect(weeklyEvents).toEqual([]);
    expect(meta.weeklyQuest).toEqual(held);
    // A relog in the later week keeps it too.
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing serialized character');
    const restored = new Sim({ seed: 4711, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = '2026-09-16';
    const restoredMeta = restored.meta(restored.addPlayer('warrior', 'Held', { state }))!;
    resetWeeklyQuestIfNeeded(restored.ctx, restoredMeta);
    expect(restoredMeta.weeklyQuest).toEqual(held);
    // The claim pays, then last week's charge is over and this week's pick opens.
    sim.commendWeeklyQuest('church_order');
    expect(eventsOf(sim, 'loot').map((event) => (event as { text: string }).text)).toContain(
      '+1000 Church Order Standing.',
    );
    expect(meta.factions.church_order).toBe(1000);
    expect(meta.weeklyQuest).toBeNull();
    sim.chooseWeeklyQuest('wk_raid');
    expect(sim.weeklyQuest).toEqual({
      questId: 'wk_raid',
      week: 'wk_2',
      count: 0,
      state: 'active',
    });
  });

  it('still rolls a claimed charge, and lets an unclaimable one lapse at the reset', () => {
    const claimed = finished();
    claimed.commendWeeklyQuest('rift_watch');
    claimed.resetDay = '2026-09-16';
    expect(claimed.weeklyQuest).toBeNull();
    // Every faction at the cap: nothing could ever redeem it, so it never
    // blocks the next week's pick.
    const capped = finished();
    for (const factionId of FACTION_IDS) capped.chat(`/dev rep ${factionId} ${MAX_STANDING}`);
    capped.tick();
    capped.resetDay = '2026-09-16';
    expect(capped.weeklyQuest).toBeNull();
    capped.chooseWeeklyQuest('wk_raid');
    expect(capped.weeklyQuest?.week).toBe('wk_2');
    // One faction with headroom is enough to keep it held.
    const partial = finished();
    for (const factionId of FACTION_IDS.slice(1)) {
      partial.chat(`/dev rep ${factionId} ${MAX_STANDING}`);
    }
    partial.tick();
    partial.resetDay = '2026-09-16';
    expect(partial.weeklyQuest?.week).toBe('wk_1');
    // ...whichever faction it is.
    const middle = finished();
    middle.chat(`/dev rep rift_watch ${MAX_STANDING}`);
    middle.chat(`/dev rep automatons ${MAX_STANDING}`);
    middle.tick();
    middle.resetDay = '2026-09-16';
    expect(middle.weeklyQuest?.week).toBe('wk_1');
  });

  it('judges headroom at the owner level: level 20 still has room above the low cap', () => {
    const sim = finished();
    for (const factionId of FACTION_IDS) {
      sim.chat(`/dev rep ${factionId} ${LOW_LEVEL_MAX_STANDING}`);
    }
    sim.tick();
    sim.resetDay = '2026-09-16';
    expect(sim.weeklyQuest?.week).toBe('wk_1');
  });

  it('keeps a held pick when the body is missing, since there is no level to judge by', () => {
    const sim = finished();
    const meta = sim.meta(sim.playerId)!;
    for (const factionId of FACTION_IDS) sim.chat(`/dev rep ${factionId} ${MAX_STANDING}`);
    sim.tick();
    meta.weeklyQuest!.carried = true;
    const rev = meta.wireRev;
    resetWeeklyQuestIfNeeded({ resetDay: '2026-09-16', entities: new Map() }, meta);
    expect(meta.weeklyQuest?.week).toBe('wk_1');
    expect(meta.wireRev).toBe(rev);
  });

  it('keeps the record after a claim while no calendar has been fed', () => {
    const sim = armed('');
    const meta = sim.meta(sim.playerId)!;
    meta.weeklyQuest = { questId: 'wk_dungeons', week: 'wk_1', count: 3, state: 'completed' };
    sim.commendWeeklyQuest('rift_watch');
    expect(meta.factions.rift_watch).toBe(1000);
    // The week is unknown, so the spent pick stays rather than reopening one.
    expect(meta.weeklyQuest?.commended).toBe('rift_watch');
  });

  it('keeps a held commendation open when the claim names a capped faction', () => {
    const sim = finished();
    const meta = sim.meta(sim.playerId)!;
    sim.chat(`/dev rep rift_watch ${MAX_STANDING}`);
    sim.tick();
    sim.resetDay = '2026-09-16';
    sim.commendWeeklyQuest('rift_watch');
    expect(meta.weeklyQuest?.week).toBe('wk_1');
    expect(meta.weeklyQuest?.commended).toBeUndefined();
    sim.chooseWeeklyQuest('wk_raid');
    expect(meta.weeklyQuest?.questId).toBe('wk_dungeons');
    sim.commendWeeklyQuest('automatons');
    expect(meta.factions.automatons).toBe(1000);
    expect(meta.weeklyQuest).toBeNull();
  });

  it('judges headroom by the low-level cap, and lapses once the last faction caps', () => {
    // Level 1 stops at the low-level cap rather than MAX_STANDING.
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    sim.chooseWeeklyQuest('wk_dungeons');
    for (let i = 0; i < 3; i++) sim.chat('/dev weekly credit');
    sim.chat(`/dev rep rift_watch ${LOW_LEVEL_MAX_STANDING}`);
    sim.chat(`/dev rep church_order ${LOW_LEVEL_MAX_STANDING}`);
    sim.tick();
    sim.resetDay = '2026-09-16';
    expect(sim.weeklyQuest?.week).toBe('wk_1');
    // Held at one check, then the last faction reaches the cap: nothing could
    // redeem it any more, so the next check lets it go.
    sim.chat(`/dev rep automatons ${LOW_LEVEL_MAX_STANDING}`);
    sim.tick();
    expect(meta.weeklyQuest?.week).toBe('wk_1');
    expect(sim.weeklyQuest).toBeNull();
  });

  it('rides the character save and drops a malformed claim on restore', () => {
    const sim = finished();
    sim.commendWeeklyQuest('automatons');
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing serialized character');
    expect(state.weeklyQuest?.commended).toBe('automatons');
    const restored = new Sim({ seed: 4711, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = sim.resetDay;
    const pid = restored.addPlayer('warrior', 'Commended', { state });
    expect(restored.meta(pid)?.weeklyQuest?.commended).toBe('automatons');
    // A junk claim restores as none, so the choice is open again rather than lost.
    const junk = new Sim({ seed: 4711, playerClass: 'warrior', noPlayer: true });
    junk.resetDay = sim.resetDay;
    const junkPid = junk.addPlayer('warrior', 'Junk', {
      state: {
        ...state,
        weeklyQuest: {
          questId: 'wk_dungeons',
          week: state.weeklyQuest?.week ?? '',
          count: 3,
          state: 'completed',
          commended: 'nobody',
        },
      },
    });
    expect(junk.meta(junkPid)?.weeklyQuest?.commended).toBeUndefined();
  });
});
