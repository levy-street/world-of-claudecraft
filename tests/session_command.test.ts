import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorEvents(events: SimEvent[]): Extract<SimEvent, { type: 'error' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
}

// Drive a "/session" command for `pid` and return the self-only line it emits.
function sessionLine(sim: Sim, pid: number): string {
  sim.chat('/session', pid);
  const errs = errorEvents(sim.tick());
  expect(errs).toHaveLength(1);
  expect(errs[0].pid).toBe(pid);
  return errs[0].text;
}

describe('/session command', () => {
  it('reports a fresh session as all zeros', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    expect(sessionLine(sim, a)).toBe(
      'Session: 0 kills, 0 deaths. Damage dealt 0, taken 0. XP gained 0.',
    );
  });

  it('reflects this session\'s counters with singular/plural and thousands separators', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const c = sim.players.get(a)!.counters;
    c.kills = 14;
    c.deaths = 1; // singular
    c.damageDealt = 8420;
    c.damageTaken = 3110;
    c.xpGained = 5300;
    expect(sessionLine(sim, a)).toBe(
      'Session: 14 kills, 1 death. Damage dealt 8,420, taken 3,110. XP gained 5,300.',
    );
  });

  it('is self-only and never reaches the chat log', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.tick();
    sim.chat('/session', a);
    const events = sim.tick();
    const errs = errorEvents(events);
    expect(errs).toHaveLength(1);
    expect(errs[0].pid).toBe(a);
    expect(events.some((e) => e.type === 'chat')).toBe(false);
  });

  it('accepts the /sess and /sessionstats aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    for (const alias of ['/sess', '/sessionstats']) {
      sim.chat(alias, a);
      const errs = errorEvents(sim.tick());
      expect(errs).toHaveLength(1);
      expect(errs[0].text).toMatch(/^Session: /);
    }
  });
});
