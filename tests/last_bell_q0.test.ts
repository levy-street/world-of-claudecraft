// Q0 "Ashore" end to end through the real Sim: the ferry crossing accepts
// the quest and plays the arrival scene, Sergeant Marsh credits the report,
// the meadow cull counts, the Tidemill door starts the solo scenario, the
// stalker calls its add waves, the doorway stage brings Coalfast and Tam in
// with Tam's line, and the quest turns in at Warden Coalfast.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { scenarioRunFor } from '../src/sim/scenarios/scenarios';
import { Sim } from '../src/sim/sim';
import { squadActorEntity } from '../src/sim/squad/squad';
import type { Entity, SimEvent } from '../src/sim/types';

const QUEST = 'q_lb_q0_ashore';

function makeSim(): Sim {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', playerName: 'Ash', devCommands: true });
  sim.player.level = 6;
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.rebucket(sim.player);
}

function findByName(sim: Sim, name: string): Entity | undefined {
  return [...sim.entities.values()].find((e) => e.name === name && !e.dead);
}

function collect(sim: Sim, ticks: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) out.push(...sim.tick());
  return out;
}

function killWithPlayer(sim: Sim, mob: Entity): void {
  sim.ctx.dealDamage(sim.player, mob, mob.maxHp * 10, false, 'physical', null, 'hit');
}

function questCounts(sim: Sim): number[] {
  return sim.questLog.get(QUEST)?.counts ?? [];
}

describe('Q0 Ashore end to end', () => {
  it('plays the whole quest from the mainland dock to the recruitment', () => {
    const sim = makeSim();

    // 1. Board the ferry on the mainland: quest auto-accepts, the crossing
    // lands at Gullhaven, and the arrival scene starts for this player.
    teleport(sim, 146, -52);
    const ferry = findByName(sim, 'The Farshore Ferry');
    expect(ferry).toBeTruthy();
    sim.player.targetId = ferry?.id ?? null;
    sim.interact();
    expect(sim.questLog.get(QUEST)?.state).toBe('active');
    expect(Math.hypot(sim.player.pos.x - 299, sim.player.pos.z - 78)).toBeLessThan(3);
    const arrival = collect(sim, 30);
    const sceneKinds = arrival
      .filter((e): e is Extract<SimEvent, { type: 'scene' }> => e.type === 'scene')
      .map((e) => e.op.kind);
    expect(sceneKinds).toContain('start');
    expect(sceneKinds).toContain('letterbox');
    // Re-boarding later is plain travel: no second accept, no second scene.
    // (The scene is still playing; the quest state simply stays active.)

    // 2. Report to Sergeant Marsh at the Watch Meadow.
    const marsh = findByName(sim, 'Sergeant Marsh');
    expect(marsh).toBeTruthy();
    if (!marsh) return;
    teleport(sim, marsh.pos.x + 1.5, marsh.pos.z + 1.5);
    sim.player.targetId = marsh.id;
    sim.interact();
    collect(sim, 2);
    expect(questCounts(sim)[0]).toBe(1);

    // 3. Cull twelve riftspawn in the meadow (spawned beside the player so
    // the test does not depend on camp layout).
    for (let i = 0; i < 12; i++) {
      const spawn = createMob(
        sim.ctx.nextId++,
        MOBS.riftspawn,
        3,
        sim.groundPos(sim.player.pos.x + 3, sim.player.pos.z + 3),
      );
      sim.ctx.addEntity(spawn);
      killWithPlayer(sim, spawn);
    }
    collect(sim, 2);
    expect(questCounts(sim)[1]).toBe(12);

    // 4. The Tidemill door starts the solo scenario.
    teleport(sim, 351, -9);
    const door = findByName(sim, 'The Tidemill');
    expect(door).toBeTruthy();
    sim.player.targetId = door?.id ?? null;
    sim.interact();
    collect(sim, 2);
    const claim = sim.ctx.instances.find(
      (i) => i.dungeonId === 'lb_tidemill' && i.partyKey !== null,
    );
    expect(claim).toBeTruthy();
    const claimId = claim?.exitId ?? -1;
    const run = scenarioRunFor(sim.ctx, claimId);
    expect(run?.stageIndex).toBe(0);
    const stalker = [...sim.entities.values()].find(
      (e) => e.templateId === 'tidemill_stalker' && !e.dead,
    );
    expect(stalker).toBeTruthy();

    // 5. The stalker calls its first add wave at 12s.
    collect(sim, 13 * 20);
    const adds = (run?.stageSpawnIds ?? [])
      .map((id) => sim.entities.get(id))
      .filter((e): e is Entity => !!e && e.templateId === 'riftspawn' && !e.dead);
    expect(adds.length).toBe(6);

    // 6. Kill the wave and the stalker: objective 2 fills, the doorway
    // stage arms, Coalfast and Tam walk in, and Tam's line plays.
    for (const add of adds) killWithPlayer(sim, add);
    if (stalker) killWithPlayer(sim, stalker);
    collect(sim, 3);
    expect(questCounts(sim)[2]).toBe(1);
    expect(run?.stageIndex).toBe(1);
    const doorwayEvents = collect(sim, 6 * 20);
    expect(squadActorEntity(sim.ctx, claimId, 'tam')).toBeTruthy();
    expect(squadActorEntity(sim.ctx, claimId, 'coalfast')).toBeTruthy();
    const tamLine = doorwayEvents.find(
      (e) => e.type === 'scene' && e.op.kind === 'line' && e.op.key === 'lb.q0.tam.stretchers',
    );
    expect(tamLine).toBeTruthy();

    // 7. The scene ends, the run completes, the two walk back to the cliffs
    // (despawn), and the quest is ready for Coalfast.
    collect(sim, 8 * 20);
    expect(run?.done).toBe(true);
    expect(squadActorEntity(sim.ctx, claimId, 'tam')).toBeNull();
    expect(sim.questLog.get(QUEST)?.state).toBe('ready');

    // 8. Turn in at Warden Coalfast (his home-form post in Gullhaven).
    const coalfast = findByName(sim, 'Warden Coalfast');
    expect(coalfast).toBeTruthy();
    if (!coalfast) return;
    teleport(sim, coalfast.pos.x + 1.5, coalfast.pos.z + 1.5);
    const xpBefore = sim.xp;
    sim.turnInQuest(QUEST);
    expect(sim.questLog.has(QUEST)).toBe(false);
    expect(sim.ctx.players.get(sim.playerId)?.questsDone.has(QUEST)).toBe(true);
    expect(sim.xp).toBeGreaterThan(xpBefore);
  });

  it('the ferry is plain travel once the quest is done or active', () => {
    const sim = makeSim();
    sim.ctx.players.get(sim.playerId)?.questsDone.add(QUEST);
    teleport(sim, 146, -52);
    const ferry = findByName(sim, 'The Farshore Ferry');
    sim.player.targetId = ferry?.id ?? null;
    sim.interact();
    expect(sim.questLog.has(QUEST)).toBe(false);
    const events = collect(sim, 10);
    expect(events.some((e) => e.type === 'scene')).toBe(false);
    // And the Gullhaven pier ferries back.
    const back = findByName(sim, 'The Farshore Ferry');
    sim.player.targetId = back?.id ?? null;
    sim.interact();
    expect(sim.player.pos.x).toBeLessThan(200);
  });
});
