// The Smith's Heart renderer's pure cores (src/render/smith_heart): the
// mountain and the loose crags against the walked floor and the open air,
// the line of sight that never crosses from the main map into the Heart, the
// light-rivers' drape, the seal memory fed by the mirrored markers (veins and
// the portal), the seal's fill and the portal's opening and hop timelines,
// the Heart's chains, keels and core, the gate poses, the prop recipes, the
// light budget, and the one list of borrowed placeholder bodies.

import { afterEach, describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import { gateObjectPlan } from '../src/render/gate_objects';
import {
  HAMMER_CLIFF_COOL,
  HAMMER_CLIFF_FLOOR,
  HAMMER_CLIFF_WARM,
  hammerRiserShade,
  hammerRockBed,
  hammerRockLift,
} from '../src/render/smith_heart/heart_cliff_paint_core';
import {
  HEART_GATE_HEART_TINT,
  HEART_SEAL_BARRIER,
  heartGatePartPose,
  heartGateParts,
  heartGateRig,
  heartGateTint,
  heartGateVein,
  heartSealGatePose,
  heartSlabPose,
} from '../src/render/smith_heart/heart_gates_core';
import {
  HEART_MOUNTAIN_CHASM,
  HEART_MOUNTAIN_FOOT,
  heartHammerTerrace,
  heartMountainBlocks,
  heartMountainCellDrawn,
  heartMountainHeight,
  planHeartMountain,
} from '../src/render/smith_heart/heart_mountain_core';
import {
  HEART_CLEFT_BRAZIER,
  HEART_PALETTE,
  HEART_PROP_RECIPES,
  type HeartPart,
  heartLightZoneOf,
  heartPropBase,
  planHeartLights,
} from '../src/render/smith_heart/heart_plan_core';
import {
  HEART_HOP_SECONDS,
  HEART_PORTAL_OPEN,
  heartAreaBlend,
  heartHopLanding,
  heartHopStage,
  heartPortalMoteCount,
  heartPortalStage,
} from '../src/render/smith_heart/heart_portal_core';
import {
  HEART_RIVER_LIFT,
  HEART_RIVER_RUN_SECONDS,
  heartRiverLitSegments,
  planHeartRiver,
} from '../src/render/smith_heart/heart_rivers_core';
import {
  HEART_CORE,
  HEART_CORE_SHAFTS,
  heartChainLink,
  heartChains,
  heartEmberCount,
  heartKeelBottom,
  heartKeels,
} from '../src/render/smith_heart/heart_room_core';
import {
  clearHeartSealForTest,
  HEART_SEAL_ARRIVAL,
  HEART_SEAL_FILL_SECONDS,
  HEART_SEAL_QUARTERS,
  heartSealColumn,
  heartSealQuarterFill,
  heartSealQuarterLevel,
  heartSealSlotKey,
  heartSealView,
  isHeartSealMarker,
  observeHeartSealMarker,
} from '../src/render/smith_heart/heart_seal_core';
import {
  heartGateSolids,
  heartPropSolids,
  heartRingSolids,
  heartRockSolids,
  heartSightlineHits,
  heartWallSolids,
} from '../src/render/smith_heart/heart_sightline_core';
import {
  CORNICE_WALL_SCALE,
  HEART_ROCK_VARIANTS,
  HEART_ROOM_WALL_SCALE,
  HEART_WALL_CLEAR,
  heartFloorClearance,
  heartRockShape,
  heartWallReach,
  planHeartWalls,
} from '../src/render/smith_heart/heart_walls_core';
import { SMITH_HEART_GATES, SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import {
  BALCONY,
  BREATH,
  CLEFT,
  GALLERY_LANDINGS,
  GREAT_HEARTH,
  HAMMER_PIT,
  HEART_ALTARS,
  HEART_ARRIVAL,
  HEART_ROOM,
  HEART_ROOM_CHASM_R,
  HEART_SEAL,
  HEART_TERRACE,
  HEAT,
  inSmithHeartRoom,
  LIGHT_RIVERS,
  QUENCH,
  RING,
  RING_ARC,
  ringPoint,
  SEAL_DAIS,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEIN_COLORS,
  SMITH_HEART_VEINS,
  WIND_BRIDGE,
} from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';

const F = SMITH_HEART_FIELD;
const onFloor = (x: number, z: number) => authoredFieldSurfaceAt(F, x, z) !== null;
const floorAt = (x: number, z: number) => (onFloor(x, z) ? authoredFieldHeight(F, x, z) : null);

describe('heart_walls_core: the loose crags at the mountain foot', () => {
  for (const spacing of [5, 7]) {
    const blocks = planHeartWalls(spacing);
    it(`spacing ${spacing}: plenty of crags, every block 7+ yd from any walkable floor`, () => {
      expect(blocks.length).toBeGreaterThan(spacing === 5 ? 300 : 150);
      const bad: string[] = [];
      for (const b of blocks) {
        // The whole block, its lean included, then seven more yards.
        const outer = heartWallReach(b) + 7;
        const radii: number[] = [];
        for (let r = 0; r < outer; r += 1.5) radii.push(r);
        radii.push(outer);
        let hit = false;
        for (const r of radii) {
          for (let k = 0; k < 24 && !hit; k++) {
            const a = (k / 24) * Math.PI * 2;
            hit = onFloor(b.x + Math.sin(a) * r, b.z + Math.cos(a) * r);
          }
          if (hit) break;
        }
        if (hit) {
          bad.push(`(${b.x.toFixed(1)}, ${b.z.toFixed(1)}) reach ${heartWallReach(b).toFixed(2)}`);
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
    it(`spacing ${spacing}: the dais's chasm, the bridge's gulf, the hearth and the Heart's chasm stay open`, () => {
      for (const b of blocks) {
        const reach = heartWallReach(b);
        expect(Math.hypot(b.x - RING.x, b.z - RING.z) - reach).toBeGreaterThanOrEqual(RING.innerR);
        const mx = (WIND_BRIDGE.fromX + WIND_BRIDGE.toX) / 2;
        const mz = (WIND_BRIDGE.fromZ + WIND_BRIDGE.toZ) / 2;
        expect(Math.hypot(b.x - mx, b.z - mz)).toBeGreaterThan(18);
        expect(Math.hypot(b.x - HEART_ROOM.x, b.z - HEART_ROOM.z) - reach).toBeGreaterThanOrEqual(
          HEART_ROOM_CHASM_R,
        );
        const inHearth =
          Math.abs(b.z - GREAT_HEARTH.z) < GREAT_HEARTH.halfWidth &&
          Math.abs(b.x - GREAT_HEARTH.x) < 6;
        expect(inHearth, `(${b.x}, ${b.z})`).toBe(false);
      }
    });
  }
  it('reads as rock: varied shapes, leaning out, low by the walks', () => {
    const blocks = planHeartWalls(5);
    expect(new Set(blocks.map((b) => b.variant)).size).toBe(HEART_ROCK_VARIANTS);
    let leanOut = 0;
    let near = 0;
    let nearLow = 0;
    for (const b of blocks) {
      expect(b.rz).toBeLessThanOrEqual(b.rx);
      const c = heartFloorClearance(b.x, b.z);
      if (b.leanX * c.toX + b.leanZ * c.toZ < 0) leanOut++;
      if (c.d < 14) {
        near++;
        if (b.top - c.floor < 16) nearLow++;
      }
    }
    expect(leanOut / blocks.length).toBeGreaterThan(0.95);
    expect(near).toBeGreaterThan(50);
    expect(nearLow / near).toBeGreaterThan(0.9);
  });
  it('builds every rock shape within its unit frame, with a jagged top', () => {
    for (let v = 0; v < HEART_ROCK_VARIANTS; v++) {
      const tri = heartRockShape(v);
      expect(tri.length % 9).toBe(0);
      expect(tri.length / 9).toBeGreaterThan(12);
      let maxY = 0;
      for (let i = 0; i < tri.length; i += 3) {
        expect(Math.hypot(tri[i], tri[i + 2])).toBeLessThanOrEqual(1 + 1e-9);
        expect(tri[i + 1]).toBeGreaterThanOrEqual(0);
        expect(tri[i + 1]).toBeLessThanOrEqual(1 + 1e-9);
        maxY = Math.max(maxY, tri[i + 1]);
      }
      expect(maxY).toBeGreaterThan(0.85);
    }
  });
});

describe('the Hammer vein’s rock (phase 2D)', () => {
  it('climbs the fissure in ledges and sheer risers, never above the smooth slope', () => {
    for (const [x, z] of [
      [-142, -200],
      [-90, -190],
      [-180, -195],
    ]) {
      let prev = 0;
      let flat = 0;
      let steep = 0;
      const n = 240;
      for (let i = 1; i <= n; i++) {
        const back = i * 0.25;
        const t = heartHammerTerrace(back, x, z);
        expect(t).toBeLessThanOrEqual(back + 1e-9);
        expect(t).toBeGreaterThanOrEqual(prev - 1e-9);
        const slope = (t - prev) / 0.25;
        if (slope < 0.05) flat++;
        if (slope > 1.8) steep++;
        prev = t;
      }
      // Most of the run is ledge, and every step has its riser.
      expect(flat / n, `${x}, ${z}`).toBeGreaterThan(0.45);
      expect(steep, `${x}, ${z}`).toBeGreaterThan(8);
    }
    // Outside the vein the slope stays the shared smooth one.
    expect(hammerRockLift(0, 70)).toBe(0);
    expect(hammerRockLift(HAMMER_PIT.x, HAMMER_PIT.z)).toBe(1);
    expect(hammerRockLift(GALLERY_LANDINGS.h2.x, GALLERY_LANDINGS.h2.z)).toBe(1);
  });

  it('paints the vein’s rock a true mid granite, never near-black, its beds banded', () => {
    const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    // The darkest a Hammer cliff face gets (the lowest noise at its deepest).
    const darkest =
      Math.min(lum(HAMMER_CLIFF_COOL), lum(HAMMER_CLIFF_WARM)) * HAMMER_CLIFF_FLOOR * 0.78;
    expect(darkest).toBeGreaterThan(0.15);
    // The beds: a band's swing reads in full sun, never a blowout.
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < 120; y += 0.5) {
      const b = hammerRockBed(-120, y, -200);
      lo = Math.min(lo, b);
      hi = Math.max(hi, b);
    }
    expect(hi - lo).toBeGreaterThan(0.3);
    expect(lo).toBeGreaterThan(-0.45);
    expect(hi).toBeLessThan(0.3);
    // Risers shade darker than ledges, by at most a third.
    expect(hammerRiserShade(0.2)).toBe(0);
    expect(hammerRiserShade(5)).toBeGreaterThan(0.2);
    expect(hammerRiserShade(5)).toBeLessThanOrEqual(0.34);
  });
});

describe('heart_mountain_core: the mountain round every floor', () => {
  const grid = planHeartMountain(4);
  it('never stands within the clearance of a walkable floor above its foot', () => {
    const bad: string[] = [];
    for (let j = 0; j < grid.nz; j++)
      for (let i = 0; i < grid.nx; i++) {
        const x = grid.x0 + i * grid.cell;
        const z = grid.z0 + j * grid.cell;
        const h = grid.heights[j * grid.nx + i];
        if (h <= HEART_MOUNTAIN_CHASM) continue;
        // Any floor within the clearance: the rock there is under it.
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          for (const r of [0, 2, 4, HEART_WALL_CLEAR - 2.5]) {
            const f = floorAt(x + Math.sin(a) * r, z + Math.cos(a) * r);
            if (f !== null && h > f - 5.9) bad.push(`(${x}, ${z}) ${h.toFixed(1)} over ${f}`);
          }
        }
      }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it('keeps the open air open: the dais chasm, the hearth mouth, the Heart chasm', () => {
    for (let d = 0; d < 360; d += 15) {
      for (const r of [SEAL_DAIS.r + 4, 40, RING.innerR - 3]) {
        const p = ringPoint(d, r);
        expect(heartMountainHeight(p.x, p.z), `dais ${d} r ${r}`).toBe(HEART_MOUNTAIN_CHASM);
      }
      for (const r of [HEART_ROOM.r + 6, HEART_ROOM_CHASM_R - 4]) {
        const a = (d * Math.PI) / 180;
        const x = HEART_ROOM.x + Math.sin(a) * r;
        const z = HEART_ROOM.z + Math.cos(a) * r;
        expect(heartMountainHeight(x, z), `heart ${d} r ${r}`).toBe(HEART_MOUNTAIN_CHASM);
      }
    }
    expect(heartMountainHeight(GREAT_HEARTH.x, GREAT_HEARTH.z)).toBe(HEART_MOUNTAIN_CHASM);
  });
  it('climbs into real mountain: tall crowns, a low summit round the Cornice, the Heart deepest', () => {
    let tallest = -Infinity;
    for (let j = 0; j < grid.nz; j++)
      for (let i = 0; i < grid.nx; i++) tallest = Math.max(tallest, grid.heights[j * grid.nx + i]);
    expect(tallest).toBeGreaterThan(100);
    // Rise over the floor 30 yd past the clearance, beside each room.
    const rise = (x: number, z: number, floor: number) => heartMountainHeight(x, z) - floor;
    const pastClear = HEART_WALL_CLEAR + 30;
    const cornice = rise(BREATH.cornice.x, BREATH.cornice.z + BREATH.cornice.rz + pastClear, 60);
    const lake = rise(QUENCH.shelf.x + QUENCH.shelf.rx + pastClear, QUENCH.shelf.z, QUENCH.shelf.h);
    const heart = rise(HEART_ROOM.x + HEART_ROOM_CHASM_R + 30, HEART_ROOM.z, HEART_ROOM.h);
    expect(cornice).toBeGreaterThan(0);
    expect(cornice).toBeLessThan(lake * 0.75);
    expect(heart).toBeGreaterThan(lake);
    expect(CORNICE_WALL_SCALE).toBeLessThan(1);
    expect(HEART_ROOM_WALL_SCALE).toBeGreaterThan(1);
  });
  it('draws a cell wherever any corner carries rock, nothing over the bottomless chasm', () => {
    let drawn = 0;
    for (let j = 0; j < grid.nz - 1; j++)
      for (let i = 0; i < grid.nx - 1; i++) if (heartMountainCellDrawn(grid, i, j)) drawn++;
    expect(drawn).toBeGreaterThan(2000);
    // The middle of the Ring's chasm draws nothing.
    const i = Math.round((0 - grid.x0) / grid.cell);
    const j = Math.round((30 - grid.z0) / grid.cell);
    expect(heartMountainCellDrawn(grid, i, j)).toBe(false);
    expect(HEART_MOUNTAIN_FOOT).toBeLessThan(HEART_WALL_CLEAR);
  });
  it('lets no eye on the main map see into the Heart', () => {
    // Eyes on the main map's high and open places; targets on the Heart's
    // platform, terrace and the top of its core.
    const eyes = [
      { x: 0, z: 196 },
      { x: 40, z: 210 },
      { x: 198, z: 30 },
      { x: 230, z: -2 },
      { x: 60, z: 40 },
      { x: 0, z: 70 },
      { x: 0, z: -70 },
      { x: -112, z: 170 },
    ].map((p) => ({ ...p, y: authoredFieldHeight(F, p.x, p.z) + 2 }));
    const targets = [
      { x: HEART_ROOM.x, y: HEART_ROOM.h + 2, z: HEART_ROOM.z },
      { x: HEART_ROOM.x - 30, y: HEART_ROOM.h + 2, z: HEART_ROOM.z - 20 },
      { x: HEART_TERRACE.x, y: HEART_TERRACE.h + 2, z: HEART_TERRACE.z },
      { x: HEART_CORE.x, y: HEART_CORE.y + HEART_CORE.r, z: HEART_CORE.z },
    ];
    const seen: string[] = [];
    for (const e of eyes) {
      expect(inSmithHeartRoom(e.x, e.z)).toBe(false);
      for (const t of targets) {
        if (!heartMountainBlocks(e, t)) seen.push(`(${e.x}, ${e.z}) sees (${t.x}, ${t.z})`);
      }
    }
    expect(seen).toEqual([]);
    // The pin is not vacuous: inside the Heart the platform is in plain sight.
    expect(
      heartMountainBlocks(
        { x: HEART_ARRIVAL.x, y: HEART_TERRACE.h + 2, z: HEART_ARRIVAL.z },
        targets[0],
      ),
    ).toBe(false);
  });
});

describe('heart_rivers_core: the floor light-rivers', () => {
  for (const vein of SMITH_HEART_VEINS) {
    it(`${vein}: drapes from its arena to the seal, faces up, hugs the floor`, () => {
      const pts = LIGHT_RIVERS[vein];
      const strip = planHeartRiver(pts, floorAt);
      expect(strip.segments).toBe(strip.points.length - 1);
      expect(strip.indices.length).toBe(strip.segments * 6);
      const first = strip.points[0];
      const last = strip.points[strip.points.length - 1];
      expect(Math.hypot(first.x - pts[0].x, first.z - pts[0].z)).toBeLessThan(0.01);
      expect(
        Math.hypot(last.x - pts[pts.length - 1].x, last.z - pts[pts.length - 1].z),
      ).toBeLessThan(0.01);
      // It ends on the seal.
      expect(Math.hypot(last.x - HEART_SEAL.x, last.z - HEART_SEAL.z)).toBeLessThanOrEqual(
        HEART_SEAL.r,
      );
      const p = strip.positions;
      for (let t = 0; t < strip.indices.length; t += 3) {
        const [a, b, c] = [strip.indices[t], strip.indices[t + 1], strip.indices[t + 2]];
        const ux = p[b * 3] - p[a * 3];
        const uz = p[b * 3 + 2] - p[a * 3 + 2];
        const vx = p[c * 3] - p[a * 3];
        const vz = p[c * 3 + 2] - p[a * 3 + 2];
        expect(uz * vx - ux * vz).toBeGreaterThan(0);
      }
      for (const q of strip.points) {
        const h = floorAt(q.x, q.z);
        if (h === null) continue;
        expect(Math.abs(q.y - (h + HEART_RIVER_LIFT))).toBeLessThan(0.01);
      }
    });
  }
  it('the Hammer and the Breath run down their stairs; the other two leap the chasm onto the dais', () => {
    // The Hammer down the Grand Stair, the Breath down the North Stair: on
    // the floor all the way.
    for (const vein of ['hammer', 'breath'] as const) {
      const strip = planHeartRiver(LIGHT_RIVERS[vein], floorAt);
      expect(
        strip.points.every((q) => floorAt(q.x, q.z) !== null),
        vein,
      ).toBe(true);
    }
    for (const vein of ['quench', 'heat'] as const) {
      const strip = planHeartRiver(LIGHT_RIVERS[vein], floorAt);
      let bridged = 0;
      for (const { x, y, z } of strip.points) {
        if (floorAt(x, z) !== null) continue;
        bridged++;
        expect(y, vein).toBeGreaterThan(SEAL_DAIS.h);
        expect(y, vein).toBeLessThan(RING.h + 1);
      }
      expect(bridged, vein).toBeGreaterThan(5);
    }
  });
  it('the light runs arena to seal on its own clock, whole when met already lit', () => {
    expect(heartRiverLitSegments(-1, 100)).toBe(0);
    expect(heartRiverLitSegments(0, 100)).toBe(0);
    expect(heartRiverLitSegments(HEART_RIVER_RUN_SECONDS / 2, 100)).toBe(50);
    expect(heartRiverLitSegments(999, 100)).toBe(100);
  });
});

describe('heart_seal_core: the seal memory from the mirrored markers', () => {
  afterEach(() => clearHeartSealForTest());
  const def = DUNGEONS.smith_heart;
  const o = instanceOrigin(def.index, 2);
  const key = heartSealSlotKey(o.x, o.z);
  const marker = (mask: number, dungeonId: string | null = 'smith_heart') => ({
    templateId: `smith_heart_seal_${mask}`,
    dungeonId,
    pos: { x: o.x + 120, z: o.z - 20 },
  });

  it('recognizes only seal markers, and only of this raid', () => {
    expect(isHeartSealMarker('smith_heart_seal_5')).toBe(true);
    expect(isHeartSealMarker('smith_heart_seal_31')).toBe(true);
    expect(isHeartSealMarker('dungeon_gate_closed')).toBe(false);
    observeHeartSealMarker(marker(15, 'gravewyrm_sanctum'), 10);
    expect(heartSealView(key, 10).mask).toBe(0);
  });

  it('snaps a vein first seen lit, times a vein seen lighting, and starts over on a lost vein', () => {
    observeHeartSealMarker(marker(1), 10);
    let v = heartSealView(key, 10);
    expect(v.mask).toBe(1);
    expect(v.since[0]).toBeGreaterThan(100); // the Hammer, met already lit
    expect(v.since.slice(1)).toEqual([-1, -1, -1]);
    expect(v.portalSince).toBe(-1);
    observeHeartSealMarker(marker(1 | 8), 20);
    v = heartSealView(key, 23);
    expect(v.mask).toBe(9);
    expect(v.since[3]).toBeCloseTo(3); // the Heat lit three seconds ago
    observeHeartSealMarker(marker(0), 30);
    expect(heartSealView(key, 30).since).toEqual([-1, -1, -1, -1]);
  });

  it('times the portal opening, snaps a portal met open, and a lost portal is a fresh claim', () => {
    observeHeartSealMarker(marker(15), 10);
    expect(heartSealView(key, 11).portalSince).toBe(-1);
    observeHeartSealMarker(marker(31), 20);
    const v = heartSealView(key, 22);
    expect(v.mask).toBe(15);
    expect(v.portalSince).toBeCloseTo(2);
    clearHeartSealForTest();
    observeHeartSealMarker(marker(31), 50);
    expect(heartSealView(key, 50).portalSince).toBeGreaterThan(100);
    observeHeartSealMarker(marker(15), 60);
    expect(heartSealView(key, 60).portalSince).toBe(-1);
  });

  it('is fed through the gate-object seam: a seal marker view is an empty anchor that reports', () => {
    const plan = gateObjectPlan({ ...marker(2) });
    expect(plan).toEqual({ encounterAnchor: true, height: 2 });
    expect(heartSealView(key, 0).mask).toBe(2);
  });

  it('faces each quarter at its river and fills when the river arrives, then holds', () => {
    const at = Object.fromEntries(HEART_SEAL_QUARTERS.map((q) => [q.vein, q.bearingDeg]));
    expect(at.breath).toBe(0);
    expect(at.quench).toBe(90);
    expect(at.hammer).toBe(180);
    expect(at.heat).toBe(270);
    expect(HEART_SEAL_QUARTERS.map((q) => q.vein)).toEqual([...SMITH_HEART_VEINS]);
    expect(heartSealQuarterFill(-1)).toBe(0);
    expect(heartSealQuarterFill(HEART_SEAL_ARRIVAL - 0.1)).toBe(0);
    expect(heartSealQuarterFill(HEART_SEAL_ARRIVAL + HEART_SEAL_FILL_SECONDS / 2)).toBeGreaterThan(
      0.5,
    );
    expect(heartSealQuarterFill(999)).toBe(1);
    expect(heartSealQuarterLevel(0)).toBe(0);
    expect(
      heartSealQuarterLevel(HEART_SEAL_ARRIVAL + HEART_SEAL_FILL_SECONDS + 0.2),
    ).toBeGreaterThan(1);
    expect(heartSealQuarterLevel(999)).toBe(1);
    expect(heartSealColumn(HEART_SEAL_ARRIVAL - 0.5)).toBe(0);
    expect(heartSealColumn(HEART_SEAL_ARRIVAL + 0.3)).toBeGreaterThan(0.5);
    expect(heartSealColumn(999)).toBe(0);
    // The fill meets the river: it starts as the light reaches the seal.
    expect(HEART_SEAL_ARRIVAL).toBeLessThanOrEqual(HEART_RIVER_RUN_SECONDS);
    expect(HEART_SEAL_ARRIVAL).toBeGreaterThan(HEART_RIVER_RUN_SECONDS * 0.8);
  });
});

describe('heart_portal_core: the opening, the hop, the area blend', () => {
  it('is dark while shut and whole, without a burst, when met long open', () => {
    expect(heartPortalStage(-1)).toEqual({ charge: 0, flash: 0, split: 0, ring: 0, swirl: 0 });
    const old = heartPortalStage(999);
    expect(old.split).toBe(1);
    expect(old.swirl).toBe(1);
    expect(old.flash).toBe(0);
    expect(old.ring).toBe(0);
    expect(old.charge).toBe(0);
  });
  it('charges, then flashes, splits, rings out and grows the vortex, in that order', () => {
    const O = HEART_PORTAL_OPEN;
    const mid = heartPortalStage(O.charge * 0.5);
    expect(mid.charge).toBeGreaterThan(0.2);
    expect(mid.flash).toBe(0);
    expect(mid.split).toBe(0);
    expect(mid.swirl).toBe(0);
    const burst = heartPortalStage(O.charge + 0.1);
    expect(burst.flash).toBeGreaterThan(0.6);
    expect(burst.ring).toBeGreaterThan(0);
    const later = heartPortalStage(O.charge + 1.2);
    expect(later.split).toBeGreaterThan(0.9);
    expect(later.ring).toBeGreaterThan(burst.ring);
    expect(later.swirl).toBeGreaterThan(0.3);
    expect(heartPortalStage(O.charge + O.ring + 0.1).ring).toBe(0);
    // Monotone growth of the split and the swirl.
    let split = 0;
    let swirl = 0;
    for (let t = 0; t < 6; t += 0.05) {
      const s = heartPortalStage(t);
      expect(s.split).toBeGreaterThanOrEqual(split);
      expect(s.swirl).toBeGreaterThanOrEqual(swirl);
      split = s.split;
      swirl = s.swirl;
    }
  });
  it('reads a hop only when the camera crosses areas in one frame', () => {
    const ring = { x: 0, z: -12 };
    const heart = { x: HEART_ARRIVAL.x, z: HEART_ARRIVAL.z };
    expect(heartHopLanding(null, heart)).toBeNull();
    expect(heartHopLanding(ring, heart)).toBe('heart');
    expect(heartHopLanding(heart, ring)).toBe('ring');
    expect(heartHopLanding(ring, { x: 3, z: -10 })).toBeNull();
    // A long jump inside the main map (a dev teleport) is no hop.
    expect(heartHopLanding({ x: -200, z: -200 }, ring)).toBeNull();
    expect(heartHopStage(-1)).toEqual({ column: 0, ring: 0, flash: 0 });
    const early = heartHopStage(0.2);
    expect(early.column).toBeGreaterThan(0.5);
    expect(early.flash).toBeGreaterThan(0);
    expect(heartHopStage(HEART_HOP_SECONDS + 0.1).column).toBe(0);
  });
  it('eases the sky across after a hop, snaps after a long gap', () => {
    expect(heartAreaBlend(0, true, 0.5)).toBeGreaterThan(0);
    expect(heartAreaBlend(0, true, 0.5)).toBeLessThan(1);
    expect(heartAreaBlend(0.5, false, 0.1)).toBeLessThan(0.5);
    expect(heartAreaBlend(0, true, 10)).toBe(1);
    expect(heartAreaBlend(1, false, 10)).toBe(0);
  });
  it('thins only the cosmetic motes on the low tier', () => {
    expect(heartPortalMoteCount(true)).toBeLessThan(heartPortalMoteCount(false));
    expect(heartEmberCount(true)).toBeLessThan(heartEmberCount(false));
    expect(heartPortalMoteCount(true)).toBeGreaterThan(0);
  });
});

describe('heart_room_core: the chains, the keels, the core', () => {
  it('hangs the platform on four chains, one from each altar out over the chasm into the crown', () => {
    const chains = heartChains();
    expect(chains.map((c) => c.vein).sort()).toEqual([...SMITH_HEART_VEINS].sort());
    for (const c of chains) {
      const altar = HEART_ALTARS.find((a) => a.vein === c.vein);
      if (!altar) throw new Error(c.vein);
      expect(Math.hypot(c.ax - altar.x, c.az - altar.z)).toBeLessThan(4);
      expect(Math.hypot(c.bx - HEART_ROOM.x, c.bz - HEART_ROOM.z)).toBeGreaterThan(
        HEART_ROOM_CHASM_R,
      );
      expect(c.by).toBeGreaterThan(c.ay + 40);
      expect(c.links).toBeGreaterThan(10);
      const mid = heartChainLink(c, Math.floor(c.links / 2));
      expect(mid.y).toBeGreaterThan(c.ay);
      expect(mid.y).toBeLessThan(c.by);
      // No link hangs over the walkable floor below a body's height.
      for (let i = 0; i < c.links; i++) {
        const l = heartChainLink(c, i);
        const f = floorAt(l.x, l.z);
        if (f !== null) expect(l.y - f, `${c.vein} link ${i}`).toBeGreaterThan(2.6);
      }
    }
  });
  it('keeps every keel under its island and above the heart', () => {
    for (const k of heartKeels()) {
      const top = k.profile[0];
      expect(top[1]).toBeLessThan(0);
      const surface = F.surfaces.find((s) => s.id === k.id);
      if (!surface || surface.kind !== 'circle') throw new Error(k.id);
      expect(top[0]).toBeLessThan(surface.r);
      expect(heartKeelBottom(k)).toBeGreaterThan(
        k.id === 'seal_dais' ? F.voidHeight : HEART_CORE.y + HEART_CORE.r,
      );
    }
  });
  it('sets the core deep under the platform and its shafts in the chasm ring', () => {
    expect(HEART_CORE.y + HEART_CORE.r).toBeLessThan(HEART_ROOM.h - 20);
    for (const s of HEART_CORE_SHAFTS) {
      const d = Math.hypot(s.x - HEART_ROOM.x, s.z - HEART_ROOM.z);
      expect(d).toBeGreaterThan(HEART_ROOM.r + 4);
      expect(d).toBeLessThan(HEART_ROOM_CHASM_R);
      // Clear of the arrival's view: never between the terrace and the platform.
      const bearing = (Math.atan2(s.x - HEART_ROOM.x, s.z - HEART_ROOM.z) * 180) / Math.PI;
      const terrace =
        (Math.atan2(HEART_TERRACE.x - HEART_ROOM.x, HEART_TERRACE.z - HEART_ROOM.z) * 180) /
        Math.PI;
      const off = Math.abs(((bearing - terrace + 540) % 360) - 180);
      expect(off).toBeGreaterThan(40);
    }
  });
});

describe('heart_gates_core: the gate poses', () => {
  it('rigs every Smith Heart gate kind', () => {
    for (const g of SMITH_HEART_GATES) expect(heartGateRig(g.kind), g.id).not.toBeNull();
    expect(heartGateRig('portcullis')).toBeNull();
  });
  it('the slab stands whole shut, splits and sinks out of sight open', () => {
    expect(heartSlabPose(0)).toEqual({ part: 0, sink: 0, shown: true });
    const mid = heartSlabPose(0.5);
    expect(mid.part).toBeGreaterThan(1);
    expect(mid.sink).toBeGreaterThan(0);
    expect(heartSlabPose(1).shown).toBe(false);
  });
  it('the forge seal shows its light shut, flares sealed, drains first and is gone open', () => {
    expect(heartSealGatePose(0, false, 0)).toEqual({ sink: 0, film: 1, rise: 1, shown: true });
    expect(heartSealGatePose(0, true, Math.PI / 10).film).toBeGreaterThan(1.3);
    // Opening, the curtain drains into its channel before the threshold
    // starts to sink.
    const early = heartSealGatePose(0.2, false, 0);
    expect(early.rise).toBeLessThan(0.5);
    expect(early.sink).toBe(0);
    const open = heartSealGatePose(1, false, 0);
    expect(open.film).toBe(0);
    expect(open.rise).toBe(0);
    expect(open.shown).toBe(false);
  });
  it('the forge seal is a LOW barrier of stone and light: nothing over 3 yd, only light and low crystal above the threshold', () => {
    for (const g of SMITH_HEART_GATES.filter((x) => x.kind === 'forge_seal')) {
      const parts = heartGateParts('seal', g.hw * 2);
      for (const p of parts) {
        expect(p.y + p.h / 2, `${g.id} ${p.role}`).toBeLessThanOrEqual(3);
        if (p.y + p.h / 2 > HEART_SEAL_BARRIER.sillHeight + 1e-9 && p.role !== 'post') {
          // Over the threshold: the curtain and the channel are light (never
          // a solid in a sightline), the crystal small and low.
          if (p.role === 'crystal') {
            expect(p.y + p.h / 2).toBeLessThanOrEqual(1.2);
            expect(p.w).toBeLessThanOrEqual(0.6);
          } else {
            expect(p.light, `${g.id} ${p.role}`).toBe(true);
          }
        }
        // The middle 2 yd (the line a raid looks along) holds no crystal.
        if (p.role === 'crystal') expect(Math.abs(p.x) - p.w / 2).toBeGreaterThan(1);
        if (p.role === 'post') expect(Math.abs(p.x) - p.w / 2).toBeGreaterThanOrEqual(g.hw);
      }
      const sill = parts.find((p) => p.role === 'sill');
      expect(sill?.w).toBeCloseTo(g.hw * 2);
      // The curtain spans the passage between the standing stones.
      const veil = parts.find((p) => p.role === 'veil');
      expect(veil?.w).toBeGreaterThan(g.hw * 2 - 1);
      expect((veil?.y ?? 0) + (veil?.h ?? 0) / 2).toBeCloseTo(HEART_SEAL_BARRIER.veilTop);
      for (const p of parts) {
        expect(heartGatePartPose(p, 'seal', 1).shown, p.role).toBe(p.role === 'post');
      }
    }
  });
  it("each vein gate burns its vein's colour, the Heart Bridge the Heart's white-gold", () => {
    expect(heartGateVein('cornice_mouth')).toBe('breath');
    expect(heartGateVein('lake_mouth')).toBe('quench');
    expect(heartGateVein('anvil_mouth')).toBe('heat');
    expect(heartGateVein('heart_bridge')).toBe('heart');
    expect(heartGateTint('cornice_mouth')).toBe(SMITH_HEART_VEIN_COLORS.breath);
    expect(heartGateTint('lake_mouth')).toBe(SMITH_HEART_VEIN_COLORS.quench);
    expect(heartGateTint('anvil_mouth')).toBe(SMITH_HEART_VEIN_COLORS.heat);
    expect(heartGateTint('heart_bridge')).toBe(HEART_GATE_HEART_TINT);
    // Every forge seal gate has its light.
    for (const g of SMITH_HEART_GATES.filter((x) => x.kind === 'forge_seal'))
      expect(['breath', 'quench', 'heat', 'heart'], g.id).toContain(heartGateVein(g.id));
  });
  it('the slab stays a slab, and is gone open', () => {
    const parts = heartGateParts('slab', 15.2);
    expect(Math.max(...parts.map((p) => p.y + p.h / 2))).toBeLessThanOrEqual(9);
    for (const p of parts) expect(heartGatePartPose(p, 'slab', 1).shown).toBe(false);
  });
});

describe('heart_sightline_core: the raid sees the seal and the portal', () => {
  const solids = [
    ...heartWallSolids(5),
    ...heartWallSolids(7),
    ...heartPropSolids(),
    ...heartGateSolids(0),
    ...heartGateSolids(0.5),
    ...heartGateSolids(1),
    // The mountain's rock and the walks' lips (phase 2E).
    ...heartRockSolids(),
    // The Ring kit's jambs, spires and parapets (phase 2F).
    ...heartRingSolids(),
  ];
  const seal = { x: HEART_SEAL.x, y: SEAL_DAIS.h + 0.5, z: HEART_SEAL.z };
  const portalEye = { x: HEART_SEAL.x, y: SEAL_DAIS.h + 9, z: HEART_SEAL.z };
  const eye = (x: number, z: number) => ({ x, y: authoredFieldHeight(F, x, z) + 1.7, z });
  const balconyTip = eye(0, BALCONY.z1 + 0.5);

  it('plans every family of solid (the pin is not vacuous)', () => {
    expect(heartWallSolids(5).length).toBeGreaterThan(300);
    expect(heartPropSolids().length).toBeGreaterThan(100);
    expect(heartGateSolids(0).length).toBeGreaterThan(30);
    expect(heartRockSolids().length).toBeGreaterThan(900);
    const g = SMITH_HEART_GATES.find((x) => x.id === 'anvil_mouth');
    if (!g) throw new Error('no anvil mouth gate');
    const low = authoredFieldHeight(F, g.x, g.z) + 0.3;
    expect(
      heartSightlineHits({ x: g.x + 3, y: low, z: g.z }, { x: g.x - 3, y: low, z: g.z }, solids),
    ).toContain('anvil_mouth:sill');
    // A tine does stand on the dais (the rays pass between them).
    const tine = F.props.find((p) => p.kind === 'sh_portal_tine');
    if (!tine) throw new Error('no tine');
    expect(
      heartSightlineHits(
        { x: tine.x - 3, y: SEAL_DAIS.h + 6, z: tine.z },
        { x: tine.x + 3, y: SEAL_DAIS.h + 6, z: tine.z },
        solids,
      ),
    ).toContain('sh_portal_tine');
  });

  it('every point of the Ring sees the seal and the portal over every gate, prop and rock', () => {
    const bad: string[] = [];
    const degs: number[] = [RING_ARC.fromDeg, RING_ARC.toDeg];
    for (let d = Math.ceil(RING_ARC.fromDeg / 10) * 10; d <= RING_ARC.toDeg; d += 10) degs.push(d);
    expect(degs.length).toBeGreaterThan(25);
    for (const deg of degs) {
      const p = ringPoint(deg, RING.R);
      for (const [what, target] of [
        ['seal', seal],
        ['portal', portalEye],
      ] as const) {
        const hits = heartSightlineHits(eye(p.x, p.z), target, solids);
        if (hits.length) bad.push(`ring ${deg % 360} to ${what}: ${hits.join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the Balcony tip sees the seal, the portal and each vein mouth', () => {
    expect(heartSightlineHits(balconyTip, seal, solids)).toEqual([]);
    expect(heartSightlineHits(balconyTip, portalEye, solids)).toEqual([]);
    for (const deg of [0, 90, 270]) {
      const m = ringPoint(deg, 66);
      const mouth = { x: m.x, y: authoredFieldHeight(F, m.x, m.z) + 1, z: m.z };
      expect(heartSightlineHits(balconyTip, mouth, solids), `mouth ${deg}`).toEqual([]);
    }
  });
});

/** How far a part reaches from the prop's centre across the ground. */
function reach(p: HeartPart): number {
  const off = Math.hypot(p.x, p.z);
  if (p.shape === 'box') return off + Math.hypot(p.w / 2, p.d / 2);
  if (p.shape === 'cyl') return off + Math.max(p.w, p.d) / 2;
  return off + p.w / 2;
}

describe('heart_plan_core: the props and the lights', () => {
  it('has a recipe for every sh_ prop kind the field places, and no dead rows', () => {
    const kinds = new Set(F.props.map((p) => p.kind));
    for (const k of kinds) {
      expect(k.startsWith('sh_'), k).toBe(true);
      expect(HEART_PROP_RECIPES[k], k).toBeDefined();
    }
    expect(Object.keys(HEART_PROP_RECIPES).sort()).toEqual([...kinds].sort());
  });

  it('keeps every part a body can touch within its collider (plus a body width)', () => {
    for (const prop of F.props) {
      if (prop.r === undefined && prop.hw === undefined) continue;
      const k = prop.scale ?? 1;
      const foot = prop.r ?? Math.hypot(prop.hw ?? 0, prop.hd ?? 0);
      for (const p of HEART_PROP_RECIPES[prop.kind]) {
        if ((p.y - p.h / 2) * k > 2.6) continue; // above a body's head
        expect(reach(p) * k, `${prop.kind} part`).toBeLessThanOrEqual(foot + 0.6);
      }
    }
  });

  it('stands no render-only solid over walkable floor', () => {
    const bad: string[] = [];
    for (const prop of F.props) {
      if (prop.r !== undefined || prop.hw !== undefined) continue;
      const base = heartPropBase(prop.x, prop.z);
      const k = prop.scale ?? 1;
      for (const p of HEART_PROP_RECIPES[prop.kind]) {
        const bottom = base + (p.y - p.h / 2) * k;
        const top = base + (p.y + p.h / 2) * k;
        const hw = p.shape === 'box' ? p.w / 2 : Math.max(p.w, p.d) / 2;
        const hd = p.shape === 'box' ? p.d / 2 : Math.max(p.w, p.d) / 2;
        for (const [u, v] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [0, 0],
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const lx = (p.x + u * hw) * k;
          const lz = (p.z + v * hd) * k;
          const c = Math.cos(prop.rot);
          const s = Math.sin(prop.rot);
          const x = prop.x + lx * c + lz * s;
          const z = prop.z - lx * s + lz * c;
          const h = floorAt(x, z);
          if (h === null) continue;
          if (top > h + 0.35 && bottom < h + 2.6)
            bad.push(`${prop.kind} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('makes each room read by its hero shapes, several times a body tall', () => {
    const tallest = (kind: string) => {
      const prop = F.props.find((p) => p.kind === kind);
      if (!prop) throw new Error(kind);
      const k = prop.scale ?? 1;
      return Math.max(...HEART_PROP_RECIPES[kind].map((p) => (p.y + p.h / 2) * k));
    };
    // A body is about two yards tall.
    expect(tallest('sh_quarry_colossus')).toBeGreaterThan(20);
    expect(tallest('sh_lightning_rod')).toBeGreaterThan(18);
    expect(tallest('sh_sunk_blade')).toBeGreaterThan(10);
    expect(tallest('sh_great_hearth')).toBeGreaterThan(20);
    expect(tallest('sh_giant_anvil')).toBeGreaterThan(8);
    expect(tallest('sh_portal_tine')).toBeGreaterThan(14);
    // The Heat is smith fire, never a volcano: no lava-red anywhere in it.
    expect(SMITH_HEART_VEIN_COLORS.heat).toBe(0xffe6a0);
    // The giant anvil stands in the Smith's Forge, before the hearth.
    const anvil = F.props.find((p) => p.kind === 'sh_giant_anvil');
    expect(anvil && onFloor(anvil.x, anvil.z)).toBe(true);
    expect(anvil && anvil.x < HEAT.floor.x0).toBe(true);
  });

  it('keys each vein in its colour and keeps at most eight lights per light zone', () => {
    const lights = planHeartLights();
    for (const vein of SMITH_HEART_VEINS) {
      const key = lights.find((l) => l.id === `key:${vein}`);
      expect(key?.color, vein).toBe(SMITH_HEART_VEIN_COLORS[vein]);
      const altar = lights.find((l) => l.id === `altar:${vein}`);
      expect(altar?.color, vein).toBe(SMITH_HEART_VEIN_COLORS[vein]);
    }
    expect(lights.find((l) => l.id === 'core')?.lift).toBeLessThan(0);
    const perZone = new Map<string, number>();
    for (const l of lights) {
      expect(l.x).toBeGreaterThanOrEqual(F.bounds.minX);
      expect(l.x).toBeLessThanOrEqual(F.bounds.maxX);
      const zone = heartLightZoneOf(l.x, l.z)?.id ?? 'none';
      perZone.set(zone, (perZone.get(zone) ?? 0) + 1);
    }
    expect(perZone.has('none')).toBe(false);
    for (const [zone, n] of perZone) expect(n, zone).toBeLessThanOrEqual(8);
  });

  it("lights the Cleft's first image: the door's glow and two braziers, at the landing's height", () => {
    // They stand past the landing's lip, where the field's height is the
    // void: each carries its own height (never ground + lift: that hung the
    // door's light seventy yards down in phase 2B).
    const lights = planHeartLights();
    const door = lights.find((l) => l.id === 'cleft_door');
    const braziers = lights.filter((l) => l.id.startsWith('cleft_brazier:'));
    expect(door?.y).toBeGreaterThan(CLEFT.h + 4);
    expect(door?.y).toBeLessThan(CLEFT.h + 12);
    expect(braziers).toHaveLength(2);
    for (const b of braziers) {
      expect(b.y).toBe(CLEFT.h + HEART_CLEFT_BRAZIER.lift);
      // A lamp: it carries its halo and flickers like a fire.
      expect(b.noHalo).toBeFalsy();
      expect(b.color).toBe(HEART_PALETTE.coal);
      // Beside the landing, within a short walk of its centre.
      expect(Math.hypot(b.x - CLEFT.x, b.z - CLEFT.z)).toBeLessThan(CLEFT.r + 12);
    }
    // Either side of the doorway, a doorway's width apart.
    const [a, c] = braziers;
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeCloseTo(HEART_CLEFT_BRAZIER.x * 2, 3);
  });
});

describe('smith_heart_placeholder_looks: the one list of borrowed bodies', () => {
  it('maps every Smith Heart mob to a real, non-Ignivar visual, through MOB_KEYS', () => {
    expect(Object.keys(SMITH_HEART_PLACEHOLDER_LOOKS).sort()).toEqual(
      Object.keys(SMITH_HEART_MOBS).sort(),
    );
    for (const [id, key] of Object.entries(SMITH_HEART_PLACEHOLDER_LOOKS)) {
      expect(VISUALS[key], `${id} -> ${key}`).toBeDefined();
      expect(key.includes('ignivar'), key).toBe(false);
      expect(['mob_hoard_magma_brute', 'mob_emberkin']).not.toContain(key);
      expect(visualKeyFor({ kind: 'mob', templateId: id } as never)).toBe(key);
    }
  });
});
