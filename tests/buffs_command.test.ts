import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Aura, SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errors(events: SimEvent[]): Extract<SimEvent, { type: 'error' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
}

function timedAura(over: Partial<Aura>): Aura {
  return {
    id: 'x', name: 'Effect', kind: 'dot', remaining: 10, duration: 10,
    value: 0, sourceId: 0, school: 'physical', ...over,
  };
}

describe('/buffs command', () => {
  it('reports no active effects when the aura list is empty', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/buffs', a);
    const errs = errors(sim.tick());
    expect(errs.length).toBe(1);
    expect(errs[0].pid).toBe(a);
    expect(errs[0].text).toBe('You have no active effects.');
  });

  it('lists each active aura with its ceil-rounded remaining seconds', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.auras.push(timedAura({ id: 'battle_shout', name: 'Battle Shout', kind: 'buff_ap', remaining: 118 }));
    e.auras.push(timedAura({ id: 'rend', name: 'Rend', kind: 'dot', remaining: 3.2 }));

    sim.chat('/buffs', a);
    const errs = errors(sim.tick());
    expect(errs.length).toBe(1);
    // 3.2s still ceils to 4s while the effect is live
    expect(errs[0].text).toBe('Active effects (2): Battle Shout (118s), Rend (4s).');
  });

  it('accepts the /buff and /auras aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    for (const cmd of ['/buff', '/auras']) {
      sim.chat(cmd, a);
      const errs = errors(sim.tick());
      expect(errs.length).toBe(1);
      expect(errs[0].text).toBe('You have no active effects.');
    }
  });

  it('is self-only: produces no chat event and is not logged', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    const result = sim.chat('/buffs', a);
    expect(result).toBeNull();
    expect(sim.tick().some((ev) => ev.type === 'chat')).toBe(false);
  });
});
