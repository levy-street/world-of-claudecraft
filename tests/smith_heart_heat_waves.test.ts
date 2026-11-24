// The Guardian of the Heat's lava waves over a REAL Sim claim (the overflows at 70
// and 40 percent since the rework of 2026-11-18, in place of the rivers): rings of
// lava out of the wellspring, each parting in two corridors; the next ring's
// corridors glowing before it leaves the lip, turning from the last; one strike per
// ring to whoever stands in its wall; the second overflow quicker and narrower; a
// short phase on every tier; heroic's Wellspawn walking all the while; deterministic;
// a wipe clears it. Plus the pure geometry and the templates.

import { describe, expect, it } from 'vitest';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import {
  gapOf,
  gapTemplate,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_LIP_WALL,
  HEAT_MOBS,
  HEAT_NAMES,
  HEAT_OBJECTS,
  inHearthFloor,
  inRingCorridor,
  inRingWall,
  RING_SWAY_MAX_DEG,
  RING_SWAY_MIN_DEG,
  ringGaps,
  ringOf,
  ringTemplate,
  HEAT_TUNING as T,
  WELLSPAWN_BEARING,
  WELLSPAWN_SPOTS,
  wavesSeconds,
  wellDistance,
} from '../src/sim/encounters/smith_heart';
import type { Entity, SimEvent } from '../src/sim/types';
import { hitsOf } from './helpers/council_fight';
import { type HeatFight, heatFight } from './helpers/heat_fight';

const ticks = (s: number) => Math.round(s * 20);
const DEG = Math.PI / 180;

/** Angular distance between two bearings (radians, 0..pi). */
function apart(a: number, b: number): number {
  const d = Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return d;
}

/** A fight held at 69 percent and pulled into its first overflow. */
function overflowing(tier: 'normal' | 'heroic' = 'normal', n = 3, seed = 31): HeatFight {
  const f = heatFight(n, seed);
  if (tier === 'heroic') f.dev('/dev heart heat heroic');
  f.dev('/dev heart heat pull');
  f.boss().threat.set(f.players[0].id, 1e6);
  f.tick(2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.fistTimer = 999;
  st.wheelTimer = 999;
  const b = f.boss();
  b.hp = Math.floor(b.maxHp * 0.69);
  f.tick(ticks(T.sinkSeconds) + 2);
  expect(st.stage).toBe('under');
  return f;
}

/** Tick `seconds`, every player kept whole, gathering the events. */
function run(f: HeatFight, seconds: number, each?: () => void): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks(seconds); i++) {
    each?.();
    out.push(...f.tick(1));
    for (const p of f.players) p.hp = p.maxHp;
  }
  return out;
}

const at = (bearing: number, r: number) => ({
  x: HEARTH_WELL.x + Math.sin(bearing) * r,
  z: HEARTH_WELL.z + Math.cos(bearing) * r,
});

describe('Guardian of the Heat: the lava waves (pure)', () => {
  it("each ring's corridors: on the Wellspawn's side, each swayed the other way from the last", () => {
    // The posts' mean bearing is due east of the well's middle, toward the door.
    expect(WELLSPAWN_BEARING).toBeCloseTo(Math.PI / 2, 9);
    for (const n of [1, 2]) {
      let prev: number[] | null = null;
      for (let k = 0; k < 8; k++) {
        const g = ringGaps(n, k, 2);
        expect(g.length).toBe(2);
        expect(apart(g[0], g[1])).toBeCloseTo(Math.PI, 9);
        for (const b of g) {
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThan(2 * Math.PI);
        }
        const q = ringGaps(n, k, 2, 90);
        // The pair's middle sways RING_SWAY_MIN_DEG to RING_SWAY_MAX_DEG off the side.
        const mid = q[0] + Math.PI / 4;
        const sway = apart(mid, WELLSPAWN_BEARING);
        expect(sway).toBeGreaterThanOrEqual(RING_SWAY_MIN_DEG * DEG - 1e-9);
        expect(sway).toBeLessThanOrEqual(RING_SWAY_MAX_DEG * DEG + 1e-9);
        if (prev) {
          // Still a dodge: 30 to 50 degrees round from the last ring's.
          const turn = apart(q[0], prev[0]);
          expect(turn).toBeGreaterThanOrEqual(2 * RING_SWAY_MIN_DEG * DEG - 1e-9);
          expect(turn).toBeLessThanOrEqual(2 * RING_SWAY_MAX_DEG * DEG + 1e-9);
        }
        prev = q;
      }
      expect(ringGaps(n, 3, 2)).toEqual(ringGaps(n, 3, 2));
    }
    // The two overflows do not repeat each other.
    expect(ringGaps(1, 0, 2, 90)).not.toEqual(ringGaps(2, 0, 2, 90));
  });

  it('from inside the corridors every walking Wellspawn is in ranged reach for most of its walk', () => {
    // Bot runs of 2026-11-24: the first overflow's corridors were hashed
    // anywhere round the well, so two children walked 30 to 50 yd from every
    // corridor (a ranged hitter reaches 29). Now every ring, on every tier with
    // Wellspawn, keeps each child within 29 yd of a corridor standing point for
    // at least 70 percent of its walk from its post to the lip.
    const REACH = 29;
    const tiers = (['normal', 'heroic', 'mythic'] as const).filter(
      (t) => HEAT_DIFFICULTY[t].overflowAdds,
    );
    expect(tiers.length).toBeGreaterThan(0);
    for (const tier of tiers) {
      HEAT_DIFFICULTY[tier].waves.forEach((rule, i) => {
        const n = i + 1;
        for (let k = 0; k < rule.count; k++) {
          const gaps = ringGaps(n, k, rule.gaps, rule.gapSpread);
          // The corridors' standing points: their lines from the lip wall out to the floor's edge.
          const stands: { x: number; z: number }[] = [];
          for (const g of gaps) {
            for (let r = HEAT_LIP_WALL.outer + 0.5; r < 60; r += 0.5) {
              const p = at(g, r);
              if (!inHearthFloor(p.x, p.z)) break;
              stands.push(p);
            }
            expect(stands.length, `${tier} ${n}/${k}`).toBeGreaterThan(40);
          }
          for (const spot of WELLSPAWN_SPOTS) {
            const d0 = wellDistance(spot.x, spot.z);
            const steps = 200;
            let near = 0;
            for (let j = 0; j <= steps; j++) {
              const d = d0 - ((d0 - T.spawnReach) * j) / steps;
              const w = {
                x: HEARTH_WELL.x + ((spot.x - HEARTH_WELL.x) * d) / d0,
                z: HEARTH_WELL.z + ((spot.z - HEARTH_WELL.z) * d) / d0,
              };
              if (stands.some((p) => Math.hypot(p.x - w.x, p.z - w.z) <= REACH)) near++;
            }
            expect(
              near / (steps + 1),
              `${tier} overflow ${n} ring ${k} post ${spot.x},${spot.z}`,
            ).toBeGreaterThanOrEqual(0.7);
          }
        }
      });
    }
  });

  it('every tier lays its two corridors a quarter turn apart (Jose, 2026-11-24)', () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      for (const rule of HEAT_DIFFICULTY[tier].waves) {
        expect(rule.gaps, tier).toBe(2);
        expect(rule.gapSpread, tier).toBe(90);
        for (let k = 0; k < 6; k++) {
          const g = ringGaps(1, k, rule.gaps, rule.gapSpread);
          expect(apart(g[0], g[1])).toBeCloseTo(Math.PI / 2, 9);
        }
      }
    }
  });

  it("the corridor and the wall: a ring strikes only within its wall's depth, outside a corridor", () => {
    const gaps = [0.6, 0.6 + Math.PI];
    const half = 4;
    const g = at(0.6, 20);
    expect(inRingCorridor(gaps, half, g.x, g.z)).toBe(true);
    const off = at(0.6 + Math.PI / 2, 20);
    expect(inRingCorridor(gaps, half, off.x, off.z)).toBe(false);
    // In the wall: the front just past them, never ahead of it or long gone.
    expect(inRingWall(gaps, half, 21, off.x, off.z)).toBe(true);
    expect(inRingWall(gaps, half, 19, off.x, off.z)).toBe(false);
    expect(inRingWall(gaps, half, 20 + T.ringDepth + 0.5, off.x, off.z)).toBe(false);
    // In the corridor, never.
    expect(inRingWall(gaps, half, 21, g.x, g.z)).toBe(false);
    // A corridor's edge is its half width either side of its line.
    const side = at(0.6, 20);
    const edge = {
      x: side.x + Math.cos(0.6) * (half - 0.1),
      z: side.z - Math.sin(0.6) * (half - 0.1),
    };
    expect(inRingCorridor(gaps, half, edge.x, edge.z)).toBe(true);
  });

  it('the templates read back', () => {
    const g = [10 * DEG, 190 * DEG];
    expect(ringTemplate(g)).toBe(`${HEAT_OBJECTS.ringPrefix}10_190`);
    const back = ringOf(ringTemplate(g));
    expect(back?.gaps.map((b) => Math.round(b / DEG))).toEqual([10, 190]);
    expect(ringOf(`${HEAT_OBJECTS.ringPrefix}400`)).toBeNull();
    expect(ringOf(`${HEAT_OBJECTS.ringPrefix}`)).toBeNull();
    expect(gapOf(gapTemplate(3.5))).toBe(3.5);
    expect(gapOf('sh_heat_zone_0_warn_40')).toBeNull();
  });

  it('every tier: a short overflow (20 to 25 s under), the second quicker and narrower', () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      const [one, two] = HEAT_DIFFICULTY[tier].waves;
      for (const w of [one, two]) {
        expect(wavesSeconds(w)).toBeGreaterThanOrEqual(20);
        expect(wavesSeconds(w)).toBeLessThanOrEqual(25);
        expect(w.gaps).toBeGreaterThanOrEqual(1);
        expect(w.gaps).toBeLessThanOrEqual(2);
      }
      expect(two.every).toBeLessThan(one.every);
      expect(two.speed).toBeGreaterThan(one.speed);
      expect(two.gapHalf).toBeLessThan(one.gapHalf);
    }
    // Normal slower, with wider corridors, than Heroic.
    const n = HEAT_DIFFICULTY.normal.waves;
    const h = HEAT_DIFFICULTY.heroic.waves;
    for (const i of [0, 1]) {
      expect(n[i].speed).toBeLessThan(h[i].speed);
      expect(n[i].gapHalf).toBeGreaterThan(h[i].gapHalf);
      expect(n[i].every).toBeGreaterThan(h[i].every);
    }
    // A ring rolls out past the Hearth's farthest wall.
    for (const [x, z] of [
      [-174, -22],
      [-200, -46],
      [-256, -16],
    ])
      expect(wellDistance(x, z)).toBeLessThan(T.ringEnd);
  });
});

describe('Guardian of the Heat: the lava waves (the fight)', () => {
  it("the first ring's corridors glow as the guardian goes under, then it leaves the lip", () => {
    const f = overflowing();
    const st = f.state();
    const o = st?.overflow;
    if (!o?.next) throw new Error('no overflow');
    const rule = HEAT_DIFFICULTY.normal.waves[0];
    const warn = f.objects(HEAT_OBJECTS.gapPrefix);
    expect(warn.length).toBe(rule.gaps);
    expect(warn.map((e) => e.facing).sort()).toEqual([...o.next.gaps].sort());
    for (const e of warn) {
      expect(e.scale).toBe(rule.gapHalf);
      expect(gapOf(e.templateId)).toBe(rule.lead);
    }
    expect(f.objects(HEAT_OBJECTS.ringPrefix)).toEqual([]);
    const gaps = [...o.next.gaps];
    const ev = run(f, rule.lead + 0.1);
    expect(ev.filter((e) => (e as { ability?: string }).ability === HEAT_CUES.ring).length).toBe(1);
    const rings = f.objects(HEAT_OBJECTS.ringPrefix);
    expect(rings.length).toBe(1);
    expect(ringOf(rings[0].templateId)?.gaps.map((g) => Math.round(g / DEG))).toEqual(
      gaps.map((g) => Math.round(g / DEG) % 360),
    );
    expect(rings[0].scale).toBe(rule.gapHalf);
    // The next ring's corridors already glow, turned from this one's.
    const next = f.objects(HEAT_OBJECTS.gapPrefix);
    expect(next.length).toBe(rule.gaps);
    expect(gapOf(next[0].templateId)).toBe(rule.every);
    expect(apart(next[0].facing, gaps[0])).toBeGreaterThan(30 * DEG);
  });

  it('a ring rolls out at its speed on its corridor line, then goes past the walls', () => {
    const f = overflowing();
    const rule = HEAT_DIFFICULTY.normal.waves[0];
    run(f, rule.lead + 0.05);
    const [ring] = f.objects(HEAT_OBJECTS.ringPrefix);
    const d0 = wellDistance(f.local(ring).x, f.local(ring).z);
    run(f, 1);
    const d1 = wellDistance(f.local(ring).x, f.local(ring).z);
    expect(d1 - d0).toBeCloseTo(rule.speed, 0);
    // Its object stands on its first corridor's line.
    const g = ringOf(ring.templateId)?.gaps[0] ?? 0;
    const l = f.local(ring);
    expect(Math.atan2(l.x - HEARTH_WELL.x, l.z - HEARTH_WELL.z)).toBeCloseTo(
      g > Math.PI ? g - 2 * Math.PI : g,
      1,
    );
    run(f, (T.ringEnd - d1) / rule.speed + 0.2);
    expect(f.sim.ctx.entities.has(ring.id)).toBe(false);
  });

  it('strikes once a ring whoever stands in its wall, and the raid that walks the corridors takes nothing', () => {
    const f = overflowing('normal', 3);
    const st = f.state();
    const o = st?.overflow;
    if (!o) throw new Error('no overflow');
    const [, walker, stayer] = f.players;
    // The walker always stands in the current ring's corridor (the next one's
    // once the ring's whole wall has passed it), 15 yd out; the stayer never
    // moves.
    const r = 15;
    f.put(stayer, at(1, r).x, at(1, r).z);
    const ev = run(f, wavesSeconds(HEAT_DIFFICULTY.normal.waves[0]) + 0.5, () => {
      const rolling = o.rings.find((x) => x.front - T.ringDepth < r + 0.6);
      const gaps = rolling ? rolling.gaps : o.next?.gaps;
      if (gaps) f.put(walker, at(gaps[0], r).x, at(gaps[0], r).z);
    });
    expect(hitsOf(ev, HEAT_NAMES.overflow, walker.id)).toEqual([]);
    const struck = hitsOf(ev, HEAT_NAMES.overflow, stayer.id);
    // Every ring whose corridors missed the stayer struck them, each once.
    expect(struck.length).toBeGreaterThanOrEqual(1);
    expect(struck.length).toBeLessThanOrEqual(HEAT_DIFFICULTY.normal.waves[0].count);
    expect(st?.overflow?.launched ?? 0).toBe(HEAT_DIFFICULTY.normal.waves[0].count);
  });

  it('the second overflow runs its own quicker rings', () => {
    const f = heatFight(2, 31);
    f.dev('/dev heart heat pull');
    f.boss().threat.set(f.players[0].id, 1e6);
    f.dev('/dev heart heat phase 2');
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.fistTimer = 999;
    st.wheelTimer = 999;
    st.zoneTimer = 999;
    st.seedTimer = 999;
    const b = f.boss();
    b.hp = Math.floor(b.maxHp * 0.39);
    run(f, T.sinkSeconds + 0.2);
    expect(st.overflow?.n).toBe(2);
    const rule = HEAT_DIFFICULTY.normal.waves[1];
    expect(f.objects(HEAT_OBJECTS.gapPrefix)[0].scale).toBe(rule.gapHalf);
    run(f, wavesSeconds(rule) - 0.3);
    expect(st.stage).toBe('under');
    run(f, 0.6);
    expect(st.stage).toBe('rising');
    expect(st.overflow?.launched).toBe(rule.count);
    run(f, T.riseSeconds + 0.2);
    expect(st.phase).toBe(3);
  });

  it('heroic: the Wellspawn walk to the wellspring while the rings roll', () => {
    const f = overflowing('heroic', 3);
    const kids = f.inst.mobIds
      .map((id) => f.sim.ctx.entities.get(id))
      .filter((e): e is Entity => !!e && e.templateId === HEAT_MOBS.spawn && !e.dead);
    expect(kids.length).toBe(4);
    const d = (e: Entity) => wellDistance(f.local(e).x, f.local(e).z);
    const before = kids.map(d);
    const rule = HEAT_DIFFICULTY.heroic.waves[0];
    run(f, rule.lead + 1);
    expect(f.objects(HEAT_OBJECTS.ringPrefix).length).toBe(1);
    for (let i = 0; i < kids.length; i++) expect(d(kids[i])).toBeLessThan(before[i] - 3);
  });

  it('is deterministic: the same seed lays the same corridors in the same order', () => {
    const seen = (seed: number) => {
      const f = overflowing('normal', 2, seed);
      const out: string[] = [];
      run(f, 12, () => {
        for (const e of f.objects(HEAT_OBJECTS.ringPrefix)) out.push(e.templateId);
      });
      return [...new Set(out)];
    };
    expect(seen(31)).toEqual(seen(31));
    expect(seen(31).length).toBeGreaterThanOrEqual(2);
  });

  it('Hearthseeds still on the floor go out as the guardian sinks', () => {
    const f = heatFight(3, 31);
    f.dev('/dev heart heat pull');
    f.boss().threat.set(f.players[0].id, 1e6);
    f.dev('/dev heart heat phase 2');
    f.dev('/dev heart heat seeds');
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.seeds.length).toBeGreaterThan(0);
    f.dev('/dev heart heat overflow');
    expect(st.seeds).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.seedPrefix)).toEqual([]);
    expect(st.stage).toBe('sinking');
  });

  it('a wipe clears every ring and corridor', () => {
    const f = overflowing();
    run(f, HEAT_DIFFICULTY.normal.waves[0].lead + 1);
    expect(f.objects(HEAT_OBJECTS.ringPrefix).length).toBe(1);
    expect(f.objects(HEAT_OBJECTS.gapPrefix).length).toBeGreaterThan(0);
    f.dev('/dev heart heat reset');
    expect(f.objects(HEAT_OBJECTS.ringPrefix)).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.gapPrefix)).toEqual([]);
  });
});
