import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// /inspect replies via the self-only `error` event addressed to the inspector.
function inspectReply(sim: Sim, pid: number, text: string): string | undefined {
  sim.chat(text, pid);
  const errs = sim.events.filter(
    (e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error' && (e as { pid: number }).pid === pid,
  );
  return errs.length ? errs[errs.length - 1].text : undefined;
}

describe('/inspect command', () => {
  it('reports another player\'s level, class, and health', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const e = sim.entities.get(b)!;
    e.level = 8;

    expect(inspectReply(sim, a, '/inspect Bet')).toBe('Bet: Level 8 Mage — HP 100%.');
  });

  it('shows a partial-health percentage and "dead" for a corpse', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('rogue', 'Gimel');
    const e = sim.entities.get(b)!;
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
    expect(inspectReply(sim, a, '/inspect BET')).toBe("Several players match 'BET'. Use exact capitalization.");
  });

  it('errors when the named player is not online', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(inspectReply(sim, a, '/inspect Nobody')).toBe("There is no player named 'Nobody' online.");
  });

  it('asks whom to inspect when no name is given', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    expect(inspectReply(sim, a, '/inspect')).toBe('Inspect whom? Usage: /inspect <name>.');
  });

  it('supports the /ins and /examine aliases', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.addPlayer('mage', 'Bet');
    expect(inspectReply(sim, a, '/ins Bet')).toMatch(/^Bet: Level \d+ Mage/);
    expect(inspectReply(sim, a, '/examine Bet')).toMatch(/^Bet: Level \d+ Mage/);
  });
});
