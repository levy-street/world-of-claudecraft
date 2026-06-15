import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Entity, SimEvent } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function liveMob(sim: Sim): Entity {
  const mob = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && !e.dead && e.hostile && e.ownerId === null,
  );
  if (!mob) throw new Error('test needs a live wild mob');
  return mob;
}

function errors(events: SimEvent[]): string[] {
  return events.filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error').map((e) => e.text);
}

describe('/target readout command', () => {
  it('reports no target when nothing is targeted', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.chat('/target', a);
    const errs = errors(sim.tick());
    expect(errs.some((t) => /no target/i.test(t))).toBe(true);
  });

  it('reports a targeted mob with name, level, kind and HP percent', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mob = liveMob(sim);
    sim.targetEntity(mob.id, a);
    sim.chat('/tar', a); // alias
    const reply = errors(sim.tick()).find((t) => t.includes(mob.name));
    expect(reply).toBeDefined();
    expect(reply).toContain(`level ${mob.level}`);
    expect(reply).toContain('mob');
    expect(reply).toMatch(/\d+% HP/);
  });

  it('reports another player target as a player and never reaches other clients', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    sim.targetEntity(b, a);
    sim.chat('/target', a);
    const events = sim.tick();
    const reply = errors(events).find((t) => t.includes('Bet'));
    expect(reply).toContain('player');
    // self-only: it is an error event addressed to the asker, not a chat line
    expect(events.some((e) => e.type === 'chat')).toBe(false);
    expect(events.every((e) => e.type !== 'error' || e.pid === a)).toBe(true);
  });
});
