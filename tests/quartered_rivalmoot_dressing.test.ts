import { describe, expect, it } from 'vitest';
import {
  QUARTERED_ISLE_NPCS,
  QUARTERED_ISLE_PROPS,
  RIVALMOOT_BURSAR_NPC_ID,
} from '../src/sim/content/quartered_isle';
import { QUARTERED_ISLE_ROADS } from '../src/sim/content/quartered_isle_ways';
import {
  RIVALMOOT_DRESSING,
  RIVALMOOT_GATE_HEADINGS,
  RIVALMOOT_WAYSTONE_OFFSET,
  RIVALMOOT_WAYSTONE_R,
  RIVALMOOT_WAYSTONES,
} from '../src/sim/content/quartered_rivalmoot_dressing';
import { RIVALMOOT_LAYOUT } from '../src/sim/painted_towns';
import { RIVALMOOT_HILL } from '../src/sim/quartered_isle_terrain';
import { quarteredLandmarkTint, RIVALMOOT_PAVING } from '../src/sim/quartered_landmarks';

const H = RIVALMOOT_HILL;
const fromHub = (p: { x: number; z: number }) => Math.hypot(p.x - H.x, p.z - H.z);

/** Distance from a point to the nearest town road's centre line. */
function roadDistance(p: { x: number; z: number }): number {
  let best = Infinity;
  for (const road of QUARTERED_ISLE_ROADS) {
    for (let i = 0; i + 1 < road.length; i++) {
      const a = road[i];
      const b = road[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(
        0,
        Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)),
      );
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
    }
  }
  return best;
}

describe("Rivalmoot's waystones", () => {
  it('finds the four roads out of the plaza, one toward each quarter', () => {
    const d = RIVALMOOT_GATE_HEADINGS;
    expect(d.ice.z).toBeLessThan(-0.7); // south, down to the crater and the Hoarshelf
    expect(d.fire.x).toBeGreaterThan(0.7); // east, the Cinderscar
    expect(d.earth.x).toBeLessThan(-0.7); // west, the Wilds
    expect(d.wind.z).toBeGreaterThan(0.7); // north, the Gyre's path
    for (const h of Object.values(d)) expect(Math.hypot(h.x, h.z)).toBeCloseTo(1, 9);
  });

  it("marks each road with a stone of that road's own quarter", () => {
    const keys = RIVALMOOT_WAYSTONES.map((p) => p.key);
    // no snow on the crater road: the Hoarshelf lies far beyond the crater
    expect(keys).toEqual(['cinderColumnsTall', 'heaveStrataSmall', 'rockTallA']);
    const heading = (p: { x: number; z: number }) => ({
      x: (p.x - H.x) / fromHub(p),
      z: (p.z - H.z) / fromHub(p),
    });
    const along = (p: { x: number; z: number }, d: { x: number; z: number }) =>
      heading(p).x * d.x + heading(p).z * d.z;
    expect(along(RIVALMOOT_WAYSTONES[0], RIVALMOOT_GATE_HEADINGS.fire)).toBeGreaterThan(0.95);
    expect(along(RIVALMOOT_WAYSTONES[1], RIVALMOOT_GATE_HEADINGS.earth)).toBeGreaterThan(0.95);
    expect(along(RIVALMOOT_WAYSTONES[2], RIVALMOOT_GATE_HEADINGS.wind)).toBeGreaterThan(0.95);
  });

  it('stands them on the level top, beside the road and never on it', () => {
    for (const p of RIVALMOOT_WAYSTONES) {
      const label = `${p.key} ${p.x},${p.z}`;
      expect(fromHub(p), label).toBeGreaterThan(RIVALMOOT_WAYSTONE_R - 1);
      expect(fromHub(p), label).toBeLessThan(H.topR);
      // the collider leaves the road and a rider's width clear
      expect(roadDistance(p) - (p.r ?? 0), label).toBeGreaterThan(2.5);
      expect(roadDistance(p), label).toBeGreaterThan(RIVALMOOT_WAYSTONE_OFFSET - 0.5);
    }
  });

  it('keeps every stone off the buildings', () => {
    for (const p of RIVALMOOT_WAYSTONES) {
      for (const b of RIVALMOOT_LAYOUT.buildings) {
        const d = Math.hypot(p.x - b.position.x, p.z - b.position.z);
        expect(d - (p.r ?? 0), `${p.key} to ${b.id}`).toBeGreaterThan(10);
      }
    }
  });

  it('is one stone a road: no pair to read as a gate', () => {
    // (the town stands open, tests/quartered_isle.test.ts)
    const sides = new Map<string, number>();
    for (const p of RIVALMOOT_WAYSTONES) {
      const gate = (
        Object.entries(RIVALMOOT_GATE_HEADINGS) as [string, { x: number; z: number }][]
      ).reduce((a, b) =>
        (p.x - H.x) * b[1].x + (p.z - H.z) * b[1].z > (p.x - H.x) * a[1].x + (p.z - H.z) * a[1].z
          ? b
          : a,
      );
      // which side of its road the piece stands on
      const side = Math.sign((p.x - H.x) * gate[1].z - (p.z - H.z) * gate[1].x);
      expect(sides.get(gate[0]) ?? side, `${gate[0]} stones share a side`).toBe(side);
      sides.set(gate[0], side);
    }
    expect(sides.size).toBe(3);
  });
});

describe("Rivalmoot's camp, stalls and stores", () => {
  const spots = [
    ...RIVALMOOT_DRESSING.tents.map((t) => ({ x: t.x, z: t.z, r: 2, id: 'tent' })),
    ...RIVALMOOT_DRESSING.campfires.map(([x, z]) => ({ x, z, r: 1, id: 'campfire' })),
    ...RIVALMOOT_DRESSING.crates.map(([x, z]) => ({ x, z, r: 0.7, id: 'crate' })),
    ...RIVALMOOT_DRESSING.wells.map((w) => ({ x: w.x, z: w.z, r: w.r, id: 'well' })),
    ...RIVALMOOT_DRESSING.stalls.map((s) => ({ x: s.x, z: s.z, r: s.r, id: 'stall' })),
  ];

  it('stands on the paved top and off the roads', () => {
    expect(spots.length).toBeGreaterThan(10);
    for (const s of spots) {
      const label = `${s.id} ${s.x},${s.z}`;
      expect(fromHub(s), label).toBeLessThan(RIVALMOOT_PAVING.fullR);
      expect(roadDistance(s) - s.r, label).toBeGreaterThan(1.5);
    }
  });

  it('pitches the camp on the south-west rim, clear of every building', () => {
    for (const t of RIVALMOOT_DRESSING.tents) {
      expect(t.x).toBeLessThan(H.x);
      expect(t.z).toBeLessThan(H.z - 15);
    }
    // the camp's own ground (the stores elsewhere lean on their walls)
    for (const s of spots.filter((s) => s.z < H.z - 15)) {
      for (const b of RIVALMOOT_LAYOUT.buildings) {
        const d = Math.hypot(s.x - b.position.x, s.z - b.position.z);
        expect(d - s.r, `${s.id} ${s.x},${s.z} to ${b.id}`).toBeGreaterThan(b.maxCornerRadius);
      }
    }
  });

  it('reaches the zone record', () => {
    const p = QUARTERED_ISLE_PROPS;
    expect(p.tents).toEqual([...RIVALMOOT_DRESSING.tents]);
    expect(p.campfires).toEqual([...RIVALMOOT_DRESSING.campfires]);
    expect(p.crates).toEqual([...RIVALMOOT_DRESSING.crates]);
    expect(p.wells).toEqual([...RIVALMOOT_DRESSING.wells]);
    expect(p.stalls).toEqual([...RIVALMOOT_DRESSING.stalls]);
    for (const w of RIVALMOOT_WAYSTONES) expect(p.decorProps).toContainEqual(w);
  });
});

describe("Rivalmoot's counting house", () => {
  const bank = RIVALMOOT_LAYOUT.buildings.find((b) => b.id === 'rivalmoot_strongbox');
  const stand = RIVALMOOT_LAYOUT.npcs.find((n) => n.id === RIVALMOOT_BURSAR_NPC_ID);

  it("is Eastbrook's banking hall, walk-in, on the south-east corner", () => {
    expect(bank?.assetId).toBe('/models/tidehold/bank.glb');
    expect(bank?.walkIn).toBe(true);
    expect(bank?.position.x).toBeGreaterThan(H.x);
    expect(bank?.position.z).toBeLessThan(H.z);
  });

  it('stands its bursar a few strides before the door, facing out of it', () => {
    if (!bank || !stand) throw new Error('bank or bursar stand missing');
    const off = Math.hypot(
      stand.position.x - bank.frontStandingPoint.x,
      stand.position.z - bank.frontStandingPoint.z,
    );
    expect(off).toBeGreaterThan(2);
    expect(off).toBeLessThan(6);
    expect(stand.facing).toBe(bank.frontFacing);
    // off the east road, on the paving
    expect(roadDistance(stand.position)).toBeGreaterThan(2.5);
    expect(fromHub(stand.position)).toBeLessThan(RIVALMOOT_PAVING.fullR);
    const def = QUARTERED_ISLE_NPCS[RIVALMOOT_BURSAR_NPC_ID];
    expect(def.banker).toBe(true);
    expect(def.pos).toEqual(stand.position);
  });

  it('keeps snow off the town: no frost outcrop stands on the hilltop', () => {
    const decor = QUARTERED_ISLE_PROPS.decorProps ?? [];
    expect(decor.filter((p) => p.key === 'frostSnowOutcrop' && fromHub(p) < H.topR)).toEqual([]);
  });
});

describe("Rivalmoot's paving", () => {
  const tint = { fissure: 0, ice: 0, ember: 0, glass: 0, stone: 0, basalt: 0, moot: 0 };
  const at = (r: number, bearing: number) => {
    quarteredLandmarkTint(H.x + Math.cos(bearing) * r, H.z + Math.sin(bearing) * r, tint);
    return tint.moot;
  };

  it('lies whole under the plaza and every building', () => {
    expect(at(0, 0)).toBe(1);
    for (const b of RIVALMOOT_LAYOUT.buildings) {
      quarteredLandmarkTint(b.position.x, b.position.z, tint);
      expect(tint.moot, b.id).toBe(1);
    }
  });

  it('fades out inside the level top and is gone on the slopes', () => {
    expect(RIVALMOOT_PAVING.endR).toBeLessThanOrEqual(H.topR);
    for (const bearing of [0, 1.3, 2.9, 4.4]) {
      const mid = at((RIVALMOOT_PAVING.fullR + RIVALMOOT_PAVING.endR) / 2, bearing);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(1);
      expect(at(H.topR + 0.5, bearing)).toBe(0);
      expect(at(H.footR, bearing)).toBe(0);
    }
  });
});
