import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function errorEvents(events: SimEvent[]): Extract<SimEvent, { type: 'error' }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error');
}

// The readout replies via the self-only `error` event; events surface on the
// tick following the chat() call, like the other chat fixtures.
function queuedReply(sim: Sim, pid: number): string {
  sim.chat('/queued', pid);
  const errs = errorEvents(sim.tick()).filter((e) => e.pid === pid);
  return errs[errs.length - 1]?.text ?? '';
}

describe('/queued command', () => {
  it('reports nothing queued for a fresh warrior', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    expect(queuedReply(sim, a)).toBe('You have no ability queued for your next swing.');
  });

  it('reports the queued ability with its cost and current resource', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.queuedOnSwing = 'heroic_strike';
    e.resource = 50; // ample rage
    const reply = queuedReply(sim, a);
    expect(reply).toMatch(
      /^Reaver Strike is queued for your next melee swing \(costs \d+ rage; you have 50\)\.$/,
    );
    expect(reply).not.toContain('fizzle');
  });

  it('warns that an unaffordable queued ability will fizzle', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    const e = sim.entities.get(a)!;
    e.queuedOnSwing = 'heroic_strike';
    e.resource = 0; // cannot pay the cost
    const reply = queuedReply(sim, a);
    expect(reply).toContain('but you cannot afford it');
    expect(reply).toContain('it will fizzle');
  });

  it('is reachable through every alias', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    for (const cmd of ['/queued', '/onswing', '/swingqueue']) {
      sim.chat(cmd, a);
      const errs = errorEvents(sim.tick()).filter((ev) => ev.pid === a);
      expect(errs[errs.length - 1]?.text).toBe('You have no ability queued for your next swing.');
    }
  });
});
