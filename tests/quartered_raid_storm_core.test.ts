// The storm round the raid isle as plain numbers (src/render/quartered_raid_storm_core.ts):
// where its cloud cards hang, where its bolts strike, and how often the lightning flashes.
import { describe, expect, it } from 'vitest';
import {
  ISLE_MODELS,
  isleWorldPoint,
  planFloatingIsles,
} from '../src/render/quartered_floating_debris_core';
import {
  axisAt,
  axisLean,
  BACK_DEPTH,
  BACK_PUFFS,
  BASE_BAND,
  BASE_PUFFS,
  BASE_RADIUS,
  BOLT_MAX_SLANT,
  BOLT_MIN_DROP,
  BOLT_POINTS,
  CAP_LIFT,
  CAP_PUFFS,
  FLANK_BAND,
  FLANK_NEAR,
  FORK_POINTS,
  makeBackToFront,
  planStrike,
  puffPosition,
  RIM_BAND,
  RIM_PUFFS,
  RIM_RADIUS,
  ribbonIndices,
  ribbonInto,
  STORM_TEXTURE_SIZE,
  STRIKE_GAP_MAX,
  STRIKE_GAP_MIN,
  STRIKE_KEEP_CLEAR,
  STRIKE_LENGTH,
  StrikeClock,
  stormIsleOf,
  stormPuffs,
  stormPuffTexels,
  stormReach,
  strikeAt,
  strikeLight,
  TIP_BAND,
  TIP_PUFFS,
  TIP_RADIUS,
} from '../src/render/quartered_raid_storm_core';
import { terrainHeight } from '../src/sim/world';

const raid = planFloatingIsles((x, z) => terrainHeight(x, z, 20061)).isles.find(
  (i) => i.model === 'raid',
);
if (!raid) throw new Error('no raid isle in the plan');
const isle = stormIsleOf(raid, (i) => isleWorldPoint(i, [0, ISLE_MODELS[i.model].h, 0]));
const height = isle.top.y - isle.tip.y;
const puffs = stormPuffs(isle);
const at = { x: 0, y: 0, z: 0 };
const TIMES = [0, 7.5, 33, 121, 600];

describe('the storm round the raid isle', () => {
  it('follows the isle: its axis runs from the hanging tip to the top, which leans to the Gyre', () => {
    expect(isle.tip).toEqual({ x: raid.x, y: raid.y, z: raid.z });
    expect(height).toBeGreaterThan(100);
    // the raid isle leans its top south (toward the crown)
    expect(isle.top.z).toBeLessThan(isle.tip.z - 20);
    const mid = axisAt(isle, 0.5);
    expect(mid.y).toBeCloseTo((isle.tip.y + isle.top.y) / 2, 9);
  });

  // A ring card's place on its circle square to the isle's leaning axis.
  const lean = axisLean(isle);
  const ringCheck = (
    layer: 'tip' | 'base' | 'rim',
    count: number,
    band: readonly [number, number],
    radius: readonly [number, number],
  ) => {
    const ring = puffs.filter((p) => p.layer === layer);
    expect(ring).toHaveLength(count);
    for (const p of ring) {
      expect(p.y).toBeGreaterThanOrEqual(height * band[0] - 1e-9);
      expect(p.y).toBeLessThanOrEqual(height * band[1] + 1e-9);
      for (const t of TIMES) {
        puffPosition(isle, p, t, at);
        const axis = axisAt(isle, p.y / height);
        const dx = at.x - axis.x;
        const dz = at.z - axis.z;
        const r = Math.hypot(dx, dz);
        expect(r).toBeGreaterThanOrEqual(isle.width * radius[0] - 1e-6);
        expect(r).toBeLessThanOrEqual(isle.width * radius[1] + 1e-6);
        // on the circle square to the axis, give or take the slow bob
        const onRing = isle.tip.y + p.y - (lean.x * dx + lean.z * dz);
        expect(Math.abs(at.y - onRing)).toBeLessThanOrEqual(p.bob + 1e-9);
      }
    }
    return ring;
  };

  it('wraps the bottom: a tight ring round the hanging tip and a cloud sea round the spike', () => {
    ringCheck('tip', TIP_PUFFS, TIP_BAND, TIP_RADIUS);
    const base = ringCheck('base', BASE_PUFFS, BASE_BAND, BASE_RADIUS);
    // it wheels: a base card is somewhere else a minute on
    const a = puffPosition(isle, base[0], 0, { x: 0, y: 0, z: 0 });
    const b = puffPosition(isle, base[0], 60, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(20);
  });

  it('wraps the top: a rim ring curls round the cliff edge, under the fortress floor at the front', () => {
    const rim = ringCheck('rim', RIM_PUFFS, RIM_BAND, RIM_RADIUS);
    // the rings tilt with the isle: the front of a ring (toward the Gyre)
    // hangs lower than its back
    expect(lean.z).toBeLessThan(-0.1);
    // a rim card in front of the axis keeps its middle under the top's plane
    // (the floor the keep and towers stand on), so it wisps round the cliff
    // edge and never across the walls
    const floorAt = (x: number, z: number) =>
      isle.top.y - (lean.x * (x - isle.top.x) + lean.z * (z - isle.top.z));
    let fronts = 0;
    for (const p of rim) {
      for (const t of TIMES) {
        puffPosition(isle, p, t, at);
        if (at.z >= axisAt(isle, p.y / height).z) continue;
        fronts++;
        expect(at.y).toBeLessThan(floorAt(at.x, at.z));
      }
    }
    expect(fronts).toBeGreaterThan(rim.length);
    // and it turns the other way from the rings below it
    const r0 = rim[0];
    const c0 = axisAt(isle, r0.y / height);
    const p0 = puffPosition(isle, r0, 0, { x: 0, y: 0, z: 0 });
    const p1 = puffPosition(isle, r0, 5, { x: 0, y: 0, z: 0 });
    const turn = Math.atan2(p1.z - c0.z, p1.x - c0.x) - Math.atan2(p0.z - c0.z, p0.x - c0.x);
    expect(Math.sin(turn)).toBeLessThan(0);
  });

  it('hangs its wall and its thunderhead behind the fortress, never in front of it', () => {
    const back = puffs.filter((p) => p.layer === 'back');
    const cap = puffs.filter((p) => p.layer === 'cap');
    expect(back).toHaveLength(BACK_PUFFS);
    expect(cap).toHaveLength(CAP_PUFFS);
    for (const p of [...back, ...cap]) {
      for (const t of TIMES) {
        puffPosition(isle, p, t, at);
        const axis = axisAt(isle, Math.min(1, p.y / height));
        // farther from the Gyre (higher z) than the isle's own axis at its height
        expect(at.z).toBeGreaterThan(axis.z);
      }
    }
    for (const p of back) expect(p.angle).toBeGreaterThanOrEqual(isle.width * BACK_DEPTH[0] - 1e-9);
    // the thunderhead sits at the top, wrapping down round the towers by no
    // more than its lowest lift, wide across the view
    for (const p of cap) {
      expect(p.y).toBeGreaterThanOrEqual(height + isle.width * CAP_LIFT[0] - 1e-9);
      expect(p.y).toBeLessThanOrEqual(height + isle.width * CAP_LIFT[1] + 1e-9);
    }
    const xs = cap.map((p) => p.radius);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(isle.width);
    // every card has a tone, so the mass is never one flat grey
    expect(new Set(puffs.map((p) => p.shade.toFixed(3))).size).toBeGreaterThan(puffs.length / 2);
  });

  it('draws its cards farthest from the Gyre first', () => {
    const zs = [5, 40, -3, 40.5, 12];
    const sort = makeBackToFront(zs);
    expect(sort([])).toEqual([3, 1, 4, 0, 2]);
    // the sorter reads the live array: a card that moves re-sorts next frame
    zs[2] = 99;
    expect(sort([7, 7, 7])).toEqual([2, 3, 1, 4, 0]);
  });

  // The clouds as they hang at time t, indexed like `puffs`.
  const cloudsAt = (t: number) => {
    const xs = new Float64Array(puffs.length);
    const ys = new Float64Array(puffs.length);
    const zs = new Float64Array(puffs.length);
    for (let i = 0; i < puffs.length; i++) {
      puffPosition(isle, puffs[i], t, at);
      xs[i] = at.x;
      ys[i] = at.y;
      zs[i] = at.z;
    }
    return { xs, ys, zs };
  };
  const floorAt = (x: number, z: number) =>
    isle.top.y - (lean.x * (x - isle.top.x) + lean.z * (z - isle.top.z));

  it('strikes down out of one real cloud, onto the towers or past a flank, never sideways', () => {
    const hits = { isle: 0, flank: 0 };
    for (let n = 0; n < 240; n++) {
      const t = n * 4.7;
      const { xs, ys, zs } = cloudsAt(t);
      const plan = planStrike(isle, puffs, xs, ys, zs, n);
      const s0 = plan.source;
      const start = plan.main[0];
      const end = plan.main[plan.main.length - 1];
      expect(plan.main).toHaveLength(BOLT_POINTS);
      expect(plan.fork).toHaveLength(FORK_POINTS);
      // out of the source cloud as it hangs now: under its centre, in its card
      expect(start[0]).toBeCloseTo(xs[s0], 6);
      expect(start[2]).toBeCloseTo(zs[s0], 6);
      expect(Math.abs(start[1] - ys[s0])).toBeLessThan(puffs[s0].h);
      // a high cloud, never the low rings round the spike; the start is in
      // its belly (never lifted into clear sky)
      expect(['cap', 'rim', 'back']).toContain(puffs[s0].layer);
      expect(start[1]).toBeCloseTo(ys[s0] - puffs[s0].h * 0.12, 6);
      // always DOWN: every point lower than the last, a real drop, and never
      // slanting more than a lightning's lean
      const drop = start[1] - end[1];
      expect(drop).toBeGreaterThanOrEqual(BOLT_MIN_DROP - 1e-6);
      expect(Math.abs(end[0] - start[0])).toBeLessThanOrEqual(BOLT_MAX_SLANT * drop + 1e-6);
      for (let k = 1; k < plan.main.length; k++) {
        expect(plan.main[k][1]).toBeLessThan(plan.main[k - 1][1]);
      }
      // the fork leaves the main path and runs down too
      expect(
        plan.main.some((p) => p === plan.fork[0] || p.every((c, j) => c === plan.fork[0][j])),
      ).toBe(true);
      expect(plan.fork[plan.fork.length - 1][1]).toBeLessThan(plan.fork[0][1]);
      hits[plan.hits]++;
      if (plan.hits === 'isle') {
        // out of the thunderhead onto the plaza before the keep: over the top's
        // front, ending at (or, from a low cloud, on down into) its floor
        expect(puffs[s0].layer).toBe('cap');
        // from off to the keep's side, so the anvil keep never hides it
        expect(Math.abs(start[0] - isle.top.x)).toBeGreaterThanOrEqual(
          isle.width * STRIKE_KEEP_CLEAR - 1e-6,
        );
        expect(Math.abs(end[0] - isle.top.x)).toBeLessThanOrEqual(isle.width * 0.34 + 1e-6);
        expect(end[2]).toBeLessThan(isle.top.z - isle.width * 0.17);
        expect(end[1]).toBeLessThan(floorAt(end[0], end[2]) + height * 0.05);
      } else {
        // past a flank, just beside the cliffs (never out where a flanking
        // islet hangs in the view), into the storm sea below
        const out = Math.abs(start[0] - isle.top.x);
        expect(out).toBeGreaterThanOrEqual(isle.width * FLANK_BAND[0] - 1e-6);
        expect(out).toBeLessThanOrEqual(isle.width * FLANK_BAND[1] + 1e-6);
        // a cloud clearly on the isle's near side, toward the crown, so the
        // isle never hides its light or its bolt
        const f = Math.min(1, Math.max(0, (ys[s0] - isle.tip.y) / height));
        expect(zs[s0]).toBeLessThan(axisAt(isle, f).z - isle.width * FLANK_NEAR + 1e-6);
        expect(Math.abs(end[0] - isle.top.x)).toBeGreaterThan(isle.width * 0.36);
        expect(Math.abs(end[0] - isle.top.x)).toBeLessThan(isle.width * 0.62);
        expect(end[1]).toBeGreaterThan(isle.tip.y + height * 0.19);
        expect(end[1]).toBeLessThan(isle.tip.y + height * 0.39);
      }
    }
    // a mix, most of them onto the isle
    expect(hits.isle).toBeGreaterThan(240 * 0.45);
    expect(hits.flank).toBeGreaterThan(240 * 0.15);
  });

  it('lights only the struck cloud and its two nearest, never the whole storm', () => {
    for (let n = 0; n < 60; n++) {
      const { xs, ys, zs } = cloudsAt(n * 3.3);
      const plan = planStrike(isle, puffs, xs, ys, zs, n);
      expect(plan.glow).toHaveLength(3);
      expect(plan.glow[0]).toBe(plan.source);
      const d = (i: number) =>
        Math.hypot(xs[i] - xs[plan.source], ys[i] - ys[plan.source], zs[i] - zs[plan.source]);
      const others = puffs.map((_, i) => i).filter((i) => i !== plan.source);
      others.sort((a, b) => d(a) - d(b));
      expect(d(plan.glow[1])).toBeCloseTo(d(others[0]), 9);
      expect(d(plan.glow[2])).toBeCloseTo(d(others[1]), 9);
    }
  });

  it('flashes every couple of seconds, never more than two flashes in a second', () => {
    let prev = strikeAt(0);
    for (let n = 1; n < 200; n++) {
      const start = strikeAt(n);
      expect(start - prev).toBeGreaterThanOrEqual(STRIKE_GAP_MIN - 1e-9);
      expect(start - prev).toBeLessThanOrEqual(STRIKE_GAP_MAX + 1e-9);
      prev = start;
    }
    // a strike's light: in 0..1, dark outside its window
    for (let tau = -0.2; tau < 1; tau += 0.005) {
      const light = strikeLight(tau);
      expect(light).toBeGreaterThanOrEqual(0);
      expect(light).toBeLessThanOrEqual(1);
      if (tau < 0 || tau >= STRIKE_LENGTH) expect(light).toBe(0);
    }
    // the photosensitive bound, over ten minutes at 200 samples a second: a flash
    // is a rise of a tenth of full light or more after a fall of as much (so a
    // strike's re-flicker counts as a flash of its own), and no one-second
    // window holds more than two
    const clock = new StrikeClock();
    const flashes: number[] = [];
    let armed = true;
    let trough = 0;
    let peak = 0;
    for (let k = 0; k < 600 * 200; k++) {
      const t = k / 200;
      const light = clock.at(t)?.light ?? 0;
      if (armed) {
        trough = Math.min(trough, light);
        if (light - trough >= 0.1) {
          flashes.push(t);
          armed = false;
          peak = light;
        }
      } else {
        peak = Math.max(peak, light);
        if (peak - light >= 0.1) {
          armed = true;
          trough = light;
        }
      }
    }
    let strikes = 0;
    while (strikeAt(strikes) < 600) strikes++;
    // every strike is seen as two flashes, its main one and its re-flicker
    expect(strikes).toBeGreaterThan(150);
    expect(flashes.length).toBeGreaterThanOrEqual(2 * strikes - 2);
    for (let i = 2; i < flashes.length; i++) {
      expect(flashes[i] - flashes[i - 2]).toBeGreaterThan(1);
    }
  });

  it('walks the same schedule with its clock as the schedule itself', () => {
    const clock = new StrikeClock();
    for (let n = 0; n < 40; n++) {
      const start = strikeAt(n);
      const lit = clock.at(start + 0.02);
      expect(lit?.n).toBe(n);
      expect(lit?.light).toBeCloseTo(strikeLight(0.02), 9);
      expect(clock.at(start + STRIKE_LENGTH + 0.01)).toBeNull();
    }
  });

  it('draws a soft storm card: dark belly, lit top, nothing at the card edge', () => {
    const size = STORM_TEXTURE_SIZE;
    const tex = stormPuffTexels(size);
    const px = (col: number, row: number) => (row * size + col) * 4;
    for (let k = 0; k < size; k++) {
      for (const o of [px(k, 0), px(k, size - 1), px(0, k), px(size - 1, k)])
        expect(tex[o + 3]).toBe(0);
    }
    // row 0 is the bottom: the lit top is brighter than the belly in the core
    const mid = size / 2;
    const belly = tex[px(mid, Math.floor(size * 0.36))];
    const crown = tex[px(mid, Math.floor(size * 0.7))];
    expect(crown).toBeGreaterThan(belly + 30);
    expect(tex[px(mid, Math.floor(size * 0.5)) + 3]).toBeGreaterThan(150);
  });

  it('builds a bolt ribbon two vertices a point, closed at every joint, following the path in z', () => {
    const pts: [number, number, number][] = [
      [0, 0, 5],
      [1, -2, 6],
      [3, -3, 7],
    ];
    const out = new Float32Array(3 * 2 * 3 + 6);
    expect(ribbonInto(pts, 1, out, 1)).toBe(1 + 3 * 2);
    // each pair straddles its point and keeps its z
    for (let k = 0; k < 3; k++) {
      const v = (1 + k * 2) * 3;
      expect((out[v] + out[v + 3]) / 2).toBeCloseTo(pts[k][0], 5);
      expect((out[v + 1] + out[v + 4]) / 2).toBeCloseTo(pts[k][1], 5);
      expect(out[v + 2]).toBe(pts[k][2]);
      expect(out[v + 5]).toBe(pts[k][2]);
    }
    const idx: number[] = [];
    ribbonIndices(3, 4, idx);
    expect(idx).toEqual([4, 5, 6, 5, 7, 6, 6, 7, 8, 7, 9, 8]);
  });

  it('stays inside its static culling sphere: every card at every time, every bolt', () => {
    // the clouds, the glow and the bolt all cull by this one sphere, so anything
    // reaching outside it would vanish with the storm still in view
    const reach = stormReach(isle);
    const overshoot = (x: number, y: number, z: number, pad: number) =>
      Math.hypot(x - reach.x, y - reach.y, z - reach.z) + pad - reach.radius;
    let worst = -Infinity;
    for (let t = 0; t < 600; t += 1.7) {
      for (const puff of puffs) {
        puffPosition(isle, puff, t, at);
        // the card's half diagonal, and half again for the glow's spill over it
        worst = Math.max(worst, overshoot(at.x, at.y, at.z, Math.hypot(puff.w, puff.h) * 0.75));
      }
    }
    for (let n = 0; n < 150; n++) {
      const { xs, ys, zs } = cloudsAt(strikeAt(n));
      const plan = planStrike(isle, puffs, xs, ys, zs, n);
      for (const p of [...plan.main, ...plan.fork]) {
        worst = Math.max(worst, overshoot(p[0], p[1], p[2], plan.width));
      }
    }
    expect(worst).toBeLessThanOrEqual(0);
  });

  it('is deterministic', () => {
    expect(stormPuffs(isle)).toEqual(puffs);
    const { xs, ys, zs } = cloudsAt(12);
    expect(planStrike(isle, puffs, xs, ys, zs, 7)).toEqual(planStrike(isle, puffs, xs, ys, zs, 7));
  });
});
