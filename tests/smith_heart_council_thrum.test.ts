// Stone Thrum (encounters/smith_heart/council_risen_pulse.ts; the owner's
// review of 2026-11-09): every pillar Wake the Stone raised that still stands
// rings on the WHOLE raid every 2 s, per pillar, on every tier; the carved
// columns never ring, the cursed pillar keeps its own pulse, the Guardian's
// inherited rises ring too, and a kicked Wake raises nothing so adds nothing.
// Over REAL Sim claims.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  COUNCIL_FX_COLORS,
  CURSED_COLORS,
  councilClaims,
} from '../src/render/smith_heart_fx/council_fx_core';
import {
  STONE_THRUM_COLOR,
  STONE_THRUM_LOOK,
  STONE_THRUM_SECONDS,
  stoneThrumRadius,
} from '../src/render/smith_heart_fx/council_thrum_core';
import { EngineParticles } from '../src/render/trash_engine_fx/engine_particles';
import { HAMMER_PIT, QUARRY_PILLAR_SPOTS } from '../src/sim/content/smith_heart_layout';
import {
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_DIFFICULTY,
  COUNCIL_NAMES,
  type CouncilFightState,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { raisePillar } from '../src/sim/encounters/smith_heart/council_pillars';
import { thrummingPillars } from '../src/sim/encounters/smith_heart/council_risen_pulse';
import type { Entity, SimEvent } from '../src/sim/types';
import { type CouncilFight, councilFight, hitsOf } from './helpers/council_fight';

const MID = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };

function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.songDue = null;
  st.energy = 0;
}

function pulled(n: number, tier?: 'heroic' | 'mythic'): CouncilFight & { st: CouncilFightState } {
  const f = councilFight(n, 17);
  f.dev('/dev heart council pull');
  f.tick();
  if (tier) expect(f.dev(`/dev heart council ${tier} on`)).toBe(true);
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  quiet(st);
  return Object.assign(f, { st });
}

/** Raise `count` risen pillars on a ring 16 yd round the middle (clear of
 *  the columns and of each other), no player in their throw. */
function raise(f: CouncilFight, count: number): void {
  const g = f.bodies().guardian as Entity;
  let placed = 0;
  for (let k = 0; k < 72 && placed < count; k++) {
    const a = (k / 24) * Math.PI * 2;
    const r = [16, 10, 22][Math.floor(k / 24)];
    const p = raisePillar(
      f.sim.ctx,
      f.inst,
      g,
      [g],
      [],
      MID.x + Math.sin(a) * r,
      MID.z + Math.cos(a) * r,
      1,
    );
    if (p) placed++;
  }
  expect(placed).toBe(count);
}

/** The next ring, from now: the events up to and including it. */
function ring(f: CouncilFight & { st: CouncilFightState }): SimEvent[] {
  return f.tick(Math.ceil(f.st.risenPulseTimer * 20) + 1);
}

const thrumCues = (ev: readonly SimEvent[]) =>
  ev.filter((e) => e.type === 'spellfx' && e.ability === COUNCIL_CUES.risenPulse);

describe('Stone Thrum: risen pillars ring on the whole raid', () => {
  it('the rows: Normal about 15, Heroic about 25 after its factor, Mythic at least Heroic', () => {
    const n = COUNCIL_DIFFICULTY.normal;
    const h = COUNCIL_DIFFICULTY.heroic;
    const m = COUNCIL_DIFFICULTY.mythic;
    expect([n.risenPulseMin, n.risenPulseMax]).toEqual([14, 16]);
    expect(h.risenPulseMin * h.damageMult).toBeCloseTo(23.75);
    expect(h.risenPulseMax * h.damageMult).toBeCloseTo(26.25);
    expect(m.risenPulseMin * m.damageMult).toBeGreaterThanOrEqual(h.risenPulseMin * h.damageMult);
    expect(T.risenPulseEvery).toBe(2);
  });

  it('the five carved columns never ring', () => {
    const f = pulled(4);
    expect(f.pillars().filter((p) => !p.risen).length).toBe(QUARRY_PILLAR_SPOTS.length);
    expect(thrummingPillars(f.pillars())).toEqual([]);
    const ev = f.tick(20 * 7);
    expect(hitsOf(ev, COUNCIL_NAMES.risenPulse)).toEqual([]);
    expect(thrumCues(ev)).toEqual([]);
  });

  it('normal: one risen pillar rings 14 to 16 on every player, every 2 s', () => {
    const f = pulled(4);
    raise(f, 1);
    ring(f);
    const ev = f.tick(20 * T.risenPulseEvery);
    for (const p of f.players) {
      const hits = hitsOf(ev, COUNCIL_NAMES.risenPulse, p.id);
      expect(hits.length, p.name).toBe(1);
      expect(hits[0]).toBeGreaterThanOrEqual(14);
      expect(hits[0]).toBeLessThanOrEqual(16);
    }
    expect(thrumCues(ev).length).toBe(1);
  });

  it('per pillar: four risen pillars ring four times as hard, one cue on each', () => {
    const f = pulled(4);
    // The cap counts the carved columns too (seven standing): the first
    // Wrath has taken them by the time the risen ones stack up.
    for (const p of f.pillars()) if (!p.risen) f.sim.ctx.dropEntity(p.e.id);
    f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
    raise(f, 4);
    const ev = ring(f);
    for (const p of f.players) {
      const hits = hitsOf(ev, COUNCIL_NAMES.risenPulse, p.id);
      expect(hits.length).toBe(1);
      expect(hits[0]).toBeGreaterThanOrEqual(14 * 4);
      expect(hits[0]).toBeLessThanOrEqual(16 * 4);
    }
    const cued = new Set(thrumCues(ev).map((e) => (e as { sourceId: number }).sourceId));
    const risen = f.pillars().filter((p) => p.risen);
    expect(cued).toEqual(new Set(risen.map((p) => p.e.id)));
  });

  it('heroic: about 25 a pillar (its row times the tier factor)', () => {
    const f = pulled(4, 'heroic');
    raise(f, 2);
    const ev = ring(f);
    const h = COUNCIL_DIFFICULTY.heroic;
    for (const p of f.players) {
      const [hit] = hitsOf(ev, COUNCIL_NAMES.risenPulse, p.id);
      expect(hit).toBeGreaterThanOrEqual(Math.floor(h.risenPulseMin * h.damageMult * 2));
      expect(hit).toBeLessThanOrEqual(Math.ceil(h.risenPulseMax * h.damageMult * 2));
    }
  });

  it("the cursed pillar keeps its own pulse, never Stone Thrum's", () => {
    const f = pulled(4);
    expect(f.dev('/dev heart council rush')).toBe(true);
    f.tick(2);
    const cursed = f.pillars().filter((p) => p.cursed);
    expect(cursed.length).toBe(1);
    expect(thrummingPillars(f.pillars())).toEqual([]);
  });

  it('a pillar the Wrath breaks rings no more', () => {
    const f = pulled(4);
    raise(f, 2);
    ring(f);
    expect(f.dev('/dev heart council wrath')).toBe(true);
    f.tick(Math.ceil(T.wrathCast * 20) + 2);
    expect(f.pillars().filter((p) => p.risen)).toEqual([]);
    const ev = f.tick(20 * 5);
    expect(hitsOf(ev, COUNCIL_NAMES.risenPulse)).toEqual([]);
  });

  it('a Wake let through rings; a kicked one raises nothing and so adds nothing', () => {
    // Let through.
    const f = pulled(4);
    expect(f.dev('/dev heart council wake')).toBe(true);
    f.tick(Math.ceil((T.wakeCast + T.wakeMarkSeconds + 0.4) * 20));
    const risen = f.pillars().filter((p) => p.risen).length;
    expect(risen).toBe(COUNCIL_DIFFICULTY.normal.wakeMarks);
    const ev = ring(f);
    const [hit] = hitsOf(ev, COUNCIL_NAMES.risenPulse, f.players[0].id);
    expect(hit).toBeGreaterThanOrEqual(14 * risen);
    // Kicked.
    const k = pulled(4);
    expect(k.dev('/dev heart council wake')).toBe(true);
    const c = k.bodies().singer as Entity;
    expect(c.castingAbility).toBe(COUNCIL_CASTS.wake);
    k.tick(10);
    k.sim.ctx.cancelCast(c);
    const after = k.tick(20 * (T.wakeMarkSeconds + 4));
    expect(k.pillars().some((p) => p.risen)).toBe(false);
    expect(hitsOf(after, COUNCIL_NAMES.risenPulse)).toEqual([]);
  });

  it('mythic: a risen pillar a soul takes keeps ringing (the soul takes nothing away)', () => {
    const f = pulled(4, 'mythic');
    for (const p of f.pillars()) if (!p.risen) f.sim.ctx.dropEntity(p.e.id);
    f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
    raise(f, 1);
    expect(f.dev('/dev heart council soul singer')).toBe(true);
    const souls = f.pillars().filter((p) => p.soul !== null);
    expect(souls.length).toBe(1);
    expect(souls[0].risen).toBe(true);
    expect(thrummingPillars(f.pillars()).map((p) => p.e.id)).toEqual([souls[0].e.id]);
    const ev = ring(f);
    expect(hitsOf(ev, COUNCIL_NAMES.risenPulse, f.players[0].id).length).toBe(1);
  });

  it("the Guardian's inherited rises ring too (the Singer fallen first costs the raid)", () => {
    const f = pulled(4);
    f.sim.ctx.handleDeath(f.bodies().singer as Entity, f.players[0]);
    f.tick();
    quiet(f.st);
    expect(f.dev('/dev heart council wake')).toBe(true);
    expect(f.st.riseSpots.length).toBeGreaterThan(0);
    f.tick(Math.ceil((COUNCIL_DIFFICULTY.normal.heirRiseWarn + 0.2) * 20));
    const risen = f.pillars().filter((p) => p.risen);
    expect(risen.length).toBeGreaterThan(0);
    const ev = ring(f);
    const hits = hitsOf(ev, COUNCIL_NAMES.risenPulse);
    expect(hits.length).toBe(f.players.filter((p) => !p.dead).length);
    // The Guardian rings them now, Memory of Stone in.
    for (const h of hits) expect(h).toBeGreaterThanOrEqual(14 * risen.length);
    expect(thrumCues(ev).length).toBe(risen.length);
  });

  it('never on the beat of Restless Stone (heroic): its clock is a second off', () => {
    const f = pulled(4, 'heroic');
    expect(f.st.risenPulseTimer).toBeLessThan(T.pulseEvery);
    // Pulled a tick ago: Stone Thrum's first ring a second in, Restless
    // Stone's at 2 s, both every 2 s after.
    expect(T.risenPulseEvery).toBe(T.pulseEvery);
    // (the heroic switch came a tick after the pull: within a tick or two)
    expect(
      Math.abs(
        Math.abs(f.st.pulseTimer - f.st.risenPulseTimer) - (T.pulseEvery - T.risenPulseFirst),
      ),
    ).toBeLessThanOrEqual(0.15);
  });
});

describe("Stone Thrum's ripple", () => {
  it('rolls well past the pillar, gone before the next ring, in its own colour', () => {
    expect(stoneThrumRadius(T.risenR)).toBeGreaterThan(T.risenR + T.pulseReach);
    expect(STONE_THRUM_SECONDS).toBeLessThan(T.risenPulseEvery);
    expect(STONE_THRUM_LOOK.strength).toBeGreaterThan(0);
    for (const other of [COUNCIL_FX_COLORS.danger, CURSED_COLORS.hex, COUNCIL_FX_COLORS.resonance])
      expect(STONE_THRUM_COLOR).not.toBe(other);
    expect(councilClaims(COUNCIL_CUES.risenPulse)).toBe(true);
  });

  it('every ring of a full Quarry stays lit on the low tier, a burst on top evicting the oldest', () => {
    const p = new EngineParticles(
      new THREE.Group(),
      { value: 0 },
      0.4,
      () => 0,
      () => 0.5,
      () => true,
      null,
    );
    // An older ring from a moment before (the oldest), then seven pillars
    // ring at once, then a three-ring burst lands on the same tick.
    p.update(0);
    for (let i = 0; i < 4; i++) p.shockRing(i, 0, 0xffffff, 3, 0.75);
    p.update(0.5);
    for (let i = 0; i < 7; i++)
      p.shockRing(
        i * 3,
        9,
        STONE_THRUM_COLOR,
        stoneThrumRadius(T.risenR),
        STONE_THRUM_SECONDS,
        STONE_THRUM_LOOK,
      );
    for (let i = 0; i < 5; i++) p.shockRing(0, 20, 0xff0000, 6, 0.6);
    p.update(0.6);
    // 4 + 7 + 5 = 16 asked of 14 slots: the two oldest gave way, never a thrum.
    expect(p.liveRings()).toBe(14);
    p.update(0.5 + STONE_THRUM_SECONDS - 0.05);
    // The burst (0.6 s) and the old rings (0.75 s) are gone: exactly the
    // seven thrum rings still live, none of them was evicted.
    expect(p.liveRings()).toBe(7);
  });
});
