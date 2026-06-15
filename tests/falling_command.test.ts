import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorTextFor(sim: Sim, pid: number): string | undefined {
  const ev = sim
    .tick()
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid);
  return ev.length ? ev[ev.length - 1].text : undefined;
}

describe('/falling command', () => {
  it('reports solid ground when not airborne', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.onGround = true;

    sim.chat('/falling', a);
    expect(errorTextFor(sim, a)).toBe('You are on solid ground.');
  });

  it('reports rising while ascending (vy > 0)', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    const ground = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
    e.onGround = false;
    e.vy = 5;
    e.pos.y = ground + 4;
    e.fallStartY = e.pos.y;

    sim.chat('/jump', a);
    expect(errorTextFor(sim, a)).toBe('You are airborne and rising — 4yd above the ground.');
  });

  it('warns of a dangerous fall when the peak drop exceeds the safe distance', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    const ground = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
    e.onGround = false;
    e.vy = -8;
    e.pos.y = ground + 9;
    e.fallStartY = ground + 20; // 20yd drop > 12yd safe distance

    sim.chat('/airborne', a);
    expect(errorTextFor(sim, a)).toBe(
      'You are falling — 9yd above the ground. Brace for impact — this fall is going to hurt.',
    );
  });

  it('reports a safe landing for a short fall', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    const ground = groundHeight(e.pos.x, e.pos.z, sim.cfg.seed);
    e.onGround = false;
    e.vy = -3;
    e.pos.y = ground + 2;
    e.fallStartY = ground + 5; // 5yd drop <= 12yd safe distance

    sim.chat('/falling', a);
    expect(errorTextFor(sim, a)).toBe(
      'You are falling — 2yd above the ground. It should be a safe landing.',
    );
  });
});
