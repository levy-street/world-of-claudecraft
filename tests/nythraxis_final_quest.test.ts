import { describe, expect, it } from 'vitest';
import { DUNGEONS, QUESTS, instanceOrigin } from '../src/sim/data';
import { ZONE3_QUEST_ORDER } from '../src/sim/content/zone3';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type QuestDef } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const FINAL_QUEST_ID = 'q_nythraxis_scourges_end';
const ATTUNEMENT_QUEST_ID = 'q_nythraxis_bound_guardian';
const HIGHWATCH_ALDRIC_ID = 'brother_aldric_highwatch';
const RAID_ALDRIC_ID = 'brother_aldric_raid';
const NYTHRAXIS_ID = 'nythraxis_scourge_of_thornpeak';

type MultiTurnInQuest = QuestDef & { turnInNpcIds?: string[] };

function finalQuest(): MultiTurnInQuest {
  const quest = QUESTS[FINAL_QUEST_ID] as MultiTurnInQuest | undefined;
  expect(quest, 'Scourge\'s End should be registered in QUESTS').toBeTruthy();
  return quest!;
}

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function playerMeta(sim: Sim, pid: number) {
  const meta = sim.players.get(pid);
  expect(meta).toBeTruthy();
  return meta!;
}

function entity(sim: Sim, id: number): Entity {
  const found = sim.entities.get(id);
  expect(found).toBeTruthy();
  return found!;
}

function teleport(sim: Sim, e: Entity, x: number, z: number) {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(e: Entity): void }).rebucket(e);
}

function npc(sim: Sim, templateId: string): Entity {
  const found = [...sim.entities.values()].find((e) => e.kind === 'npc' && e.templateId === templateId && !e.dead);
  expect(found, `expected ${templateId} NPC`).toBeTruthy();
  return found!;
}

function mob(sim: Sim, templateId: string): Entity {
  const found = [...sim.entities.values()].find((e) => e.kind === 'mob' && e.templateId === templateId && !e.dead);
  expect(found, `expected ${templateId} mob`).toBeTruthy();
  return found!;
}

function raidAldric(sim: Sim): Entity {
  const found = [...sim.entities.values()].find((e) => e.templateId === RAID_ALDRIC_ID && !e.dead);
  expect(found, 'Brother Aldric should be present inside the Nythraxis arena for final quest turn-in').toBeTruthy();
  return found!;
}

function moveToHighwatchAldric(sim: Sim, pid: number) {
  const p = entity(sim, pid);
  const aldric = npc(sim, HIGHWATCH_ALDRIC_ID);
  teleport(sim, p, aldric.pos.x, aldric.pos.z);
}

function interactWith(sim: Sim, pid: number, target: Entity) {
  sim.targetEntity(target.id, pid);
  sim.interact(pid);
}

function markAttuned(sim: Sim, pid: number) {
  playerMeta(sim, pid).questsDone.add(ATTUNEMENT_QUEST_ID);
}

function acceptFinalQuest(sim: Sim, pid: number) {
  markAttuned(sim, pid);
  moveToHighwatchAldric(sim, pid);
  sim.acceptQuest(FINAL_QUEST_ID, pid);
  expect(playerMeta(sim, pid).questLog.get(FINAL_QUEST_ID)?.state).toBe('active');
}

function formRaid(sim: Sim, leaderPid: number) {
  while ((sim.partyOf(leaderPid)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${sim.players.size}`);
    markAttuned(sim, pid);
    sim.partyInvite(pid, leaderPid);
    sim.partyAccept(pid);
  }
  sim.convertPartyToRaid(leaderPid);
}

function enterNythraxisRaid(sim: Sim, pid: number) {
  markAttuned(sim, pid);
  formRaid(sim, pid);
  sim.enterDungeon('nythraxis_boss_arena', pid);
  const p = entity(sim, pid);
  return instanceOrigin(DUNGEONS.nythraxis_boss_arena.index, sim.instanceSlotAt(p.pos)!);
}

function engageNythraxis(sim: Sim, boss: Entity, tank: Entity) {
  boss.inCombat = true;
  boss.aiState = 'attack';
  boss.aggroTargetId = tank.id;
  boss.threat.set(tank.id, 1000);
  boss.tappedById = tank.id;
  teleport(sim, tank, boss.pos.x, boss.pos.z - 6);
}

function dealDamage(sim: Sim, source: Entity, target: Entity, amount: number) {
  (sim as unknown as {
    dealDamage(source: Entity, target: Entity, amount: number, crit: boolean, school: string, ability: string | null, kind: 'hit', noRage?: boolean): void;
  }).dealDamage(source, target, amount, false, 'physical', null, 'hit', true);
}

function advanceSeconds(sim: Sim, seconds: number) {
  for (let i = 0; i < seconds * 20; i++) sim.tick();
}

function progressFinalQuestThroughNythraxisKill(sim: Sim, pid: number): { boss: Entity; aldric: Entity } {
  enterNythraxisRaid(sim, pid);
  const p = entity(sim, pid);
  const boss = mob(sim, NYTHRAXIS_ID);
  engageNythraxis(sim, boss, p);

  dealDamage(sim, p, boss, Math.ceil(boss.maxHp * 0.31));
  sim.tick();
  advanceSeconds(sim, 1);
  const aldric = raidAldric(sim);

  dealDamage(sim, p, boss, boss.hp);
  expect(boss.dead).toBe(true);
  expect(playerMeta(sim, pid).questLog.get(FINAL_QUEST_ID)?.state).toBe('ready');
  return { boss, aldric };
}

describe('Nythraxis final quest', () => {
  it('defines Scourge\'s End as the gold-only capstone after the Nythraxis attunement', () => {
    const quest = finalQuest();

    expect(quest.id).toBe(FINAL_QUEST_ID);
    expect(quest.name).toBe('Scourge\'s End');
    expect(quest.giverNpcId).toBe(HIGHWATCH_ALDRIC_ID);
    expect(quest.turnInNpcId).toBe(HIGHWATCH_ALDRIC_ID);
    expect(quest.turnInNpcIds).toEqual([HIGHWATCH_ALDRIC_ID, RAID_ALDRIC_ID]);
    expect(quest.requiresQuest).toBe(ATTUNEMENT_QUEST_ID);
    expect(quest.minLevel).toBe(20);
    expect(quest.suggestedPlayers).toBe(10);
    expect(quest.objectives).toEqual([
      { type: 'kill', targetMobId: NYTHRAXIS_ID, count: 1, label: 'Nythraxis slain' },
    ]);
    expect(quest.itemRewards).toEqual({});
    expect(quest.copperReward).toBeGreaterThanOrEqual(10000);
    expect(quest.xpReward).toBeGreaterThanOrEqual(0);

    const attunementIndex = ZONE3_QUEST_ORDER.indexOf(ATTUNEMENT_QUEST_ID);
    expect(attunementIndex).toBeGreaterThanOrEqual(0);
    expect(ZONE3_QUEST_ORDER[attunementIndex + 1]).toBe(FINAL_QUEST_ID);
  });

  it('is unavailable before attunement and acceptable from Brother Aldric after attunement', () => {
    finalQuest();
    const sim = makeWorld();
    const pid = sim.addPlayer('paladin', 'QuestTester');
    sim.setPlayerLevel(20, pid);

    moveToHighwatchAldric(sim, pid);
    expect(sim.questState(FINAL_QUEST_ID, pid)).toBe('unavailable');

    markAttuned(sim, pid);
    expect(sim.questState(FINAL_QUEST_ID, pid)).toBe('available');
    sim.acceptQuest(FINAL_QUEST_ID, pid);

    expect(playerMeta(sim, pid).questLog.get(FINAL_QUEST_ID)).toMatchObject({
      questId: FINAL_QUEST_ID,
      counts: [0],
      state: 'active',
    });
  });

  it('credits the Nythraxis kill and makes Scourge\'s End ready to complete', () => {
    finalQuest();
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'NythraxisSlayer');
    sim.setPlayerLevel(20, pid);
    acceptFinalQuest(sim, pid);

    progressFinalQuestThroughNythraxisKill(sim, pid);

    expect(playerMeta(sim, pid).questLog.get(FINAL_QUEST_ID)).toMatchObject({
      counts: [1],
      state: 'ready',
    });
  });

  it('can be completed at Brother Aldric in Highwatch after killing Nythraxis', () => {
    finalQuest();
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'HighwatchTurnIn');
    sim.setPlayerLevel(20, pid);
    acceptFinalQuest(sim, pid);
    progressFinalQuestThroughNythraxisKill(sim, pid);

    const beforeCopper = playerMeta(sim, pid).copper;
    moveToHighwatchAldric(sim, pid);
    sim.turnInQuest(FINAL_QUEST_ID, pid);

    const meta = playerMeta(sim, pid);
    expect(meta.questsDone.has(FINAL_QUEST_ID)).toBe(true);
    expect(meta.questLog.has(FINAL_QUEST_ID)).toBe(false);
    expect(meta.copper).toBeGreaterThan(beforeCopper);
  });

  it('can be completed at Brother Aldric inside the Nythraxis arena after the kill', () => {
    finalQuest();
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'RaidTurnIn');
    sim.setPlayerLevel(20, pid);
    acceptFinalQuest(sim, pid);
    const { aldric } = progressFinalQuestThroughNythraxisKill(sim, pid);

    const p = entity(sim, pid);
    teleport(sim, p, aldric.pos.x, aldric.pos.z);
    expect(dist2d(p.pos, aldric.pos)).toBeLessThan(1);

    const beforeCopper = playerMeta(sim, pid).copper;
    interactWith(sim, pid, aldric);

    const meta = playerMeta(sim, pid);
    expect(meta.questsDone.has(FINAL_QUEST_ID)).toBe(true);
    expect(meta.questLog.has(FINAL_QUEST_ID)).toBe(false);
    expect(meta.copper).toBeGreaterThan(beforeCopper);
  });

  it('cannot be completed again in the raid after being handed in at Highwatch', () => {
    finalQuest();
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'HighwatchThenRaid');
    sim.setPlayerLevel(20, pid);
    acceptFinalQuest(sim, pid);
    const { aldric } = progressFinalQuestThroughNythraxisKill(sim, pid);

    moveToHighwatchAldric(sim, pid);
    interactWith(sim, pid, npc(sim, HIGHWATCH_ALDRIC_ID));
    const afterFirstTurnInCopper = playerMeta(sim, pid).copper;

    const p = entity(sim, pid);
    teleport(sim, p, aldric.pos.x, aldric.pos.z);
    interactWith(sim, pid, aldric);

    const meta = playerMeta(sim, pid);
    expect(meta.questsDone.has(FINAL_QUEST_ID)).toBe(true);
    expect(meta.questLog.has(FINAL_QUEST_ID)).toBe(false);
    expect(meta.copper).toBe(afterFirstTurnInCopper);
  });

  it('cannot be completed again at Highwatch after being handed in inside the raid', () => {
    finalQuest();
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'RaidThenHighwatch');
    sim.setPlayerLevel(20, pid);
    acceptFinalQuest(sim, pid);
    const { aldric } = progressFinalQuestThroughNythraxisKill(sim, pid);

    const p = entity(sim, pid);
    teleport(sim, p, aldric.pos.x, aldric.pos.z);
    interactWith(sim, pid, aldric);
    const afterFirstTurnInCopper = playerMeta(sim, pid).copper;

    moveToHighwatchAldric(sim, pid);
    interactWith(sim, pid, npc(sim, HIGHWATCH_ALDRIC_ID));

    const meta = playerMeta(sim, pid);
    expect(meta.questsDone.has(FINAL_QUEST_ID)).toBe(true);
    expect(meta.questLog.has(FINAL_QUEST_ID)).toBe(false);
    expect(meta.copper).toBe(afterFirstTurnInCopper);
  });
});
