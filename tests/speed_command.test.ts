import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Aura, SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function aura(kind: Aura['kind'], value: number): Aura {
  return {
    id: `${kind}_test`,
    name: kind,
    kind,
    remaining: 10,
    duration: 10,
    value,
    sourceId: 0,
    school: 'physical',
  };
}

function speedText(sim: Sim, pid: number): string | undefined {
  sim.chat('/speed', pid);
  const events: SimEvent[] = sim.tick();
  const err = events.find((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
  return err?.text;
}

describe('/speed command', () => {
  it('reports 100% of normal when unaffected', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    expect(speedText(sim, a)).toBe('Movement speed: 100% of normal.');
  });

  it('reports a slowed percent under a slow aura', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.entities.get(a)!.auras.push(aura('slow', 0.6));
    expect(speedText(sim, a)).toBe('Movement speed: 60% of normal (slowed).');
  });

  it('reports a hastened percent under a speed buff', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.entities.get(a)!.auras.push(aura('buff_speed', 1.4));
    expect(speedText(sim, a)).toBe('Movement speed: 140% of normal (hastened).');
  });

  it('reports rooted state regardless of speed modifiers', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.auras.push(aura('buff_speed', 1.4));
    e.auras.push(aura('root', 1));
    expect(speedText(sim, a)).toBe('You are rooted in place and cannot move.');
  });

  it('aliases /movespeed and /ms behave the same', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    expect(speedText(sim, a)).toBe('Movement speed: 100% of normal.');
    sim.chat('/movespeed', a);
    expect(sim.tick().some((e) => e.type === 'error' && e.text === 'Movement speed: 100% of normal.')).toBe(true);
    sim.chat('/ms', a);
    expect(sim.tick().some((e) => e.type === 'error' && e.text === 'Movement speed: 100% of normal.')).toBe(true);
  });
});
