import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dealDamage } from '../src/sim/combat/damage';
import { MOBS, WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { PARTY_XP_RANGE } from '../src/sim/types';
import { creditWorldQuestKills } from '../src/sim/world_quest_kill_credit';
import { onMobKilledForWorldQuests, updateWorldQuests } from '../src/sim/world_quests';

const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
let sim: Sim;
beforeAll(() => {
  sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  sim.resetDay = '2026-08-31';
});

function setup(start = true) {
  const killerId = sim.addPlayer('warrior', 'Killer');
  const memberId = sim.addPlayer('mage', 'Member');
  const killer = sim.entities.get(killerId);
  const member = sim.entities.get(memberId);
  const killerMeta = sim.meta(killerId);
  const memberMeta = sim.meta(memberId);
  if (!killer || !member || !killerMeta || !memberMeta) throw new Error('Missing party players');
  for (const player of [killer, member]) {
    sim.setPlayerLevel(quest.minLevel, player.id);
    player.pos = sim.ctx.groundPos(quest.area.x, quest.area.z);
    player.prevPos = { ...player.pos };
  }
  sim.partyInvite(memberId, killerId);
  sim.partyAccept(memberId);
  expect(sim.partyOf(killerId)?.members).toContain(memberId);
  if (quest.objective.type !== 'kill') throw new Error('Expected kill quest');
  const template = MOBS[quest.objective.targetMobId];
  const mob = createMob(sim.ctx.nextId++, template, template.minLevel, { ...killer.pos });
  sim.ctx.addEntity(mob);
  if (start) {
    updateWorldQuests(sim.ctx, killerMeta, killer);
    updateWorldQuests(sim.ctx, memberMeta, member);
  }
  const kill = () =>
    dealDamage(sim.ctx, killer, mob, mob.maxHp * 10, false, 'physical', 'Test', 'hit');
  return { killer, member, killerMeta, memberMeta, mob, kill };
}

describe('world quest authoritative party kill credit', () => {
  it('credits both living members once when the tapper lands the killing blow', () => {
    const { killerMeta, memberMeta, kill } = setup();
    kill();
    expect(killerMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
    kill();
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('credits the tapped party when the other member lands the killing blow', () => {
    const { killer, member, killerMeta, memberMeta, mob } = setup();
    mob.tappedById = killer.id;
    dealDamage(sim.ctx, member, mob, mob.maxHp * 10, false, 'physical', 'Test', 'hit');
    expect(killerMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('starts and credits a later party member before their area-update tick', () => {
    const { killer, killerMeta, memberMeta, kill } = setup(false);
    updateWorldQuests(sim.ctx, killerMeta, killer);
    expect(memberMeta.worldQuestLog.has(quest.id)).toBe(false);
    kill();
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('starts and credits the killer before any area-update tick', () => {
    const { killerMeta, kill } = setup(false);
    kill();
    expect(killerMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('credits an active quest for a fallen nearby member', () => {
    const { member, memberMeta, kill } = setup();
    member.dead = true;
    member.hp = 0;
    kill();
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('judges a released member from the corpse left in the quest area', () => {
    const { member, memberMeta, kill } = setup();
    member.dead = true;
    member.ghost = true;
    member.hp = 0;
    member.corpsePos = { ...member.pos };
    member.corpseInstanceId = null;
    member.pos = sim.ctx.groundPos(0, 0);
    kill();
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('does not credit a party member beyond the shared kill range', () => {
    const { member, memberMeta, kill } = setup();
    member.pos.x += PARTY_XP_RANGE + 1;
    kill();
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(0);
  });

  it('does not start a quest for a member below its minimum level', () => {
    const { member, memberMeta, kill } = setup(false);
    sim.setPlayerLevel(quest.minLevel - 1, member.id);
    kill();
    expect(memberMeta.worldQuestLog.has(quest.id)).toBe(false);
  });

  it('does not start a new quest for a fallen member', () => {
    const { member, memberMeta, kill } = setup(false);
    member.dead = true;
    member.hp = 0;
    kill();
    expect(memberMeta.worldQuestLog.has(quest.id)).toBe(false);
  });

  it('credits the first kill after reconciling a stale rotation', () => {
    const { memberMeta, kill } = setup();
    memberMeta.worldQuestCycle = 'wq1_1';
    expect(memberMeta.worldQuestCycle).not.toBe(sim.ctx.currentWorldQuestRotation().cycle);
    const progress = memberMeta.worldQuestLog.get(quest.id);
    if (!progress) throw new Error('Missing hunt');
    progress.count = 3;
    kill();
    expect(memberMeta.worldQuestCycle).toBe(sim.ctx.currentWorldQuestRotation().cycle);
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('completes a fallen member hunt and pays its reward once', () => {
    const { member, memberMeta, mob, kill } = setup();
    const progress = memberMeta.worldQuestLog.get(quest.id);
    if (!progress) throw new Error('Missing hunt');
    progress.count = quest.count - 1;
    member.dead = true;
    member.hp = 0;
    const completed = memberMeta.counters.questsCompleted;
    const beforeCopper = memberMeta.copper;
    kill();
    expect(progress.state).toBe('completed');
    expect(memberMeta.counters.questsCompleted).toBe(completed + 1);
    expect(memberMeta.copper).toBeGreaterThan(beforeCopper);
    const copper = memberMeta.copper;
    onMobKilledForWorldQuests(sim.ctx, mob, memberMeta);
    expect(memberMeta.copper).toBe(copper);
    expect(memberMeta.counters.questsCompleted).toBe(completed + 1);
  });

  it('ignores a hunt that the member personally rerolled', () => {
    const { memberMeta, kill } = setup();
    memberMeta.worldQuestReplacements = { [quest.id]: 'wq_evergarden_forging' };
    kill();
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(0);
  });

  it('keeps the player and mob area limits on an active quest', () => {
    const { member, memberMeta, mob } = setup();
    member.pos.x = quest.area.x + quest.area.radius + 1;
    onMobKilledForWorldQuests(sim.ctx, mob, memberMeta);
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(0);
    member.pos.x = quest.area.x;
    mob.pos.x = quest.area.x + quest.area.radius + 1;
    onMobKilledForWorldQuests(sim.ctx, mob, memberMeta);
    expect(memberMeta.worldQuestLog.get(quest.id)?.count).toBe(0);
  });

  it('initializes hunt progress and wire state without drawing randomness', () => {
    const { member, memberMeta, mob } = setup(false);
    // The production wrapper normally reconciles this rotation first.
    memberMeta.worldQuestCycle = sim.ctx.currentWorldQuestRotation().cycle;
    const draws = vi.fn();
    const credit = vi.fn();
    const emit = vi.spyOn(sim.ctx, 'emit');
    const revision = memberMeta.wireRev;
    sim.ctx.rng.setObserver(draws);
    try {
      creditWorldQuestKills(sim.ctx, mob, memberMeta, credit);
      expect(credit).toHaveBeenCalledWith(quest, memberMeta.worldQuestLog.get(quest.id));
      expect(memberMeta.worldQuestLog.get(quest.id)).toEqual({
        questId: quest.id,
        count: 0,
        state: 'active',
      });
      expect(memberMeta.wireRev).toBe(revision + 1);
      expect(memberMeta.worldQuestAreas.has(quest.id)).toBe(true);
      expect(emit).toHaveBeenCalledWith({
        type: 'worldQuestStarted',
        questId: quest.id,
        pid: member.id,
      });
      expect(draws).not.toHaveBeenCalled();
    } finally {
      sim.ctx.rng.setObserver(null);
      emit.mockRestore();
    }
  });

  it('refuses recipients whose disconnect teardown has started', () => {
    const { memberMeta, mob } = setup();
    memberMeta.leaving = true;
    const credit = vi.fn();
    creditWorldQuestKills(sim.ctx, mob, memberMeta, credit);
    expect(credit).not.toHaveBeenCalled();
  });
});
