import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function lastError(events: SimEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'error') return e.text;
  }
  return undefined;
}

describe('/combat command', () => {
  it('reports when you are not in combat', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.entities.get(a)!.inCombat = false;

    sim.chat('/combat', a);
    expect(lastError(sim.tick())).toBe('You are not in combat.');
  });

  it('reports the linger countdown while only the combat timer keeps you engaged', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.inCombat = true;
    e.combatTimer = 2; // 5s linger window - 2s elapsed -> 3s remaining

    sim.chat('/cb', a);
    expect(lastError(sim.tick())).toBe('You are in combat — leaving in 3s if no further action.');
  });

  it('reports active engagement while an enemy still holds you on its hate table', () => {
    // A fresh hit puts the timer inside the linger window, but the wolf is alive
    // and still carries the player: no countdown can be promised.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.setPlayerLevel(30, a);
    sim.tick();
    const e = sim.entities.get(a)!;
    const template = MOBS.forest_wolf;
    if (!template) throw new Error('forest_wolf template missing');
    const wolf = createMob(90_001, template, 5, sim.groundPos(305, 0));
    wolf.maxHp = 50_000;
    wolf.hp = 50_000;
    sim.entities.set(wolf.id, wolf);
    e.pos.x = 307;
    e.pos.z = 0;
    e.prevPos = { ...e.pos };
    sim.dealDamage(e, wolf, 50, false, 'physical', null, 'hit', true);
    sim.tick();
    expect(wolf.threat.has(a)).toBe(true);
    expect(e.combatTimer).toBeLessThan(5);

    sim.chat('/combat', a);
    expect(lastError(sim.tick())).toBe('You are in combat (enemies still engaged).');
  });

  it('reports active engagement when in combat past the linger window', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.inCombat = true;
    e.combatTimer = 99; // engaged: timer well past the drop-out window

    sim.chat('/incombat', a);
    expect(lastError(sim.tick())).toBe('You are in combat (enemies still engaged).');
  });
});
