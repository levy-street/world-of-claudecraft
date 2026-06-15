import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL, SimEvent, xpForLevel } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function chatEvents(events: SimEvent[]): Extract<SimEvent, { type: 'chat' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'chat' }> => e.type === 'chat');
}

function errorFor(events: SimEvent[], pid: number): string | undefined {
  const e = events.find((e) => e.type === 'error' && e.pid === pid) as
    | Extract<SimEvent, { type: 'error' }>
    | undefined;
  return e?.text;
}

describe('/xp command', () => {
  it('reports level, progress, percent, and remaining XP to the sender only', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const bystander = sim.addPlayer('mage', 'Bet');
    const meta = sim.players.get(a)!;
    sim.entities.get(a)!.level = 7;
    meta.xp = 1240;
    sim.tick();

    sim.chat('/xp', a);
    const events = sim.tick();
    // a readout is private and never logged as chat
    expect(chatEvents(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'error' && e.pid === bystander)).toBe(false);

    const need = xpForLevel(7); // total XP to reach level 8
    const pct = Math.floor((1240 / need) * 100);
    const text = errorFor(events, a)!;
    expect(text).toContain('Level 7');
    expect(text).toContain('1,240');
    expect(text).toContain(need.toLocaleString('en-US'));
    expect(text).toContain(`${pct}%`);
    expect(text).toContain((need - 1240).toLocaleString('en-US')); // remaining
  });

  it('aliases /exp and /experience behave the same', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.entities.get(a)!.level = 3;
    sim.players.get(a)!.xp = 0;
    sim.tick();

    for (const cmd of ['/exp', '/experience', '/XP']) {
      sim.chat(cmd, a);
      const events = sim.tick();
      expect(errorFor(events, a)).toContain('Level 3');
    }
  });

  it('announces the cap at max level instead of dividing by zero', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.entities.get(a)!.level = MAX_LEVEL;
    sim.players.get(a)!.xp = 0;
    sim.tick();

    sim.chat('/xp', a);
    const events = sim.tick();
    const text = errorFor(events, a)!;
    expect(text).toContain(`Level ${MAX_LEVEL}`);
    expect(text).toMatch(/max/i);
    expect(text).not.toContain('%');
  });
});
