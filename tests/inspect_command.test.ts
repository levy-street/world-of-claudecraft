import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// /inspect replies via the self-only `error` event addressed to the inspector.
function inspectReply(sim: Sim, pid: number, text: string): string | undefined {
  sim.chat(text, pid);
  const errs = sim.events.filter(
    (e): e is Extract<typeof e, { type: 'error' }> =>
      e.type === 'error' && (e as { pid: number }).pid === pid,
  );
  return errs.length ? errs[errs.length - 1].text : undefined;
}

function inspectEvents(sim: Sim, pid: number): Extract<SimEvent, { type: 'inspect' }>[] {
  return sim.events.filter(
    (e): e is Extract<SimEvent, { type: 'inspect' }> => e.type === 'inspect' && e.pid === pid,
  );
}

describe('/inspect command', () => {
  it("reports another player's level, class, and health", () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const e = sim.entities.get(b);
    expect(e).toBeDefined();
    if (!e) throw new Error('missing inspect target entity');
    e.level = 8;

    expect(inspectReply(sim, a, '/inspect Bet')).toBe('Bet: Level 8 Mage — HP 100%.');
  });

  it('emits a personal inspect event for the resolved target', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');

    expect(inspectReply(sim, a, '/inspect Bet')).toMatch(/^Bet: Level \d+ Mage/);
    expect(inspectEvents(sim, a)).toEqual([{ type: 'inspect', targetId: b, pid: a }]);
  });

  it('shows a partial-health percentage and "dead" for a corpse', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('rogue', 'Gimel');
    const e = sim.entities.get(b);
    expect(e).toBeDefined();
    if (!e) throw new Error('missing inspect target entity');
    e.hp = Math.round(e.maxHp * 0.4);
    expect(inspectReply(sim, a, '/inspect Gimel')).toBe(`Gimel: Level ${e.level} Rogue — HP 40%.`);

    e.hp = 0;
    expect(inspectReply(sim, a, '/inspect Gimel')).toBe(`Gimel: Level ${e.level} Rogue — HP dead.`);
  });

  it('matches names case-insensitively when unambiguous', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    expect(inspectReply(sim, a, '/inspect bet')).toMatch(/^Bet: Level \d+ Mage/);
  });

  it('rejects an ambiguous case-insensitive match', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    sim.addPlayer('rogue', 'bet');
    expect(inspectReply(sim, a, '/inspect BET')).toBe(
      "Several players match 'BET'. Use exact capitalization.",
    );
    expect(inspectEvents(sim, a)).toEqual([]);
  });

  it('errors when the named player is not online', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(inspectReply(sim, a, '/inspect Nobody')).toBe(
      "There is no player named 'Nobody' online.",
    );
    expect(inspectEvents(sim, a)).toEqual([]);
  });

  it('asks whom to inspect when no name is given', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(inspectReply(sim, a, '/inspect')).toBe('Inspect whom? Usage: /inspect <name>.');
    expect(inspectEvents(sim, a)).toEqual([]);
  });

  it('supports the /ins and /examine aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    expect(inspectReply(sim, a, '/ins Bet')).toMatch(/^Bet: Level \d+ Mage/);
    expect(inspectReply(sim, a, '/examine Bet')).toMatch(/^Bet: Level \d+ Mage/);
  });
});
