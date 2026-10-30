// The wandering blades over a REAL Sim claim: from the awakening the four glide
// round the lake on one loop, slowly on Normal and Heroic and fast on Mythic; an
// echo fires from where its blade is when it lands and the safe spot moves with it;
// a passing blade knocks aside; the ice behind it is thin; a blade held for a
// crossing waits; a wipe sends them home.

import { describe, expect, it } from 'vitest';
import { QUENCH_BLADE_SPOTS } from '../src/sim/content/smith_heart_layout';
import {
  onThinIce,
  QUENCH_DIFFICULTY,
  QUENCH_NAMES,
  routeLength,
  routePoint,
  routeProject,
  routeStart,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { hitsOf } from './helpers/council_fight';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s * 20);

function awake(tier?: 'heroic' | 'mythic'): QuenchFight {
  const f = quenchFight(3, 31);
  f.dev('/dev heart quench pull');
  f.tick(ticks(T.rimRise) + 2);
  if (tier) expect(f.dev(`/dev heart quench ${tier} on`)).toBe(true);
  expect(f.dev('/dev heart quench wake')).toBe(true);
  f.tick(ticks(T.wakeCast) + 2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.breathTimer = 999;
  st.danceTimer = 999;
  return f;
}

describe('Guardian of the Quench: the wandering blades', () => {
  it('the speeds: slow on Normal and Heroic, fast on Mythic', () => {
    expect(QUENCH_DIFFICULTY.normal.wanderSpeed).toBe(QUENCH_DIFFICULTY.heroic.wanderSpeed);
    expect(QUENCH_DIFFICULTY.mythic.wanderSpeed).toBeGreaterThan(
      QUENCH_DIFFICULTY.heroic.wanderSpeed * 2,
    );
  });

  it('the route: a closed loop through every home, walked by distance', () => {
    const L = routeLength();
    QUENCH_BLADE_SPOTS.forEach((sp, i) => {
      const p = routePoint(routeStart(i));
      expect(p.x).toBeCloseTo(sp.x);
      expect(p.z).toBeCloseTo(sp.z);
    });
    const a = routePoint(0);
    const b = routePoint(L);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
    const c = routePoint(L * 0.37);
    const back = routePoint(routeProject(c));
    expect(back.x).toBeCloseTo(c.x);
    expect(back.z).toBeCloseTo(c.z);
  });

  for (const tier of [undefined, 'mythic'] as const) {
    it(`${tier ?? 'normal'}: the blades glide at their speed, and only after waking`, () => {
      const f = awake(tier);
      const st = f.state();
      if (!st) throw new Error('no fight');
      const from = st.blades.map((b) => b.s);
      f.tick(20);
      const speed = QUENCH_DIFFICULTY[tier ?? 'normal'].wanderSpeed;
      st.blades.forEach((b, i) => {
        expect(b.s - from[i]).toBeCloseTo(speed, 1);
        const e = f.sim.ctx.entities.get(b.objectId);
        if (!e) throw new Error('no blade');
        const w = f.world(b.x, b.z);
        expect(e.pos.x).toBeCloseTo(w.x);
        expect(e.pos.z).toBeCloseTo(w.z);
      });
    });
  }

  it('do not move before the awakening', () => {
    const f = quenchFight(3, 31);
    f.dev('/dev heart quench pull');
    f.tick();
    const st = f.state();
    if (!st) throw new Error('no fight');
    const from = st.blades.map((b) => b.s);
    f.tick(40);
    st.blades.forEach((b, i) => {
      expect(b.s).toBe(from[i]);
    });
  });

  it('an echo follows its blade until it lands', () => {
    const f = awake();
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart quench strike');
    f.tick(2);
    const ec = st.echoes[0];
    expect(ec).toBeDefined();
    const blade = st.blades[ec.blade];
    f.tick(10);
    expect(ec.x).toBeCloseTo(blade.x);
    expect(ec.z).toBeCloseTo(blade.z);
  });

  it('a passing blade strikes, adds cold and knocks aside, once per gap', () => {
    const f = awake();
    const st = f.state();
    if (!st) throw new Error('no fight');
    const [p] = f.players;
    const b = st.blades[0];
    const ahead = routePoint(b.s + 1);
    f.put(p, ahead.x, ahead.z);
    const before = { x: p.pos.x, z: p.pos.z };
    const ev = f.tick(1);
    expect(hitsOf(ev, QUENCH_NAMES.blade, p.id).length).toBe(1);
    expect(Math.hypot(p.pos.x - before.x, p.pos.z - before.z)).toBeGreaterThan(0.1);
    f.put(p, routePoint(b.s + 1).x, routePoint(b.s + 1).z);
    expect(hitsOf(f.tick(1), QUENCH_NAMES.blade, p.id)).toEqual([]);
  });

  it('the ice just behind a blade is thin, ahead of it is not', () => {
    const s = routeStart(0) + 20;
    const blade = { ...routePoint(s), s };
    const behind = routePoint(s - T.thinIceLen / 2);
    const ahead = routePoint(s + T.thinIceLen / 2);
    expect(onThinIce([blade], behind.x, behind.z)).toBe(true);
    expect(onThinIce([blade], ahead.x, ahead.z)).toBe(false);
  });

  it('a huddle on the thin ice strains it twice as fast', () => {
    const f = awake();
    const st = f.state();
    if (!st) throw new Error('no fight');
    const b = st.blades[0];
    const trail = routePoint(b.s - 4);
    for (const p of f.players) f.put(p, trail.x, trail.z);
    f.tick(1);
    f.tick(1);
    const sp = st.strain[0];
    expect(sp).toBeDefined();
    const t0 = sp.t;
    for (const p of f.players) f.put(p, trail.x, trail.z);
    f.tick(1);
    expect(sp.t - t0).toBeCloseTo((2 * 1) / 20, 5);
  });

  it('heroic: a blade held for a crossing waits, then swaps its place on the loop', () => {
    const f = awake('heroic');
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart quench cross');
    const d = st.dance;
    if (!d) throw new Error('no crossing');
    const sa = st.blades[d.a].s;
    const sb = st.blades[d.b].s;
    f.tick(ticks(T.danceWarn - 0.1));
    expect(st.blades[d.a].s).toBe(sa);
    f.tick(ticks(0.1 + T.danceFly + 0.05));
    expect(st.blades[d.a].s).toBeCloseTo(sb, 0);
    expect(st.blades[d.b].s).toBeCloseTo(sa, 0);
  });

  it('a reset sends them home', () => {
    const f = awake();
    f.tick(40);
    f.dev('/dev heart quench reset');
    const fresh = f.objects('sh_quench_blade_');
    expect(fresh.length).toBe(4);
    for (const e of fresh) {
      const hit = QUENCH_BLADE_SPOTS.some((sp) => {
        const w = f.world(sp.x, sp.z);
        return Math.hypot(e.pos.x - w.x, e.pos.z - w.z) < 1e-3;
      });
      expect(hit).toBe(true);
    }
  });
});
