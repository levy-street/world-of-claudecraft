// Leaving a dungeon must drop the departing player from every mob in that instance,
// so a mob no longer targets someone who is gone: it switches to whoever else is on
// its threat table, or de-aggros and returns home if no one remains (#565).
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

describe('leaving an instance drops you from its mobs', () => {
  it('a mob stops targeting a player who left the dungeon', () => {
    const sim = makeSim();
    const p = sim.player;
    sim.enterDungeon('hollow_crypt');
    const inst = (
      sim as unknown as { instances: { partyKey: unknown; mobIds: number[] }[] }
    ).instances.find((i) => i.partyKey !== null && i.mobIds.length > 0);
    expect(inst).toBeTruthy();
    const mob = sim.entities.get(inst!.mobIds[0]);
    if (!mob) throw new Error('no instance mob');
    mob.aiState = 'chase';
    mob.aggroTargetId = p.id;
    mob.threat.set(p.id, 500);

    sim.leaveDungeon();

    expect(mob.aggroTargetId).not.toBe(p.id);
    expect([...mob.threat.keys()]).not.toContain(p.id);
  });
});
