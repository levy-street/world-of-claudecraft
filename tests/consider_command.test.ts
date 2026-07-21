import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

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

// Sets up two players, targets `target` from `self`, and forces both levels.
function setup(selfLevel: number, targetLevel: number) {
  const sim = makeWorld();
  const self = sim.addPlayer('warrior', 'Aleph');
  const target = sim.addPlayer('mage', 'Bet');
  sim.tick();
  sim.entities.get(self)!.level = selfLevel;
  sim.entities.get(target)!.level = targetLevel;
  sim.targetEntity(target, self);
  return { sim, self, target };
}

function verdict(sim: Sim, self: number): string | undefined {
  sim.chat('/consider', self);
  return lastError(sim.tick());
}

describe('/consider command', () => {
  it('reports no target when nothing is selected', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/consider', a);
    expect(lastError(sim.tick())).toBe('You have no target to consider.');
  });

  it('calls an equal-level target an even fight', () => {
    const { sim, self } = setup(10, 10);
    expect(verdict(sim, self)).toBe('Bet is level 10 — an even fight for you (level 10).');
  });

  it('flags a target 3+ levels up as daunting (the miss-penalty cliff)', () => {
    const { sim, self } = setup(10, 13);
    expect(verdict(sim, self)).toBe('Bet is level 13 — a daunting fight for you (level 10).');
  });

  it('flags a far-higher target as overwhelming', () => {
    const { sim, self } = setup(10, 16);
    expect(verdict(sim, self)).toBe('Bet is level 16 — an overwhelming fight for you (level 10).');
  });

  it('calls a much lower target an easy fight via the /con alias', () => {
    const { sim, self } = setup(10, 6);
    sim.chat('/con', self);
    expect(lastError(sim.tick())).toBe('Bet is level 6 — an easy fight for you (level 10).');
  });

  it('is self-only and never logged or spoken', () => {
    const { sim, self } = setup(10, 10);
    const result = sim.chat('/difficulty', self);
    expect(result).toBeNull();
    expect(sim.tick().some((e) => e.type === 'chat')).toBe(false);
  });
});
