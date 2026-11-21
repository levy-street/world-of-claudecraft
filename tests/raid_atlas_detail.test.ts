// The raid atlas's fine detail (src/ui/hud/raid_atlas/raid_atlas_detail_core.ts):
// the Heart's four quarters, ridges, ring, well, altars and grooves derived
// from the room's own geometry core (smith_heart_quarters.ts), the quarter
// washes from the room's own palette, every dressing piece drawn as a
// landmark, the rooms' line features read from their layout records, the
// tiers that keep the page and the minimap legible, and the quarter names.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HEART_QUARTER_PALETTE,
  HEART_RING_LOOK,
} from '../src/render/smith_heart/heart_quarters_core';
import {
  HEART_VEIN_GROOVE,
  HEART_VEIN_GROOVE_CURL_DEG,
  heartVeinGroovePoint,
} from '../src/render/smith_heart/heart_vein_groove_core';
import {
  BREATH_ISLES,
  CORNICE_CHANNELS,
  HEART_ALTARS,
  HEART_ROOM,
  HEARTH_WELL,
  POUR_CHANNEL,
  RING,
  SMITH_HEART_FIELD,
} from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterAt,
  heartQuarterSpot,
  heartRidgeDistance,
} from '../src/sim/content/smith_heart_quarters';
import {
  quarterColorRole,
  RAID_ATLAS_FINE_K,
  raidAtlasDrawsTier,
  raidAtlasFloorDetail,
} from '../src/ui/hud/raid_atlas/raid_atlas_detail_core';
import { RAID_ATLAS_DETAIL_LOOK } from '../src/ui/hud/raid_atlas/raid_atlas_page_painter';
import { RAID_ATLAS_COLOR_TOKENS } from '../src/ui/hud/raid_atlas/raid_atlas_palette_core';
import { raidAtlasFloorAt, raidAtlasPlanFor } from '../src/ui/hud/raid_atlas/raid_atlas_plan_core';
import { t } from '../src/ui/i18n';

const look = RAID_ATLAS_DETAIL_LOOK;
const heart = (() => {
  const h = raidAtlasFloorDetail('heart', look).heart;
  if (!h) throw new Error('the Heart page has its floor plan');
  return h;
})();
const veins = raidAtlasFloorDetail('veins', look);
const radius = (x: number, z: number) => Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z);

function inPolygon(x: number, z: number, pts: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

describe('the Heart: the Anvil of the World drawn from its quarter geometry', () => {
  it('centres on the room, rings the well at the sim ring radius, ends at the rim', () => {
    expect(heart.x).toBe(HEART_ROOM.x);
    expect(heart.z).toBe(HEART_ROOM.z);
    expect(heart.ringR).toBe(HEART_QUARTERS.ringR);
    expect(heart.rimR).toBe(HEART_QUARTERS.rimR);
    expect(heart.wellR).toBe(HEART_RING_LOOK.wellR);
    expect(heart.wellR).toBeLessThan(heart.ringR);
    expect(veins.heart).toBeNull();
  });

  it('draws four ridges from the ring to the rim, each ON its ridge line', () => {
    expect(heart.ridges).toHaveLength(4);
    expect(heart.ridgeHalfWidth).toBe(HEART_QUARTERS.ridgeHalfWidth);
    heart.ridges.forEach((ridge, k) => {
      const first = ridge[0];
      const last = ridge[ridge.length - 1];
      expect(radius(first[0], first[1])).toBeCloseTo(HEART_QUARTERS.ringR, 6);
      expect(radius(last[0], last[1])).toBeCloseTo(HEART_QUARTERS.rimR, 6);
      for (const [x, z] of ridge) expect(heartRidgeDistance(k, x, z)).toBeLessThan(1e-6);
    });
  });

  it('outlines each quarter so it holds exactly its own sector', () => {
    expect(heart.quarters.map((q) => q.vein)).toEqual(HEART_QUARTER_ORDER);
    for (const q of heart.quarters) {
      // The point the boss stands on for that quarter lies inside its outline
      // and inside no other quarter's.
      const spot = heartQuarterSpot(q.vein);
      expect(heartQuarterAt(spot.x, spot.z)).toBe(q.vein);
      for (const other of heart.quarters)
        expect(inPolygon(spot.x, spot.z, other.outline), `${q.vein} in ${other.vein}`).toBe(
          other.vein === q.vein,
        );
      // Every outline point is on the platform, between the ring and the rim.
      for (const [x, z] of q.outline) {
        const r = radius(x, z);
        expect(r).toBeGreaterThan(HEART_QUARTERS.ringR - 1e-6);
        expect(r).toBeLessThan(HEART_QUARTERS.rimR + 1e-6);
      }
    }
  });

  it('washes each quarter in its own colour from the room quarter palette', () => {
    const css = readFileSync(join(__dirname, '../src/styles/tokens.css'), 'utf8');
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    for (const q of heart.quarters) {
      expect(q.tone).toBe(quarterColorRole(q.vein));
      const token = RAID_ATLAS_COLOR_TOKENS[q.tone];
      const m = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      expect(m, token).not.toBeNull();
      expect(m?.[1].toLowerCase(), q.vein).toBe(hex(HEART_QUARTER_PALETTE[q.vein].color));
    }
    // Four distinct hues.
    expect(new Set(heart.quarters.map((q) => q.tone)).size).toBe(4);
  });

  it('follows the renderer for the well and the grooves (one look, never re-typed)', () => {
    expect(look).toEqual({
      wellR: HEART_RING_LOOK.wellR,
      grooveRingR: HEART_VEIN_GROOVE.ringR,
      grooveCurlDeg: HEART_VEIN_GROOVE_CURL_DEG,
      grooveEndR: HEART_VEIN_GROOVE.endR,
    });
  });

  it('cuts each groove from under its altar, across the ring, to the boss feet', () => {
    expect(heart.grooves.map((g) => g.vein)).toEqual(HEART_ALTARS.map((a) => a.vein));
    for (const g of heart.grooves) {
      const altar = HEART_ALTARS.find((a) => a.vein === g.vein);
      if (!altar) throw new Error(g.vein);
      // Down the walk from the altar's centre to the ring, then over the
      // ring's rim to the well, then through the well to the boss.
      const [w0, wN] = [g.walk[0], g.walk[g.walk.length - 1]];
      expect(Math.hypot(w0[0] - altar.x, w0[1] - altar.z)).toBeLessThan(1e-6);
      expect(radius(wN[0], wN[1])).toBeCloseTo(HEART_QUARTERS.ringR, 6);
      expect(g.rim[0]).toEqual(wN);
      expect(radius(g.rim[g.rim.length - 1][0], g.rim[g.rim.length - 1][1])).toBeCloseTo(
        heart.wellR,
        6,
      );
      expect(g.well[0]).toEqual(g.rim[g.rim.length - 1]);
      const last = g.well[g.well.length - 1];
      expect(radius(last[0], last[1])).toBeCloseTo(HEART_VEIN_GROOVE.endR, 6);
      // Every point lies on the floor shader's own groove (the same law the
      // arrival's light runs down).
      for (const [x, z] of [...g.walk, ...g.rim, ...g.well]) {
        const want = heartVeinGroovePoint(g.vein, radius(x, z));
        expect(Math.hypot(want.x - x, want.z - z), g.vein).toBeLessThan(1e-6);
      }
      // On the walk a groove stays inside its own quarter (it never crosses
      // a ridge).
      for (const [x, z] of g.walk.slice(0, -1)) expect(heartQuarterAt(x, z)).toBe(g.vein);
    }
  });

  it('stands every altar on its record, facing the centre', () => {
    expect(heart.altars).toHaveLength(4);
    for (const a of heart.altars) {
      const rec = HEART_ALTARS.find((x) => x.vein === a.vein);
      expect({ x: a.x, z: a.z }).toEqual({ x: rec?.x, z: rec?.z });
      const prop = SMITH_HEART_FIELD.props.find((p) => p.kind === `sh_altar_${a.vein}`);
      expect(a.rot).toBe(prop?.rot);
      expect(a.r).toBe(prop?.r);
    }
  });

  it('letters each quarter with the fight HUD quarter name, inside its quarter', () => {
    const plan = raidAtlasPlanFor('smith_heart');
    const floor = plan?.floors.find((f) => f.id === 'heart');
    const quarters = floor?.rooms.filter((r) => r.rank === 'quarter') ?? [];
    expect(quarters.map((r) => r.labelKey)).toEqual(
      HEART_QUARTER_ORDER.map((v) => `hudChrome.finalOverload.${v}`),
    );
    for (const [i, r] of quarters.entries()) {
      expect(heartQuarterAt(r.x, r.z)).toBe(HEART_QUARTER_ORDER[i]);
      expect(t(r.labelKey as never)).not.toBe(r.labelKey);
    }
  });
});
})

describe('the rooms: landmarks and line features from their layout records', () => {
  it('draws every dressing piece that has a footprint as a landmark on its page', () => {
    const plan = raidAtlasPlanFor('smith_heart');
    if (!plan) throw new Error('plan');
    for (const floor of ['veins', 'heart'] as const) {
      const d = raidAtlasFloorDetail(floor, look);
      const pieces = SMITH_HEART_FIELD.props.filter(
        (p) =>
          raidAtlasFloorAt(p.x, p.z) === floor &&
          (p.r !== undefined || p.hw !== undefined) &&
          !p.kind.startsWith('sh_altar_'),
      );
      for (const p of pieces) {
        const g = d.glyphs.find((x) => x.x === p.x && x.z === p.z);
        expect(g, `${floor}: ${p.kind} at ${p.x}, ${p.z}`).toBeDefined();
        if (p.r !== undefined) expect(g?.r).toBe(p.r);
        if (p.hw !== undefined) expect([g?.hw, g?.hd]).toEqual([p.hw, p.hd]);
      }
    }
  });

  it('gives each room its own theme', () => {
    const kinds = new Set(veins.glyphs.map((g) => g.kind));
    // The Hammer, the Ring, the Breath, the Quench, the Heat.
    for (const k of [
      'column',
      'colossus',
      'derrick',
      'standingStone',
      'cairn',
      'shelter',
      'blade',
      'iceShelf',
      'brazier',
      'anvil',
      'hearthMouth',
      'wellspring',
      'firePool',
    ] as const)
      expect(kinds.has(k), k).toBe(true);
    const pool = veins.glyphs.find((g) => g.kind === 'firePool');
    expect(pool).toMatchObject({ x: HEARTH_WELL.x, z: HEARTH_WELL.z, r: HEARTH_WELL.r });
  });

  it('reads the line features from the rooms records', () => {
    const of = (k: string) => veins.strokes.filter((s) => s.kind === k);
    const molten = of('molten');
    expect(molten).toHaveLength(1);
    expect(molten[0].points).toEqual([
      [POUR_CHANNEL.x, POUR_CHANNEL.z0],
      [POUR_CHANNEL.x, POUR_CHANNEL.z1],
    ]);
    expect(molten[0].width).toBe(POUR_CHANNEL.halfWidth * 2);
    expect(of('windChannel')).toHaveLength(CORNICE_CHANNELS.length);
    expect(of('isle')).toHaveLength(BREATH_ISLES.length);
    const inlay = of('inlay');
    expect(inlay).toHaveLength(1);
    for (const [x, z] of inlay[0].points)
      expect(Math.hypot(x - RING.x, z - RING.z)).toBeCloseTo(RING.R, 6);
    expect(of('arch')).toHaveLength(1);
    expect(of('shoreline').length).toBeGreaterThanOrEqual(2);
    // Nothing of the veins strays onto the Heart page, and back.
    for (const g of veins.glyphs) expect(raidAtlasFloorAt(g.x, g.z)).toBe('veins');
    for (const g of raidAtlasFloorDetail('heart', look).glyphs)
      expect(raidAtlasFloorAt(g.x, g.z)).toBe('heart');
  });

  it('keeps fine detail for close looks: the veins plate and the minimap skip it', () => {
    const plan = raidAtlasPlanFor('smith_heart');
    if (!plan) throw new Error('plan');
    const veinsFloor = plan.floors.find((f) => f.id === 'veins');
    if (!veinsFloor) throw new Error('veins');
    // The plate painter's own resolution (raid_atlas_painter.ts PLATE_PX).
    const plateK = 2048 / (veinsFloor.bounds.maxX - veinsFloor.bounds.minX);
    expect(raidAtlasDrawsTier('fine', plateK)).toBe(false);
    expect(raidAtlasDrawsTier('base', plateK)).toBe(true);
    expect(raidAtlasDrawsTier('fine', RAID_ATLAS_FINE_K)).toBe(true);
    // Both tiers are in use.
    const tiers = new Set([...veins.glyphs, ...veins.strokes].map((x) => x.tier));
    expect(tiers).toEqual(new Set(['base', 'fine']));
  });

  it('builds once per page (the plate is painted once)', () => {
    expect(raidAtlasFloorDetail('veins', look)).toBe(veins);
  });
});
