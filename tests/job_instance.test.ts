import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { DUNGEON_LIST } from '../src/sim/data';

// The job-contract watcher credits a `clear_dungeon` milestone to the SUBJECT'S
// OWN instance via Sim.instanceForPlayer — never to a player standing in another
// party's concurrent copy of the same dungeon. This guards that accessor.
describe('Sim.instanceForPlayer', () => {
  it('returns the instance a player is running (matching dungeonId)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Guard');
    sim.tick();
    expect(sim.instanceForPlayer(pid)).toBeNull(); // not inside any instance yet

    const dungeon = DUNGEON_LIST.find((d) => d.id !== 'nythraxis_crypt') ?? DUNGEON_LIST[0];
    sim.enterDungeon(dungeon.id, pid);
    sim.tick();

    const inst = sim.instanceForPlayer(pid);
    expect(inst).not.toBeNull();
    expect(inst!.dungeonId).toBe(dungeon.id);
    expect(inst!.mobIds.length).toBeGreaterThan(0); // mobs spawned, so a clear is detectable
  });

  it('keeps two parties in distinct instances of the same dungeon', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Alpha');
    const b = sim.addPlayer('warrior', 'Bravo');
    sim.tick();
    const dungeon = DUNGEON_LIST.find((d) => d.id !== 'nythraxis_crypt') ?? DUNGEON_LIST[0];
    sim.enterDungeon(dungeon.id, a);
    sim.enterDungeon(dungeon.id, b);
    sim.tick();

    const ia = sim.instanceForPlayer(a);
    const ib = sim.instanceForPlayer(b);
    expect(ia).not.toBeNull();
    expect(ib).not.toBeNull();
    // Solo (unpartied) players claim separate slots — clearing one must not credit
    // the other, which is exactly why attribution is per-instance, not per-type.
    expect(ia!.slot).not.toBe(ib!.slot);
  });
});
