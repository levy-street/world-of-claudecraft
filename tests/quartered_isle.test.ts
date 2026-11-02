// The Quartered Isle: the strip's new north end over the old north bay. What
// these tests pin is the land promise (one walkable island fused to the Reach
// by the Hoarbridge, with real walk-in crossings into both columns), the two
// owner asks (Rivalmoot stands on a hill; the King of the Hill has a dedicated,
// level arena at the hill's foot), and that registering the isle moved no
// shipped border pass.

import { describe, expect, it } from 'vitest';
import { computeBorderEdges } from '../src/sim/border_edges';
import { QUARTERED_ISLE_ROADS, QUARTERED_ISLE_ZONE } from '../src/sim/content/quartered_isle';
import { STRIP_MAX_X, STRIP_MIN_X, STRIP_ZONES, ZONES, zoneAt } from '../src/sim/data';
import { pickHillSpot, spawnHillNow } from '../src/sim/pvp/hill';
import { HILL_RADIUS, hillSpotIsOpen } from '../src/sim/pvp/hill_rules';
import { HILL_ZONE_IDS } from '../src/sim/pvp/hill_zones';
import { CHALLENGERS_RING, RIVALMOOT_HILL } from '../src/sim/quartered_isle_terrain';
import { dominantQuarterAt, quarterWeightsAt } from '../src/sim/quartered_quarters';
import { Rng } from '../src/sim/rng';
import { Sim } from '../src/sim/sim';
import type { ZoneDef } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL, zoneBiomeAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
const h = (x: number, z: number) => terrainHeight(x, z, SEED);
const CLIMB = 1.5; // PLAYER_MAX_CLIMB_SLOPE

/** Walk a polyline at one-yard steps: every step dry and under the climb gate. */
function walk(points: readonly { x: number; z: number }[], label: string): void {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    let prev = h(a.x, a.z);
    for (let k = 1; k <= steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps;
      const z = a.z + ((b.z - a.z) * k) / steps;
      const here = h(x, z);
      const run = Math.hypot(b.x - a.x, b.z - a.z) / steps;
      const at = `${label} at ${x.toFixed(0)},${z.toFixed(0)}`;
      expect(here, at).toBeGreaterThan(WATER_LEVEL + 0.2);
      expect(Math.abs(here - prev) / run, at).toBeLessThan(CLIMB);
      prev = here;
    }
  }
}

describe('Quartered Isle zone registration', () => {
  it('is the strip zone north of the Frostveil, ending with the columns', () => {
    expect(QUARTERED_ISLE_ZONE.xMin).toBeUndefined();
    expect(QUARTERED_ISLE_ZONE.zMin).toBe(1960);
    expect(QUARTERED_ISLE_ZONE.zMax).toBe(2420);
    expect(STRIP_ZONES.at(-1)?.id).toBe('quartered_isle');
    expect(ZONES.at(-1)?.id).toBe('quartered_isle'); // appended last: rng order
    expect(zoneAt(0, 2235).id).toBe('quartered_isle');
    expect(zoneAt(0, 1900).id).toBe('frostveil');
    expect(zoneAt(360, 2200).id).toBe('drakelands');
    expect(zoneAt(-360, 2200).id).toBe('amberfall');
    expect(zoneBiomeAt(0, 2235)).toBe('quartered');
  });

  it('opens one pass per shared edge, each inside its span', () => {
    const edges = computeBorderEdges(ZONES);
    const south = edges.find((e) => e.kind === 'h' && e.at === 1960);
    expect(south?.passAt).toBe(QUARTERED_ISLE_ZONE.southPassX);
    const east = edges.find((e) => e.kind === 'v' && e.at === STRIP_MAX_X && e.lo === 1960);
    expect(east?.passAt).toBe(QUARTERED_ISLE_ZONE.eastPassZ);
    const west = edges.find((e) => e.kind === 'v' && e.at === STRIP_MIN_X && e.lo === 1960);
    expect(west?.passAt).toBe(QUARTERED_ISLE_ZONE.westPassZ);
  });

  it('moves no shipped border pass (the classic precedence still holds elsewhere)', () => {
    // the pre-isle rule, written out: west side first, then east, then the middle
    const before = ZONES.filter((z) => z.id !== 'quartered_isle');
    const overlaps = (z: ZoneDef, lo: number, hi: number) => z.zMin < hi && z.zMax > lo;
    const edges = computeBorderEdges(before);
    for (const e of edges) {
      if (e.kind !== 'v') continue;
      const a = before.find((z) => (z.xMax ?? STRIP_MAX_X) === e.at && overlaps(z, e.lo, e.hi));
      const b = before.find((z) => (z.xMin ?? STRIP_MIN_X) === e.at && overlaps(z, e.lo, e.hi));
      expect(a && b, `edge x=${e.at} z=${e.lo}`).toBeTruthy();
      if (!a || !b) continue;
      expect(e.passAt, `edge x=${e.at} z=${e.lo}`).toBe(
        b.westPassZ ?? a.eastPassZ ?? (e.lo + e.hi) / 2,
      );
    }
    // ...and the isle only adds edges: every pre-isle edge keeps its pass
    const withIsle = computeBorderEdges(ZONES);
    for (const e of edges) {
      const same = withIsle.find((w) => w.kind === e.kind && w.at === e.at && w.lo === e.lo);
      expect(same?.passAt, `edge ${e.kind} ${e.at} ${e.lo}`).toBe(e.passAt);
    }
  });
});

describe('the land', () => {
  it('keeps the hub, graveyard and every POI on dry, in-zone ground', () => {
    const { hub, graveyard, pois, lakes } = QUARTERED_ISLE_ZONE;
    for (const p of [hub, graveyard, ...pois]) {
      expect(zoneAt(p.x, p.z).id).toBe('quartered_isle');
      const onLake = lakes.some((l) => Math.hypot(p.x - l.x, p.z - l.z) <= l.radius + 4);
      if (onLake) continue;
      expect(h(p.x, p.z), `${p.x},${p.z}`).toBeGreaterThan(WATER_LEVEL + 0.5);
    }
  });

  it('every road is dry and climbable end to end, crossings included', () => {
    for (const [i, road] of QUARTERED_ISLE_ROADS.entries()) walk(road, `road ${i}`);
  });

  it('the Hoarbridge road starts in the Frostveil and lands on the isle', () => {
    // the whole crossing is a walked road (the dry-and-climbable walk above)
    const spur = QUARTERED_ISLE_ROADS[0];
    expect(zoneAt(spur[0].x, spur[0].z).id).toBe('frostveil');
    expect(zoneAt(spur.at(-1)!.x, spur.at(-1)!.z + 4).id).toBe('quartered_isle');
  });

  it('is one landmass: the bridge reaches the town, the ring, the Gyre and both crossings', () => {
    const step = 6;
    const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
    const dry = (x: number, z: number) => h(x, z) > WATER_LEVEL + 0.2;
    const start: [number, number] = [24, 1986];
    const seen = new Set([key(...start)]);
    const queue: [number, number][] = [start];
    while (queue.length > 0) {
      const cur = queue.shift();
      if (!cur) break;
      for (const [dx, dz] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const x = cur[0] + dx;
        const z = cur[1] + dz;
        if (x < -186 || x > 186 || z < 1962 || z > 2420) continue;
        const k = key(x, z);
        if (seen.has(k) || !dry(x, z)) continue;
        seen.add(k);
        queue.push([x, z]);
      }
    }
    const reached = (x: number, z: number) => seen.has(key(x, z));
    expect(reached(0, 2238), 'Rivalmoot').toBe(true);
    expect(reached(CHALLENGERS_RING.x, CHALLENGERS_RING.z), 'the ring').toBe(true);
    expect(reached(0, 2334), 'the Gyre').toBe(true);
    expect(reached(180, 2082), 'the Drakelands crossing').toBe(true);
    expect(reached(-180, 2274), 'the Amberfall crossing').toBe(true);
  });

  it('blends four quarters by position', () => {
    expect(dominantQuarterAt(0, 2040)).toBe('ice');
    expect(dominantQuarterAt(130, 2190)).toBe('fire');
    expect(dominantQuarterAt(-130, 2190)).toBe('earth');
    expect(dominantQuarterAt(0, 2360)).toBe('wind');
    const q = quarterWeightsAt(0, 2200);
    expect(q.ice + q.fire + q.earth + q.wind).toBeCloseTo(1, 9);
  });
});

describe('Rivalmoot on its hill', () => {
  it('stands on a level hilltop well above the land around it', () => {
    const { hub } = QUARTERED_ISLE_ZONE;
    expect(hub.x).toBe(RIVALMOOT_HILL.x);
    expect(hub.z).toBe(RIVALMOOT_HILL.z);
    const top = h(hub.x, hub.z);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = hub.x + Math.cos(ang) * hub.radius * 0.6;
      const z = hub.z + Math.sin(ang) * hub.radius * 0.6;
      expect(Math.abs(h(x, z) - top), `plaza at ${a}`).toBeLessThan(1.5);
    }
    // the foot of the hill and the ring floor sit far below the plaza
    expect(top - h(CHALLENGERS_RING.x, CHALLENGERS_RING.z)).toBeGreaterThan(12);
    expect(top - h(hub.x, hub.z - RIVALMOOT_HILL.footR - 10)).toBeGreaterThan(10);
  });
});

describe("the Challengers' Ring: the King of the Hill arena", () => {
  it('sits at the foot of the hill, clear of the town', () => {
    const { hub } = QUARTERED_ISLE_ZONE;
    expect(QUARTERED_ISLE_ZONE.hillArena).toEqual({ x: CHALLENGERS_RING.x, z: CHALLENGERS_RING.z });
    const d = Math.hypot(CHALLENGERS_RING.x - hub.x, CHALLENGERS_RING.z - hub.z);
    // the floor's edge meets the hill's foot: at the base, not on the slope
    expect(d).toBeGreaterThan(RIVALMOOT_HILL.footR + HILL_RADIUS - 20);
    expect(d).toBeLessThan(RIVALMOOT_HILL.footR + CHALLENGERS_RING.blendR);
  });

  it('is level ground under the whole hill circle', () => {
    const { x: cx, z: cz } = CHALLENGERS_RING;
    for (let r = 0; r <= HILL_RADIUS; r += 5) {
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const y = h(cx + Math.cos(ang) * r, cz + Math.sin(ang) * r);
        expect(Math.abs(y - CHALLENGERS_RING.floorY), `r ${r} a ${a}`).toBeLessThan(0.05);
      }
    }
  });

  it('the isle hosts hills, and every one rises in the ring', () => {
    expect(HILL_ZONE_IDS).toContain('quartered_isle');
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    // a legal spot by the same probe every random hill must pass
    expect(
      hillSpotIsOpen(
        sim.ctx.hillProbe,
        'quartered_isle',
        CHALLENGERS_RING.x,
        CHALLENGERS_RING.z,
        HILL_RADIUS,
      ),
    ).toBe(true);
    for (let seed = 1; seed <= 5; seed++) {
      expect(pickHillSpot(sim.ctx, new Rng(seed), QUARTERED_ISLE_ZONE)).toEqual({
        x: CHALLENGERS_RING.x,
        z: CHALLENGERS_RING.z,
      });
    }
    const hill = spawnHillNow(sim.ctx, 'quartered_isle', { warn: true });
    expect(hill).toMatchObject({
      zoneId: 'quartered_isle',
      x: CHALLENGERS_RING.x,
      z: CHALLENGERS_RING.z,
      radius: HILL_RADIUS,
    });
  });
});
