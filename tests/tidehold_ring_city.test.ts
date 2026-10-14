// Tidehold as a ring city (src/sim/deepglass/citadel_ring.ts): the whole
// layout checked against the sim it has to run in.
import { describe, expect, it } from 'vitest';
import { setActiveWorldContent } from '../src/sim/data';
import { TH_MONUMENT, TIDEHOLD_RESIDENTS } from '../src/sim/deepglass/citadel';
import {
  ASSET_PALETTE,
  plotFencePanels,
  RING_PLOTS,
  ringPlacements,
} from '../src/sim/deepglass/citadel_ring';
import {
  pol,
  RING_AVENUES,
  RING_CROWN,
  RING_CX,
  RING_CZ,
  RING_MIDDLE,
  RING_OUTER,
  RING_R,
  RING_TIERS,
} from '../src/sim/deepglass/citadel_ring_frame';
import { buildDeepglassWorld, DEEPGLASS_MAP_ENTRY } from '../src/sim/deepglass/world';
import { MODEL_PATH } from '../src/sim/map_doc';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import {
  groundHeightAtBody,
  groundHeightNear,
  terrainHeight,
  waterLevelAt,
} from '../src/sim/world';

const SEED = DEEPGLASS_MAP_ENTRY.seed;
const WATER = -2;

describe('Tidehold ring city', () => {
  const world = buildDeepglassWorld();
  const city = ringPlacements();

  it('uses only the placed-asset palette, and every building has a real size', () => {
    for (const p of city) {
      if (p.path === MODEL_PATH) continue;
      const id = p.path.replace(/^\/models\//, '').replace(/\.glb$/, '');
      expect(ASSET_PALETTE.has(id), id).toBe(true);
      expect(p.scale, id).toBeGreaterThan(0);
    }
    // one of everything that matters
    const ids = city.map((p) => p.path);
    for (const must of [
      'tidehold/castle_b',
      'tidehold/hall',
      'tidehold/bank',
      'tidehold/tavern',
      'tidehold/market',
      'tidehold/smithy',
      'tidehold/house_a',
      'tidehold/house_b',
      'tidehold/house_c',
      'tidehold/house_d',
      'tidehold/house_e',
      'biome/hexb_docks',
      'biome/hex_ship_blue',
      'deepglass/bridge_deck',
      'deepglass/bridge_lamp',
      'deepglass/bridge_pylon',
      'props/eastbrook_realm_builder_monument',
      'props/tidehold_skybeacon',
    ]) {
      expect(ids.filter((p) => p === `/models/${must}.glb`).length, must).toBeGreaterThan(0);
    }
  });

  it('stands every tier at its height, the quay over open water, the strait under the Tideway', () => {
    setActiveWorldContent(world);
    try {
      for (const tier of RING_TIERS) {
        const rMid = (Math.max(tier.r0, 12) + tier.r1) / 2;
        for (let i = 0; i < 8; i++) {
          const phi = (i / 8) * Math.PI * 2 + 0.2;
          const p = pol(rMid, phi);
          expect(terrainHeight(p.x, p.z, SEED), `${tier.id} @ ${phi.toFixed(2)}`).toBeCloseTo(
            tier.y,
            0,
          );
        }
      }
      // the quay edge is land; just beyond it is water on a shallow shelf
      for (let i = 0; i < 8; i++) {
        const phi = (i / 8) * Math.PI * 2 + 0.1;
        const q = pol(RING_R - 4, phi);
        expect(terrainHeight(q.x, q.z, SEED)).toBeCloseTo(RING_OUTER.y, 0);
        const sea = pol(RING_R + 30, phi);
        expect(terrainHeight(sea.x, sea.z, SEED)).toBeLessThan(WATER - 3);
        expect(waterLevelAt(sea.x, sea.z, SEED)).toBe(WATER);
      }
      // the strait between the arena terrace and the island is declared water
      for (const z of [125, 150, 180]) {
        for (const x of [-40, 0, 40]) {
          expect(terrainHeight(x, z, SEED), `strait ${x},${z}`).toBeLessThan(WATER - 3);
          expect(waterLevelAt(x, z, SEED), `strait ${x},${z}`).toBe(WATER);
        }
      }
      // the arena terrace survives the sea stamps
      expect(terrainHeight(0, 60, SEED)).toBeCloseTo(0, 0);
    } finally {
      setActiveWorldContent(null);
    }
  });

  it('climbs every avenue on stairs from the quay to the crown, and the bridges carry a body', () => {
    setActiveWorldContent(world);
    try {
      for (const phi of RING_AVENUES) {
        // walk inward from the outer ring road to the crown plaza
        let prev = -Infinity;
        let feet = RING_OUTER.y;
        for (let r = 250; r >= 60; r -= 2) {
          const p = pol(r, phi);
          const h = groundHeightAtBody(p.x, p.z, SEED, feet);
          if (prev === -Infinity) prev = h;
          // never more than the walk line's own quarter-riser step down off a
          // flight's head, never a step up a body cannot take
          expect(h, `avenue ${phi.toFixed(2)} r=${r}`).toBeGreaterThanOrEqual(prev - 0.35);
          expect(h - prev, `avenue ${phi.toFixed(2)} r=${r}`).toBeLessThan(1.6);
          prev = h;
          feet = h;
        }
        expect(prev).toBeCloseTo(RING_CROWN.y, 0);
        expect(
          groundHeightAtBody(...(Object.values(pol(150, phi)) as [number, number]), SEED, 20),
        ).toBeCloseTo(RING_MIDDLE.y, 0);
      }
      // the Tideway: deck level with the outer ring, over water
      for (let z = 116; z <= 212; z += 12) {
        expect(placementRampFloorAt(world, SEED, 0, z), `tideway z=${z}`).toBeCloseTo(
          RING_OUTER.y,
          1,
        );
        expect(terrainHeight(0, z, SEED)).toBeLessThan(WATER);
      }
      // the spans, out to the beacon terraces
      for (const side of [-1, 1]) {
        for (let x = 292; x <= 364; x += 12) {
          expect(
            placementRampFloorAt(world, SEED, side * x, RING_CZ),
            `span x=${side * x}`,
          ).toBeCloseTo(RING_OUTER.y, 1);
        }
        expect(terrainHeight(side * 400, RING_CZ, SEED)).toBeCloseTo(RING_OUTER.y, 0);
      }
      // the arena end: from the terrace up onto the Tideway
      let prev = -Infinity;
      let feet = 0;
      for (let z = 70; z <= 118; z += 2) {
        const h = groundHeightAtBody(0, z, SEED, feet);
        if (prev === -Infinity) prev = h;
        expect(h, `approach z=${z}`).toBeGreaterThanOrEqual(prev - 0.35);
        expect(h - prev).toBeLessThan(1.6);
        prev = h;
        feet = h;
      }
      expect(prev).toBeCloseTo(RING_OUTER.y, 0);
    } finally {
      setActiveWorldContent(null);
    }
  });

  it('seats every resident on the island, on dry ground', () => {
    setActiveWorldContent(world);
    try {
      for (const r of TIDEHOLD_RESIDENTS) {
        const { x, z } = r.def.pos;
        const d = Math.hypot(x, z - RING_CZ);
        expect(d, r.def.id).toBeLessThan(RING_R - 2);
        expect(terrainHeight(x, z, SEED), r.def.id).toBeGreaterThan(WATER + 2);
        for (const pt of r.def.route?.points ?? []) {
          expect(terrainHeight(pt.x, pt.z, SEED), `${r.def.id} route`).toBeGreaterThan(WATER + 2);
        }
      }
    } finally {
      setActiveWorldContent(null);
    }
  });

  it('names every district and lands every landmark inside its box', () => {
    const locs = world.locations ?? [];
    const names = new Set(locs.map((l) => l.name));
    for (const n of [
      'The Warden’s Seat',
      'Wardens’ Row',
      'Coppersmiths’ Circle',
      'The Glass Market',
      'Lantern Terrace',
      'The Kelp Rows',
      'Ropewalk',
      'The Tidewharf',
      'Brinegate',
      'Gullhaven',
      'Saltside',
      'The Tideway',
      'The West Span',
      'The East Span',
      'Bellwater Terrace',
      'The Bellwater',
    ]) {
      expect(names.has(n), n).toBe(true);
    }
    const inside = (name: string, path: string): void => {
      const box = locs.find((l) => l.name === name);
      const p = city.find((c) => c.path === `/models/${path}.glb`);
      expect(box, name).toBeTruthy();
      expect(p, path).toBeTruthy();
      if (!box || !p) return;
      expect(
        p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ,
        `${path} in ${name}`,
      ).toBe(true);
    };
    inside('Wardenhold', 'tidehold/castle_b');
    inside('Vigil Hall', 'tidehold/hall');
    inside('The Glass Exchange', 'tidehold/market');
    inside("Tide's Coffer", 'tidehold/bank');
    inside('The Gilded Gull', 'tidehold/tavern');
    inside("Brine's Forge", 'tidehold/smithy');
  });
});

// The first keep's flight walk retired with the first keep (Castle B stands
// on the crown now; its own walk lives in tests/tidehold_castle_b.test.ts).

describe('plots, fences and the extra houses', () => {
  it('fences every plot with a gate gap, and keeps every building clear of every plot', () => {
    const city = ringPlacements();
    const fences = city.filter((p) => p.path === '/models/props/garden_iron_fence.glb');
    // every plot's panels (both long sides less the gate, both short sides),
    // plus the four round the monument
    expect(RING_PLOTS.length).toBeGreaterThanOrEqual(12);
    expect(RING_PLOTS.length).toBeLessThanOrEqual(20);
    expect(new Set(RING_PLOTS.map((p) => p.size)).size).toBe(3);
    expect(fences.length).toBe(RING_PLOTS.reduce((n, p) => n + plotFencePanels(p), 0) + 4);
    const houses = city.filter((p) => /tidehold\/house_[a-e]\.glb$/.test(p.path));
    expect(houses.length).toBeGreaterThanOrEqual(27);
    // no house or shop stands on a fenced plot, and none overlaps another building
    const big = city.filter((p) => /\/models\/tidehold\//.test(p.path));
    const plotCentres = fences.length > 0 ? big : big; // (plots are implicit: fences ring them)
    for (const h of houses) {
      for (const f of fences) {
        // a house footprint is >= 12 yd; a fence within 4 yd of its centre is on its plot
        expect(
          Math.hypot(h.x - f.x, h.z - f.z),
          `house at ${h.x.toFixed(0)},${h.z.toFixed(0)} vs fence`,
        ).toBeGreaterThan(5.5);
      }
    }
    for (let i = 0; i < big.length; i++) {
      for (let j = i + 1; j < big.length; j++) {
        const a = big[i];
        const b = big[j];
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.path} vs ${b.path}`).toBeGreaterThan(12);
      }
    }
    void plotCentres;
  });
});

describe('the curtain walls', () => {
  const walls = (): ReturnType<typeof ringPlacements> =>
    ringPlacements().filter((p) => /warden_wall/.test(p.path));
  const width = (p: { scale: number }): number => p.scale * 2.2; // the kit is as wide as it is tall
  const radius = (p: { x: number; z: number }): number => Math.hypot(p.x - RING_CX, p.z - RING_CZ);

  it('stands one wall round the crown and one round the low wards, and never doubles back', () => {
    const w = walls();
    const crownRing = w.filter((p) => radius(p) < 150);
    const outerRing = w.filter((p) => radius(p) >= 150);
    expect(crownRing.length).toBeGreaterThan(20);
    expect(outerRing.length).toBeGreaterThan(60);
    // Every module on a ring sits at the same radius: an arc that wrapped the
    // long way round used to lay four rings on top of each other.
    for (const [name, ring] of [
      ['crown', crownRing],
      ['outer', outerRing],
    ] as const) {
      const rs = ring.map(radius);
      expect(Math.max(...rs) - Math.min(...rs), `${name} ring radius spread`).toBeLessThan(1);
    }
    // No two modules stand inside one another.
    for (let i = 0; i < w.length; i++) {
      for (let j = i + 1; j < w.length; j++) {
        const d = Math.hypot(w[i].x - w[j].x, w[i].z - w[j].z);
        const need = ((width(w[i]) + width(w[j])) / 2) * 0.8;
        expect(
          d,
          `wall modules overlap at ${w[i].x.toFixed(0)},${w[i].z.toFixed(0)}`,
        ).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('mixes pillars with plain panels', () => {
    // Laying a wall one module per run restarted the pillar counter every time,
    // so the whole rampart came out as pillars and no panel ever shipped.
    const w = walls();
    const pillars = w.filter((p) => p.path.includes('pillar')).length;
    expect(pillars).toBeGreaterThan(0);
    expect(pillars).toBeLessThan(w.length / 2);
  });

  it('leaves every avenue open and never grows through another placement', () => {
    const w = walls();
    for (const phi of RING_AVENUES) {
      for (const r of [RING_CROWN.r1 - 3, 274]) {
        const gate = pol(r, phi);
        const nearest = Math.min(...w.map((p) => Math.hypot(p.x - gate.x, p.z - gate.z)));
        expect(nearest, `avenue ${phi.toFixed(2)} blocked at r=${r}`).toBeGreaterThan(12);
      }
    }
    const others = ringPlacements().filter((p) => !/warden_wall/.test(p.path));
    for (const a of w) {
      for (const b of others) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        expect(d, `wall grows through ${b.path}`).toBeGreaterThan(4);
      }
    }
  });
});

describe('the Warden’s Hall', () => {
  it('stands on the trading ring, not the crown', () => {
    const hall = ringPlacements().find((p) => p.path.includes('tidehold/hall'));
    expect(hall).toBeTruthy();
    if (!hall) return;
    const r = Math.hypot(hall.x - RING_CX, hall.z - RING_CZ);
    expect(r).toBeGreaterThanOrEqual(RING_MIDDLE.r0);
    expect(r).toBeLessThan(RING_MIDDLE.r1);
  });
});

describe('the Realm Builder monument', () => {
  it('stands at the Glass Market crossroads, on the entity seat, clear of the residents and stalls', () => {
    const city = ringPlacements();
    const mon = city.find((p) => p.path === '/models/props/eastbrook_realm_builder_monument.glb');
    expect(mon).toBeTruthy();
    if (!mon) return;
    expect(mon.x).toBeCloseTo(TH_MONUMENT.x, 3);
    expect(mon.z).toBeCloseTo(TH_MONUMENT.z, 3);
    expect(mon.rotY).toBe(TH_MONUMENT.rotY);
    // the crossroads: on the south avenue, on the trading ring's road
    expect(Math.abs(mon.x)).toBeLessThan(1);
    expect(mon.z).toBeCloseTo(RING_CZ - RING_MIDDLE.roadR, 3);
    for (const r of TIDEHOLD_RESIDENTS) {
      expect(Math.hypot(r.def.pos.x - mon.x, r.def.pos.z - mon.z), r.def.id).toBeGreaterThan(3);
    }
    for (const p of city) {
      if (p === mon) continue;
      expect(Math.hypot(p.x - mon.x, p.z - mon.z), p.path).toBeGreaterThan(3);
    }
  });
});
