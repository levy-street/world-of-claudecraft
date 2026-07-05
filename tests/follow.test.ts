import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

function entity(sim: Sim, id: number) {
  const found = sim.entities.get(id);
  if (!found) throw new Error(`Missing entity ${id}`);
  return found;
}

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = entity(sim, pid);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function dist(sim: Sim, a: number, b: number) {
  const ea = entity(sim, a);
  const eb = entity(sim, b);
  return Math.hypot(ea.pos.x - eb.pos.x, ea.pos.z - eb.pos.z);
}

function errors(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('/follow', () => {
  it('walks the follower toward the leader and stops at the trail distance', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -1000);
    teleport(sim, b, 20, -1000);
    sim.tick();

    sim.chat('/follow Bet', a);
    const msgs = errors(sim.tick());
    expect(msgs.some((t) => /Now following Bet/.test(t))).toBe(true);

    // run the sim forward; the follower should close the gap and settle near it
    for (let i = 0; i < 600; i++) sim.tick();
    const d = dist(sim, a, b);
    expect(d).toBeLessThanOrEqual(4); // ~FOLLOW_STOP_DIST (3) plus a tick of slop
    expect(sim.entities.get(a)?.followTargetId).toBe(b);
  });

  it('keeps trailing when the leader moves away', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -1000);
    teleport(sim, b, 6, -1000);
    sim.tick();
    sim.chat('/follow Bet', a);
    for (let i = 0; i < 60; i++) sim.tick();

    // leader strides off; follower should chase and stay close
    teleport(sim, b, 30, -1000);
    for (let i = 0; i < 600; i++) sim.tick();
    expect(dist(sim, a, b)).toBeLessThanOrEqual(4);
  });

  it('breaks follow when the follower issues manual movement', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 10, -40);
    sim.tick();
    sim.chat('/follow Bet', a);
    sim.tick();
    expect(sim.entities.get(a)?.followTargetId).toBe(b);

    const meta = sim.players.get(a);
    if (!meta) throw new Error(`Missing player metadata ${a}`);
    meta.moveInput.forward = true;
    const msgs = errors(sim.tick());
    expect(sim.entities.get(a)?.followTargetId).toBe(null);
    expect(msgs.some((t) => /stop following/i.test(t))).toBe(true);
  });

  it('ends follow when the leader goes out of range', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 5, -40);
    sim.tick();
    sim.chat('/follow Bet', a);
    sim.tick();

    teleport(sim, b, 200, -40); // beyond FOLLOW_MAX_RANGE
    const msgs = errors(sim.tick());
    expect(sim.entities.get(a)?.followTargetId).toBe(null);
    expect(msgs.some((t) => /too far away to follow/i.test(t))).toBe(true);
  });

  it('rejects following yourself and unknown players', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    sim.tick();
    sim.chat('/follow Aleph', a);
    expect(errors(sim.tick()).some((t) => /follow yourself/i.test(t))).toBe(true);
    sim.chat('/follow Nobody', a);
    expect(errors(sim.tick()).some((t) => /no player named/i.test(t))).toBe(true);
  });
});
