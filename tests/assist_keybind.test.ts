// The F-key Assist (#948): adopt whatever your CURRENT target is targeting
// (target-of-target), with no name argument. This is distinct from the "/assist
// <name>" chat command (assist.test.ts / assist_command.test.ts), which resolves a
// named ally's target; here we pull the target of the unit already selected.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function spawnMob(sim: Sim, id: number, x: number, z: number) {
  const mob = createMob(id, MOBS['forest_wolf'], 5, sim.groundPos(x, z));
  sim.entities.set(id, mob);
  return mob;
}

describe('assistTarget (target-of-target keybind)', () => {
  it('adopts the target of your current target', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const mob = spawnMob(sim, 90101, -290, 5);

    sim.targetEntity(b, a); // Aleph selects Bet
    sim.targetEntity(mob.id, b); // Bet is fighting the wolf

    sim.assistTarget(a);
    expect(sim.entities.get(a)!.targetId).toBe(mob.id);
  });

  it('is a no-op when you have no target', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.assistTarget(a);
    expect(sim.entities.get(a)!.targetId).toBeNull();
  });

  it('is a no-op when your target has no target', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.targetEntity(b, a); // Bet has nothing targeted
    sim.assistTarget(a);
    expect(sim.entities.get(a)!.targetId).toBe(b);
  });
});
