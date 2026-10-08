// The Barrow Smash's gap (owner playtest: "the ability that hits a circle and has a kind of
// gap: the gap should be somewhere to step into that does not hit you").
//
// His circle smash draws a solid disc round his feet and a band at its rim with open ground
// between them. That open ring is now a real refuge: anyone standing in it is missed, and
// the sim tests it with the SAME fractions the renderer draws it with
// (src/sim/boss_ring_gap.ts), so the edge a player sees is the edge the blast uses. His
// other circles (the stomp, the hammer, the Barrowfall) are drawn solid and hit in full,
// so no telegraph of his ever shows a gap it does not honour.
//
// NOTHING HERE IS GODDED: dealDamage skips a GM target silently, which would make every
// "was not hit" assertion pass for the wrong reason. The subject is topped up instead.
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000 });

import { BARROW_SMASH_GAP, insideRingGap, ringGapBands } from '../src/sim/boss_ring_gap';
import { MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const BALGATH = 'balgath_cyclops';
const LAIR = { x: 147, z: 310 };

interface Internals {
  spawnDevBoss(t: string, x: number, z: number): number;
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  e.onGround = true;
}

const pulse = () => {
  const p = MOBS[BALGATH]?.aoePulse;
  if (!p) throw new Error('Balgath has no Barrow Smash');
  return p;
};

/**
 * Force a Barrow Smash and hold the player `distance` yards from the ring's snapshot centre
 * (east of it) until it lands. Returns whether the smash hit them and the ring event.
 */
function smashAt(distance: number) {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.setPlayerLevel(20);
  const id = (sim as unknown as Internals).spawnDevBoss(BALGATH, LAIR.x, LAIR.z);
  const boss = sim.entities.get(id) as Entity;
  place(sim, boss, LAIR.x, LAIR.z);
  boss.slumberRise = 0;
  const me = sim.player;
  place(sim, me, LAIR.x + 6, LAIR.z);
  sim.drainEvents();
  sim.chat('/dev balgath smash', me.id);
  const events: SimEvent[] = [...sim.drainEvents()];
  const ring = events.find(
    (e) =>
      e.type === 'spellfxAt' &&
      e.fx === 'runeCircle' &&
      (e as { ability?: string }).ability === 'mob_pulse_windup',
  ) as Extract<SimEvent, { type: 'spellfxAt' }> | undefined;
  if (!ring) throw new Error('no Barrow Smash ring');
  let hit = false;
  let landed = false;
  for (let i = 0; i < 20 * 3 && !landed; i++) {
    place(sim, me, ring.x + distance, ring.z);
    me.hp = me.maxHp;
    for (const e of sim.tick()) {
      if (e.type === 'damage' && e.targetId === me.id && e.ability === pulse().name) hit = true;
      if (
        e.type === 'spellfxAt' &&
        e.fx === 'nova' &&
        e.sourceId === id &&
        e.radius === pulse().radius
      )
        landed = true;
    }
  }
  expect(landed, 'the smash never landed').toBe(true);
  return { hit, ring, launched: me.vy > 3 };
}

describe('the ring gap geometry', () => {
  it('is open ground strictly between the inner disc and the outer band', () => {
    const r = 12;
    const { inner, outer } = BARROW_SMASH_GAP;
    expect(inner).toBeGreaterThan(0);
    expect(outer).toBeGreaterThan(inner);
    expect(outer).toBeLessThan(1);
    expect(insideRingGap(0, r, BARROW_SMASH_GAP)).toBe(false);
    expect(insideRingGap(inner * r, r, BARROW_SMASH_GAP)).toBe(false);
    expect(insideRingGap(inner * r + 0.01, r, BARROW_SMASH_GAP)).toBe(true);
    expect(insideRingGap(outer * r - 0.01, r, BARROW_SMASH_GAP)).toBe(true);
    expect(insideRingGap(outer * r, r, BARROW_SMASH_GAP)).toBe(false);
    expect(insideRingGap(r, r, BARROW_SMASH_GAP)).toBe(false);
  });

  it('hands the renderer exactly the bands the blast uses', () => {
    expect(ringGapBands(12, BARROW_SMASH_GAP)).toEqual({
      disc: 12 * BARROW_SMASH_GAP.inner,
      bandIn: 12 * BARROW_SMASH_GAP.outer,
      bandOut: 12,
    });
    expect(ringGapBands(7, null)).toEqual({ disc: 7, bandIn: 7, bandOut: 7 });
  });

  it('is wide enough to stand in at his size, and declared on the Barrow Smash only', () => {
    const p = pulse();
    expect(p.safeGap).toEqual(BARROW_SMASH_GAP);
    const width = (BARROW_SMASH_GAP.outer - BARROW_SMASH_GAP.inner) * p.radius;
    expect(width, 'a gap a body cannot fit in is not a refuge').toBeGreaterThan(3);
    // The inner disc keeps a real footprint: hugging his shins is not the answer either.
    expect(BARROW_SMASH_GAP.inner * p.radius).toBeGreaterThan(4);
  });
});

describe('Barrow Smash in a live fight', () => {
  it('names its ring for the renderer, so his own layer draws the gap', () => {
    const { ring } = smashAt(BARROW_SMASH_GAP.inner * pulse().radius - 1);
    expect(ring.sourceId).toBeDefined();
    expect(ring.radius).toBe(pulse().radius);
  });

  it('spares a player standing in the gap: no damage, no punt', () => {
    const mid = ((BARROW_SMASH_GAP.inner + BARROW_SMASH_GAP.outer) / 2) * pulse().radius;
    const r = smashAt(mid);
    expect(r.hit, 'the gap is not safe').toBe(false);
    expect(r.launched, 'a dodged smash still threw them').toBe(false);
  });

  it('still hits the inner disc and the outer band', () => {
    expect(smashAt(BARROW_SMASH_GAP.inner * pulse().radius - 1).hit, 'inner disc').toBe(true);
    expect(smashAt(BARROW_SMASH_GAP.outer * pulse().radius + 1).hit, 'outer band').toBe(true);
  });
});
