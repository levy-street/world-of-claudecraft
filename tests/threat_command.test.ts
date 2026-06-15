// /threat (alias /aggro) is a self-only readout of the threat table on the
// player's current target — highest first, as a percentage of the threat
// leader. It reads live state only, emits an `error`-typed line shown only to
// the caller, and returns null so nothing is broadcast or logged.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function nearestMob(sim: Sim): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'mob' && !e.dead && e.ownerId === null) return e;
  }
  throw new Error('no mob found');
}

function lastError(sim: Sim, pid: number): string | undefined {
  const errs = sim.events.filter((e) => e.type === 'error' && (e as any).pid === pid);
  return errs.length ? (errs[errs.length - 1] as any).text : undefined;
}

describe('/threat command', () => {
  it('lists the target threat table highest-first as percentages of the leader', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const mob = nearestMob(sim);
    mob.threat.clear();
    mob.threat.set(a, 500); // leader
    mob.threat.set(b, 250); // half
    sim.entities.get(a)!.targetId = mob.id;

    expect(sim.chat('/threat', a)).toBeNull();
    const line = lastError(sim, a);
    expect(line).toBe(`Threat on ${mob.name} (2): Aleph (you) 100% [leader], Bet 50%.`);
  });

  it('reports no target when nothing is targeted', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.entities.get(a)!.targetId = null;

    sim.chat('/aggro', a);
    expect(lastError(sim, a)).toBe('You have no target.');
  });

  it('reports an empty table when the target has no threat on it', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mob = nearestMob(sim);
    mob.threat.clear();
    sim.entities.get(a)!.targetId = mob.id;

    sim.chat('/threat', a);
    expect(lastError(sim, a)).toBe(`Nobody has any threat on ${mob.name}.`);
  });

  it('refuses to read threat off a non-enemy target', () => {
    const sim = makeSim();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.entities.get(a)!.targetId = b;

    sim.chat('/threat', a);
    expect(lastError(sim, a)).toBe('Threat is only tracked on enemies; Bet is not one.');
  });
});
