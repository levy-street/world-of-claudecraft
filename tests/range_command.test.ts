import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorText(events: SimEvent[], pid: number): string | undefined {
  const e = events.find((ev): ev is Extract<SimEvent, { type: 'error' }> =>
    ev.type === 'error' && ev.pid === pid);
  return e?.text;
}

function findWolf(sim: Sim) {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && !e.dead && e.templateId === 'forest_wolf',
  )!;
}

describe('/range command', () => {
  it('reports no target when nothing is targeted', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/range', a);
    expect(errorText(sim.tick(), a)).toBe('You have no target.');
  });

  it('reports distance and flags a target inside melee reach', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const player = sim.entities.get(a)!;
    const wolf = findWolf(sim);
    player.pos.x = 0; player.pos.z = -200;
    wolf.pos.x = 3; wolf.pos.z = -200; // 3yd away, within MELEE_RANGE (5)
    sim.targetEntity(wolf.id, a);
    sim.tick();

    sim.chat('/range', a);
    expect(errorText(sim.tick(), a)).toBe(`Your target ${wolf.name} is 3yd away (in melee range).`);
  });

  it('flags a target beyond melee reach', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const player = sim.entities.get(a)!;
    const wolf = findWolf(sim);
    player.pos.x = 0; player.pos.z = -200;
    wolf.pos.x = 12; wolf.pos.z = -200; // 12yd away, beyond MELEE_RANGE
    sim.targetEntity(wolf.id, a);
    sim.tick();

    sim.chat('/range', a);
    expect(errorText(sim.tick(), a)).toBe(`Your target ${wolf.name} is 12yd away (out of melee range).`);
  });

  it('supports the /dist and /distance aliases', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/dist', a);
    expect(errorText(sim.tick(), a)).toBe('You have no target.');
    sim.chat('/distance', a);
    expect(errorText(sim.tick(), a)).toBe('You have no target.');
  });
});
