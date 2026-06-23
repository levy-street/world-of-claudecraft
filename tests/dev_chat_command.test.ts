import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

// Dev chat cheats (/dev, /dev level, /dev tp, /dev give) only run when the Sim
// is built with devCommands enabled (offline local play or a dev server). A
// handled dev command must NOT fall through to the "Unknown command" branch.
function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, devCommands: true });
}

function errorTexts(events: SimEvent[], pid: number): string[] {
  return events
    .filter(
      (ev): ev is Extract<SimEvent, { type: 'error' }> => ev.type === 'error' && ev.pid === pid,
    )
    .map((e) => e.text);
}

function invCount(sim: Sim, pid: number, itemId: string): number {
  let n = 0;
  for (const s of sim.players.get(pid)!.inventory) if (s.itemId === itemId) n += s.count;
  return n;
}

describe('dev chat commands', () => {
  it('/dev give adds items without a spurious "Unknown command"', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/dev give worn_sword 5', a);
    const errs = errorTexts(sim.tick(), a);

    expect(invCount(sim, a, 'worn_sword')).toBe(5);
    expect(errs.some((t) => t.startsWith('Unknown command'))).toBe(false);
  });

  it('/dev level sets the level without a spurious "Unknown command"', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/dev level 10', a);
    const errs = errorTexts(sim.tick(), a);

    expect(sim.entities.get(a)!.level).toBe(10);
    expect(errs.some((t) => t.startsWith('Unknown command'))).toBe(false);
  });

  it('/dev tp teleports without a spurious "Unknown command"', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/dev tp 50 60', a);
    const errs = errorTexts(sim.tick(), a);

    const e = sim.entities.get(a)!;
    expect(e.pos.x).toBeCloseTo(50, 1);
    expect(e.pos.z).toBeCloseTo(60, 1);
    expect(errs.some((t) => t.startsWith('Unknown command'))).toBe(false);
  });

  it('bare /dev shows usage without a spurious "Unknown command"', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/dev', a);
    const errs = errorTexts(sim.tick(), a);

    expect(errs.some((t) => t.startsWith('Dev commands:'))).toBe(true);
    expect(errs.some((t) => t.startsWith('Unknown command'))).toBe(false);
  });

  it('an unhandled slash command still reports "Unknown command"', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();

    sim.chat('/bogus', a);
    const errs = errorTexts(sim.tick(), a);

    expect(errs.some((t) => t.startsWith('Unknown command'))).toBe(true);
  });
});
