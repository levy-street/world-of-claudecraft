// The Shardpike guidance projection (src/sim/lance_guidance.ts).
//
// This is the data behind the loud on-screen prompt, and the one property worth pinning hard
// is that it AGREES WITH THE VERB. A prompt that says "strike" over a thrust the sim will
// refuse, or that reports "in range" at a distance the thrust rejects, is worse than no
// prompt: it teaches the player that the mechanic is broken. So the range test here is
// asserted against `LANCE_THRUST_RANGE` itself and against the thrust's own behaviour, never
// against a copied literal.
import { beforeEach, describe, expect, it } from 'vitest';
import { LANCE_THRUST_RANGE } from '../src/sim/lance_balance_core';
import { LANCE_GUIDANCE_RANGE, lanceGuidanceFor } from '../src/sim/lance_guidance';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';
const PIKE = 'skerrits_shardpike';

describe('lanceGuidanceFor', () => {
  let sim: Sim;
  let ctx: SimContext;
  let boss: Entity;

  const place = (e: Entity, x: number, z: number) => {
    e.pos.x = x;
    e.pos.z = z;
    e.pos.y = terrainHeight(x, z, sim.cfg.seed);
    e.prevPos = { ...e.pos };
  };

  const guide = () => lanceGuidanceFor(ctx, sim.playerId, LANCE_THRUST_RANGE);
  const holdPike = () => {
    sim.players.get(sim.playerId)!.equipment.mainhand = PIKE;
  };

  beforeEach(() => {
    sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss(BALGATH, 0, 390);
    const e = sim.entities.get(id);
    if (!e) throw new Error('no boss');
    boss = e;
    ctx = (sim as unknown as { ctx: SimContext }).ctx;
    place(sim.player, 5, 390);
  });

  it('reports the boss and the distance to him', () => {
    const g = guide();
    expect(g).not.toBeNull();
    expect(g?.targetPresent).toBe(true);
    expect(g?.targetDistance).toBeCloseTo(5, 1);
  });

  it('agrees with the thrust about what is in range', () => {
    // The decisive pairing. Just inside the reach the prompt says "brace" and the thrust
    // finds a target; just outside, both say no. Anything else and the prompt is lying.
    place(sim.player, LANCE_THRUST_RANGE - 0.5, 390);
    expect(guide()?.inRange).toBe(true);
    place(sim.player, LANCE_THRUST_RANGE + 0.5, 390);
    expect(guide()?.inRange).toBe(false);
    // ...and he is still NAMED out there, because the whole job of the line at that distance
    // is "walk to him", which it cannot say if he stops existing to it at the same radius.
    expect(guide()?.targetPresent).toBe(true);
  });

  it('stops naming him once he is a zone away, so a carried pike does not nag forever', () => {
    place(sim.player, LANCE_GUIDANCE_RANGE + 20, 390);
    const g = guide();
    expect(g?.targetPresent).toBe(false);
    expect(g?.targetDistance).toBeNull();
    expect(LANCE_GUIDANCE_RANGE).toBeGreaterThan(LANCE_THRUST_RANGE * 2);
  });

  it('reads vulnerable, blinded and sealed off the live ward clocks', () => {
    // Fresh: the ward is up and nothing is sealing it.
    expect(guide()?.vulnerable).toBe(true);
    expect(guide()?.blinded).toBe(false);
    expect(guide()?.sealRemaining).toBe(0);

    // Blinded: the window is open, and the prompt must switch from "strike" to "stop".
    boss.eyeWardDownUntil = ctx.time + 9;
    boss.eyeWardSealedUntil = ctx.time + 9 + 40;
    let g = guide();
    expect(g?.blinded).toBe(true);
    expect(g?.vulnerable).toBe(false);
    expect(g?.blindRemaining).toBeCloseTo(9, 5);

    // Sealed: the window closed but the ward is not yet pryable. This is the state that
    // makes the mechanic look broken without a line naming it.
    boss.eyeWardDownUntil = ctx.time - 1;
    g = guide();
    expect(g?.blinded).toBe(false);
    expect(g?.vulnerable).toBe(false);
    expect(g?.sealRemaining).toBeGreaterThan(0);
  });

  it('never reports a negative remaining once a clock has passed', () => {
    boss.eyeWardDownUntil = ctx.time - 30;
    boss.eyeWardSealedUntil = ctx.time - 5;
    const g = guide();
    expect(g?.blindRemaining).toBe(0);
    expect(g?.sealRemaining).toBe(0);
  });

  it('carries the landed-thrust tally', () => {
    expect(guide()?.thrusts).toBe(0);
    sim.players.get(sim.playerId)!.lanceThrusts = 4;
    expect(guide()?.thrusts).toBe(4);
  });

  it('is null for a player who is not in the world at all', () => {
    expect(lanceGuidanceFor(ctx, 999999, LANCE_THRUST_RANGE)).toBeNull();
  });

  it('ignores a dead boss, so the prompt does not aim at a corpse', () => {
    boss.dead = true;
    expect(guide()?.targetPresent).toBe(false);
  });

  it('ignores a mob with no ward, however close it is', () => {
    // The lookup is by TEMPLATE opt-in, not by proximity: a bogtoad at your feet is not a
    // Shardpike target and the prompt must not offer it as one.
    const id = (
      sim as unknown as { spawnDevBoss(t: string, x: number, z: number): number }
    ).spawnDevBoss('bogtoad', 200, 200);
    const toad = sim.entities.get(id);
    if (!toad) throw new Error('no toad');
    place(sim.player, 200.5, 200);
    place(boss, 900, 900);
    expect(guide()?.targetPresent).toBe(false);
  });

  it('draws no rng: the prompt is a projection, not a roll', () => {
    holdPike();
    const rng = JSON.stringify((sim as unknown as { rng: unknown }).rng);
    for (let i = 0; i < 20; i++) guide();
    expect(JSON.stringify((sim as unknown as { rng: unknown }).rng)).toBe(rng);
  });
});
