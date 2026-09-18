import { describe, expect, it } from 'vitest';
import { WORLD_QUESTS_BY_ID } from '../src/sim/content/world_quests';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import {
  FARSHORE_SALVAGE_AMBUSH as DEF,
  worldQuestAmbushState,
} from '../src/sim/world_quest_ambush';
import { worldQuestSalvageLayout } from '../src/sim/world_quest_salvage';

const QUEST_ID = 'wq_farshore_salvage';

function armed(): Sim {
  const sim = new Sim({ seed: 21, playerClass: 'warrior', devCommands: true });
  sim.resetDay = '2026-09-06';
  sim.chat('/dev salvage');
  sim.tick();
  sim.player.pos = sim.groundPos(DEF.portal.x + 2, DEF.portal.z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.tick();
  return sim;
}

/** Walk to and recover the first `count` pieces of the offered layout. */
function recover(sim: Sim, count: number): void {
  const meta = sim.meta(sim.playerId)!;
  const layout = worldQuestSalvageLayout(
    WORLD_QUESTS_BY_ID[QUEST_ID],
    meta.worldQuestLog.get(QUEST_ID),
    meta.worldQuestCycle,
  );
  for (const id of layout.slice(0, count)) {
    const piece = sim.entities.get(id)!;
    sim.player.pos = sim.groundPos(piece.pos.x + 1, piece.pos.z);
    sim.player.prevPos = { ...sim.player.pos };
    expect(sim.pickUpObject(id)).toBe(true);
  }
  sim.player.pos = sim.groundPos(DEF.portal.x + 2, DEF.portal.z);
  sim.player.prevPos = { ...sim.player.pos };
}

function ticks(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds * 20); i++) sim.tick();
}

function liveAmbushMobs(sim: Sim): Entity[] {
  const state = worldQuestAmbushState(sim.ctx, DEF);
  return (state?.mobIds ?? [])
    .map((id) => sim.entities.get(id))
    .filter((e): e is Entity => !!e && !e.dead);
}

function slay(sim: Sim, mobs: readonly Entity[]): void {
  for (const mob of mobs) {
    sim.player.targetId = mob.id;
    sim.chat('/dev killtarget');
  }
  sim.tick();
}

describe('the wreck raiders ambush', () => {
  it('opens a rift at half the debris, pours two waves and a promoted captain, then pays the opener', () => {
    const sim = armed();
    const meta = sim.meta(sim.playerId)!;
    recover(sim, 3);
    expect(worldQuestAmbushState(sim.ctx, DEF)).toBeUndefined();
    recover(sim, 4);
    const opened = worldQuestAmbushState(sim.ctx, DEF);
    expect(opened?.phase).toBe('portal');
    expect(opened?.openedBy).toBe(sim.playerId);
    expect(liveAmbushMobs(sim)).toHaveLength(0);
    ticks(sim, DEF.telegraphSeconds + 0.1);
    let mobs = liveAmbushMobs(sim);
    expect(worldQuestAmbushState(sim.ctx, DEF)?.phase).toBe('wave');
    expect(mobs).toHaveLength(DEF.waves[0].count);
    for (const mob of mobs) {
      expect(mob.templateId).toBe(DEF.waves[0].mobId);
      expect(mob.level).toBe(DEF.waves[0].level);
      expect(mob.summonedAdd).toBe(true);
      expect(mob.runScoped).toBe(true);
      expect(mob.aggroTargetId).toBe(sim.playerId);
      expect(Math.hypot(mob.pos.x - DEF.portal.x, mob.pos.z - DEF.portal.z)).toBeLessThan(
        DEF.ringYards + 1,
      );
    }
    slay(sim, mobs);
    ticks(sim, DEF.telegraphSeconds);
    mobs = liveAmbushMobs(sim);
    expect(mobs).toHaveLength(DEF.waves[1].count);
    slay(sim, mobs);
    ticks(sim, 0.1);
    const leaderState = worldQuestAmbushState(sim.ctx, DEF);
    expect(leaderState?.phase).toBe('leader');
    const leader = sim.entities.get(leaderState!.leaderId!)!;
    const plain = sim.entities.get(mobs[0].id)!;
    expect(leader.level).toBe(DEF.leader.level);
    expect(leader.scale).toBe(DEF.leader.scale);
    expect(leader.maxHp).toBeGreaterThan(plain.maxHp * 3);
    const copperBefore = meta.copper;
    slay(sim, [leader]);
    const done = worldQuestAmbushState(sim.ctx, DEF);
    expect(done?.phase).toBe('done');
    expect(done?.cooldownUntil).toBeGreaterThan(sim.time);
    expect(meta.copper - copperBefore).toBe(
      Math.round(DEF.purse.base + DEF.purse.perLevel * sim.player.level),
    );
    // The salvage itself is unaffected: the remaining four pieces still credit.
    expect(meta.worldQuestLog.get(QUEST_ID)?.count).toBe(4);
    recover(sim, 8);
    expect(meta.worldQuestLog.get(QUEST_ID)?.state).toBe('completed');
    expect(worldQuestAmbushState(sim.ctx, DEF)?.phase).toBe('done');
  });

  it('tears an abandoned ambush down and refuses to reopen during the cooldown', () => {
    const sim = armed();
    recover(sim, 4);
    ticks(sim, DEF.telegraphSeconds + 0.1);
    expect(liveAmbushMobs(sim)).toHaveLength(DEF.waves[0].count);
    // Walk far away and stay away past the grace period.
    sim.player.pos = sim.groundPos(DEF.portal.x + DEF.abandonYards + 40, DEF.portal.z);
    sim.player.prevPos = { ...sim.player.pos };
    ticks(sim, DEF.abandonSeconds + 1);
    const state = worldQuestAmbushState(sim.ctx, DEF);
    expect(state?.phase).toBe('done');
    expect(liveAmbushMobs(sim)).toHaveLength(0);
    // A second opener on the same site during the cooldown gets nothing.
    const secondSim = sim;
    const meta = secondSim.meta(secondSim.playerId)!;
    meta.worldQuestLog.get(QUEST_ID)!.count = 3;
    meta.worldQuestLog.get(QUEST_ID)!.creditedObjects = meta.worldQuestLog
      .get(QUEST_ID)!
      .creditedObjects!.slice(0, 3);
    secondSim.player.pos = secondSim.groundPos(DEF.portal.x + 2, DEF.portal.z);
    secondSim.player.prevPos = { ...secondSim.player.pos };
    recover(secondSim, 4);
    expect(worldQuestAmbushState(secondSim.ctx, DEF)?.phase).toBe('done');
    expect(liveAmbushMobs(secondSim)).toHaveLength(0);
  });
});
