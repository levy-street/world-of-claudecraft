// The Quartered Isle: the strip's new north end over the old north bay. What
// these tests pin is the land promise (one walkable island fused to the Reach
// by the Hoarbridge, with real walk-in crossings into both columns), the two
// owner asks (Rivalmoot stands on a hill; the King of the Hill has a dedicated,
// level arena at the hill's foot), and that registering the isle moved no
// shipped border pass.

import { describe, expect, it } from 'vitest';
import { computeBorderEdges } from '../src/sim/border_edges';
import {
  QUARTERED_ISLE_PROPS,
  QUARTERED_ISLE_ROADS,
  QUARTERED_ISLE_ZONE,
} from '../src/sim/content/quartered_isle';
import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  ZONES,
  zoneAt,
  zoneContaining,
} from '../src/sim/data';
import { pickHillSpot, spawnHillNow } from '../src/sim/pvp/hill';
import { HILL_RADIUS, hillSpotIsOpen } from '../src/sim/pvp/hill_rules';
import { HILL_ZONE_IDS } from '../src/sim/pvp/hill_zones';
import { CHALLENGERS_RING, RIVALMOOT_HILL } from '../src/sim/quartered_isle_terrain';
import {
  CINDERSCAR_GLASSFIELD,
  FIREICE_RIFT,
  GYRE_PEAK,
  gyrePathPoint,
  HAMMERS_CUT_CANYON,
  quarteredLandmarkClears,
  RIMEGLASS_TARN,
} from '../src/sim/quartered_landmarks';
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
    // wider than the strip: it claims the columns' inner 70yd beside it
    expect(QUARTERED_ISLE_ZONE.xMin).toBe(-250);
    expect(QUARTERED_ISLE_ZONE.xMax).toBe(250);
    expect(QUARTERED_ISLE_ZONE.claimsOverlap).toBe(true);
    expect(QUARTERED_ISLE_ZONE.zMin).toBe(1960);
    expect(QUARTERED_ISLE_ZONE.zMax).toBe(2420);
    expect(STRIP_ZONES.at(-1)?.id).toBe('quartered_isle');
    expect(ZONES.at(-1)?.id).toBe('quartered_isle'); // appended last: rng order
    expect(zoneAt(0, 2235).id).toBe('quartered_isle');
    expect(zoneAt(0, 1900).id).toBe('frostveil');
    expect(zoneAt(360, 2200).id).toBe('drakelands');
    expect(zoneAt(-360, 2200).id).toBe('amberfall');
    // the claimed flanks are the isle's, both lookups agreeing; the columns
    // keep everything past x +-250 and their ground south of the isle
    for (const x of [215, -215, 249, -249]) {
      expect(zoneAt(x, 2200).id, `zoneAt ${x}`).toBe('quartered_isle');
      expect(zoneContaining(x, 2200)?.id, `zoneContaining ${x}`).toBe('quartered_isle');
    }
    expect(zoneAt(251, 2200).id).toBe('drakelands');
    expect(zoneAt(-251, 2200).id).toBe('amberfall');
    expect(zoneAt(215, 1900).id).toBe('drakelands');
    expect(zoneAt(-215, 1900).id).toBe('amberfall');
    expect(zoneBiomeAt(0, 2235)).toBe('quartered');
  });

  it('opens one pass per shared edge, each inside its span', () => {
    const edges = computeBorderEdges(ZONES);
    const south = edges.find((e) => e.kind === 'h' && e.at === 1960 && e.lo === STRIP_MIN_X);
    expect(south?.passAt).toBe(QUARTERED_ISLE_ZONE.southPassX);
    // the side crossings stand on the claim's outline, inside their spans
    const east = edges.find((e) => e.kind === 'v' && e.at === 250 && e.lo === 1960);
    expect(east?.passAt).toBe(QUARTERED_ISLE_ZONE.eastPassZ);
    const west = edges.find((e) => e.kind === 'v' && e.at === -250 && e.lo === 1960);
    expect(west?.passAt).toBe(QUARTERED_ISLE_ZONE.westPassZ);
    // no edge runs along the old strip line beside the isle any more
    expect(edges.filter((e) => e.kind === 'v' && Math.abs(e.at) === 180 && e.hi > 1960)).toEqual(
      [],
    );
    // every edge on the isle's south line is the strait: no ridge
    for (const e of edges.filter((e) => e.kind === 'h' && e.at === 1960)) {
      expect(e.water, `south edge ${e.lo}..${e.hi}`).toBe(true);
    }
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
        if (x < -252 || x > 252 || z < 1962 || z > 2420) continue;
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
    expect(reached(250, 2062), 'the Drakelands crossing').toBe(true);
    expect(reached(-250, 2244), 'the Amberfall crossing').toBe(true);
    // the landmarks' floors are reachable ground
    expect(reached(RIMEGLASS_TARN.x, RIMEGLASS_TARN.z), 'the Rimeglass').toBe(true);
    expect(reached(CINDERSCAR_GLASSFIELD.x, CINDERSCAR_GLASSFIELD.z), 'the Glassfield').toBe(true);
    expect(reached(HAMMERS_CUT_CANYON.main[2].x, HAMMERS_CUT_CANYON.main[2].z), 'the Cut').toBe(
      true,
    );
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
    // the crater's floor sits far below the plaza
    expect(top - h(CHALLENGERS_RING.x, CHALLENGERS_RING.z)).toBeGreaterThan(10);
  });

  it('stands open: no wall or gate pillars ring the town', () => {
    const near = (x: number, z: number) =>
      Math.hypot(x - RIVALMOOT_HILL.x, z - RIVALMOOT_HILL.z) < RIVALMOOT_HILL.footR;
    for (const f of QUARTERED_ISLE_PROPS.fences ?? []) {
      expect(near(f.x1, f.z1) || near(f.x2, f.z2), `fence ${f.x1},${f.z1}`).toBe(false);
    }
    for (const d of QUARTERED_ISLE_PROPS.decorProps ?? []) {
      expect(d.key === 'kcasWallPillar' && near(d.x, d.z), `pillar ${d.x},${d.z}`).toBe(false);
    }
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

  it('walks out of the crater up four long, gentle ramps cut through the rim', () => {
    const { x: cx, z: cz } = CHALLENGERS_RING;
    // the ramps run the whole rim, from the contest circle's edge out to the
    // rim's outer foot: twice the old floor-edge-to-crest run
    expect(CHALLENGERS_RING.rampFrom).toBe(HILL_RADIUS);
    expect(CHALLENGERS_RING.rampTo - CHALLENGERS_RING.rampFrom).toBeGreaterThanOrEqual(40);
    for (const bearing of CHALLENGERS_RING.ramps) {
      const b = (bearing * Math.PI) / 180;
      for (const off of [-5, 0, 5]) {
        const at = (d: number) => ({
          x: cx + Math.cos(b) * d - Math.sin(b) * off,
          z: cz + Math.sin(b) * d + Math.cos(b) * off,
        });
        let steepest = 0;
        const start = h(at(CHALLENGERS_RING.rampFrom).x, at(CHALLENGERS_RING.rampFrom).z);
        let prev = start;
        for (let d = CHALLENGERS_RING.rampFrom + 0.5; d <= CHALLENGERS_RING.rampTo; d += 0.5) {
          const p = at(d);
          const y = h(p.x, p.z);
          steepest = Math.max(steepest, Math.abs(y - prev) / 0.5);
          prev = y;
        }
        // about half the old ramps' pitch (0.74 to 1.07 at their steepest,
        // the north one climbing the town's rise): the climb itself averages
        // under 0.3, and no step, the land's own lumps included, passes 0.65
        const run = CHALLENGERS_RING.rampTo - CHALLENGERS_RING.rampFrom;
        expect(Math.abs(prev - start) / run, `ramp ${bearing} offset ${off}`).toBeLessThan(0.3);
        expect(steepest, `ramp ${bearing} offset ${off}`).toBeLessThan(0.65);
      }
      // a notch, not a climb over the crest: where it crosses the rim the
      // ramp runs well below the crest beside it
      const end = {
        x: cx + Math.cos(b) * CHALLENGERS_RING.rimR,
        z: cz + Math.sin(b) * CHALLENGERS_RING.rimR,
      };
      const beside = { x: end.x - Math.sin(b) * 16, z: end.z + Math.cos(b) * 16 };
      expect(h(beside.x, beside.z) - h(end.x, end.z), `notch ${bearing}`).toBeGreaterThan(2);
    }
    // between the ramps the crater's wall is still too steep to climb
    for (const bearing of [45, 135, 225, 315]) {
      const b = (bearing * Math.PI) / 180;
      let steepest = 0;
      for (let d = CHALLENGERS_RING.floorR; d < CHALLENGERS_RING.wallR; d += 0.5) {
        const y0 = h(cx + Math.cos(b) * d, cz + Math.sin(b) * d);
        const y1 = h(cx + Math.cos(b) * (d + 0.5), cz + Math.sin(b) * (d + 0.5));
        steepest = Math.max(steepest, Math.abs(y1 - y0) / 0.5);
      }
      expect(steepest, `wall at ${bearing}`).toBeGreaterThan(CLIMB);
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

describe('the landmarks', () => {
  it('winds a walkable path up the Gyre from the north road to the crown', () => {
    // the path IS the way up: walk it at one-yard steps, every step dry and
    // under the climb gate, starting where the north road ends
    const pts = [{ x: 0, z: 2262 }];
    for (let i = 0; i <= 400; i++) pts.push(gyrePathPoint(i / 400));
    walk(pts, 'the Gyre path');
    const top = gyrePathPoint(1);
    expect(h(top.x, top.z)).toBeCloseTo(GYRE_PEAK.baseY + GYRE_PEAK.rise, 5);
    expect(h(GYRE_PEAK.x, GYRE_PEAK.z)).toBeCloseTo(GYRE_PEAK.baseY + GYRE_PEAK.rise, 5);
  });

  it('walls the turns so the path cannot be short-cut straight up the peak', () => {
    // along every bearing, somewhere between the crown and the outermost turn
    // a face rises steeper than a player can climb
    for (let a = 0; a < 360; a += 3) {
      const th = (a * Math.PI) / 180;
      let steepest = 0;
      for (let r = GYRE_PEAK.endR; r < GYRE_PEAK.startR; r += 0.5) {
        const x0 = GYRE_PEAK.x + Math.cos(th) * r;
        const z0 = GYRE_PEAK.z + Math.sin(th) * r;
        const x1 = GYRE_PEAK.x + Math.cos(th) * (r + 0.5);
        const z1 = GYRE_PEAK.z + Math.sin(th) * (r + 0.5);
        steepest = Math.max(steepest, Math.abs(h(x0, z0) - h(x1, z1)) / 0.5);
      }
      expect(steepest, `bearing ${a}`).toBeGreaterThan(CLIMB);
    }
  });

  it('cuts the scars and keeps their beds dry, the causeway whole', () => {
    // the rift is deep away from the causeway (its thrown-up lips crest
    // either side of the bed) and whole on it
    const mid = FIREICE_RIFT.line[3];
    const next = FIREICE_RIFT.line[4];
    const len = Math.hypot(next.x - mid.x, next.z - mid.z);
    const nx = -(next.z - mid.z) / len;
    const nz = (next.x - mid.x) / len;
    for (const side of [-1, 1]) {
      const crest = Math.max(
        ...[6, 7, 8, 9, 10].map((o) => h(mid.x + nx * o * side, mid.z + nz * o * side)),
      );
      expect(crest - h(mid.x, mid.z), `lip side ${side}`).toBeGreaterThan(5);
    }
    expect(h(mid.x, mid.z)).toBeGreaterThan(WATER_LEVEL + 1);
    const c = FIREICE_RIFT.causeway;
    const around = [h(c.x - 4, c.z), h(c.x + 4, c.z), h(c.x, c.z - 4), h(c.x, c.z + 4)];
    expect(Math.max(...around) - Math.min(...around)).toBeLessThan(3);
    // the canyon's floor is lower than its rim along the whole main cut
    const m = HAMMERS_CUT_CANYON.main[2];
    // (the south rim: the blind branch opens north off this bend)
    expect(h(m.x, m.z - 16) - h(m.x, m.z)).toBeGreaterThan(5);
    expect(h(m.x, m.z)).toBeGreaterThan(WATER_LEVEL + 1);
    // the tarn's ice and the Glassfield are level
    for (const area of [RIMEGLASS_TARN, CINDERSCAR_GLASSFIELD]) {
      for (const [dx, dz] of [
        [0, 0],
        [area.r - 3, 0],
        [0, -(area.r - 3)],
      ]) {
        expect(h(area.x + dx, area.z + dz)).toBeCloseTo(area.y, 3);
      }
    }
  });

  it('keeps scatter off the path, the beds, the ice and the glass, and nowhere else', () => {
    expect(quarteredLandmarkClears(gyrePathPoint(0.5).x, gyrePathPoint(0.5).z)).toBe(true);
    expect(quarteredLandmarkClears(RIMEGLASS_TARN.x, RIMEGLASS_TARN.z)).toBe(true);
    expect(quarteredLandmarkClears(FIREICE_RIFT.line[3].x, FIREICE_RIFT.line[3].z)).toBe(true);
    expect(quarteredLandmarkClears(0, 2235)).toBe(false); // the town clears itself
    expect(quarteredLandmarkClears(0, 0)).toBe(false);
  });
});
