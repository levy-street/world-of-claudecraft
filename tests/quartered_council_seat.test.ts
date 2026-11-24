// The Council's Seat on the Gyre's crown (content/quartered_council_seat.ts): the
// sealed gate at the end of an open lane across the level crown where the path's
// last turn arrives (the four quarter seats that once lined it are gone: they
// stood in the way).

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROP_NATURAL_SIZE } from '../src/render/prop_natural_size.generated';
import { PROP_ASSET_DEFS } from '../src/render/props';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import {
  COUNCIL_BEACON_OFFSET,
  COUNCIL_BEACON_R,
  COUNCIL_BEACON_STOPS,
  COUNCIL_LANE_Z,
  COUNCIL_PLAZA,
  COUNCIL_SEAT_GATE,
  COUNCIL_SEAT_KIT,
  COUNCIL_SEAT_PIECES,
  type CouncilSeatPiece,
  councilBeaconPieces,
  councilSeatDecor,
} from '../src/sim/content/quartered_council_seat';
import { QUARTERED_ISLE_DECOR } from '../src/sim/content/quartered_isle';
import { GYRE_PEAK, gyrePathPoint } from '../src/sim/quartered_landmarks';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = (x: number, z: number): number => terrainHeight(x, z, 0);
const CROWN_Y = GYRE_PEAK.baseY + GYRE_PEAK.rise;

/** A piece's footprint box: centre, half extents in its local axes, and yaw. */
function box(p: CouncilSeatPiece, share = 1) {
  const k = COUNCIL_SEAT_KIT[p.key];
  return {
    x: p.x,
    z: p.z,
    hw: (k.w / 2) * p.scale * share,
    hd: (k.d / 2) * p.scale * share,
    rot: p.rot,
  };
}
type Box = ReturnType<typeof box>;

/** model front is +z; rotation.y = rot turns local (lx, lz) to world. */
function toWorld(b: Box, lx: number, lz: number) {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}
function corners(b: Box) {
  return [
    toWorld(b, -b.hw, -b.hd),
    toWorld(b, b.hw, -b.hd),
    toWorld(b, b.hw, b.hd),
    toWorld(b, -b.hw, b.hd),
  ];
}
/** Separating-axis test for two yawed boxes (a margin grows the first). */
function overlap(a: Box, b: Box, margin = 0): boolean {
  const grown = { ...a, hw: a.hw + margin, hd: a.hd + margin };
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2].map((r) => ({
    x: Math.cos(r),
    z: -Math.sin(r),
  }));
  for (const ax of axes) {
    const proj = (c: { x: number; z: number }[]) => {
      const v = c.map((p) => p.x * ax.x + p.z * ax.z);
      return [Math.min(...v), Math.max(...v)];
    };
    const [a0, a1] = proj(corners(grown));
    const [b0, b1] = proj(corners(b));
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
function inside(b: Box, x: number, z: number, margin = 0): boolean {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= b.hw + margin && Math.abs(lz) <= b.hd + margin;
}
const facing = (p: CouncilSeatPiece) => ({ x: Math.sin(p.rot), z: Math.cos(p.rot) });

describe("the Council's Seat models", () => {
  it('registers every piece in the prop catalogue with its model on disk', () => {
    for (const key of Object.keys(COUNCIL_SEAT_KIT)) {
      const def = PROP_ASSET_DEFS[key];
      expect(def, key).toBeDefined();
      expect(def.url).toMatch(/^\/models\/props\/council_(seat_[a-z]+|beacon|plaza)\.glb$/);
      const file = resolve(__dirname, '../public', def.url.slice(1));
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeGreaterThan(50_000);
    }
  });

  it('sizes every piece from the model it draws, to within a few percent', () => {
    for (const [key, k] of Object.entries(COUNCIL_SEAT_KIT)) {
      const nat = PROP_NATURAL_SIZE[key];
      expect(nat, key).toBeDefined();
      expect(k.w, `${key} width`).toBeCloseTo(nat.x, 1);
      expect(k.d, `${key} depth`).toBeCloseTo(nat.z, 1);
      expect(k.h, `${key} height`).toBeCloseTo(nat.y, 1);
    }
  });
});

describe("the Council's Seat decor", () => {
  const decor = councilSeatDecor();
  // the plaza first, then the crown (the gate), then the beacons up the path
  const plaza = decor[0];
  const crown = decor.slice(1, 1 + COUNCIL_SEAT_PIECES.length);
  const beacons = decor.slice(1 + COUNCIL_SEAT_PIECES.length);

  it('gives every crown piece a collider that is its own box, inside its outline', () => {
    expect(crown.map((d) => d.key)).toEqual(COUNCIL_SEAT_PIECES.map((p) => p.key));
    for (const d of crown) {
      const k = COUNCIL_SEAT_KIT[d.key as keyof typeof COUNCIL_SEAT_KIT];
      const s = d.scale ?? 1;
      expect(d.hw, d.key).toBeGreaterThan(0);
      expect(d.hw, d.key).toBeLessThanOrEqual((k.w / 2) * s);
      expect(d.hd, d.key).toBeGreaterThan(0);
      expect(d.hd, d.key).toBeLessThanOrEqual((k.d / 2) * s);
      expect(d.h, d.key).toBeCloseTo(k.h * s, 1);
      // the clearance circle holds the whole footprint
      expect(d.r, d.key).toBeGreaterThanOrEqual(Math.hypot(d.hw ?? 0, d.hd ?? 0));
    }
  });

  it('is merged into the isle, and the old crystal and rock ring are gone from the crown', () => {
    for (const d of decor) {
      expect(QUARTERED_ISLE_DECOR).toContainEqual(d);
    }
    const nearCrown = QUARTERED_ISLE_DECOR.filter(
      (d) => Math.hypot(d.x - GYRE_PEAK.x, d.z - GYRE_PEAK.z) < 9,
    );
    expect(nearCrown.map((d) => d.key).sort()).toEqual([plaza, ...crown].map((d) => d.key).sort());
    expect(
      QUARTERED_ISLE_DECOR.some((d) => d.key === 'starHeartCrystal' && d.x === GYRE_PEAK.x),
    ).toBe(false);
  });

  it("opts every piece out of terrain calm, so the Gyre's own ground is untouched", () => {
    for (const d of decor) expect(d.terrainCalm, d.key).toBe(false);
  });

  it('seats the plaza flat on the ground: nothing of the disc is buried below its underside', () => {
    // the prop renderer puts every model's lowest point on the ground (props.ts propAsset), so a
    // disc with a buried skirt would stand that skirt's depth above the crown
    const nat = PROP_NATURAL_SIZE.councilPlaza;
    expect(nat.minY).toBeCloseTo(0, 2);
    expect(nat.y).toBeGreaterThan(0.08);
    expect(nat.y).toBeLessThan(0.3);
  });

  it('lays the plaza centred on the crown as walk-through ground, no collider', () => {
    expect(plaza.key).toBe('councilPlaza');
    expect(plaza.x).toBe(COUNCIL_PLAZA.x);
    expect(plaza.z).toBe(COUNCIL_PLAZA.z);
    expect(plaza.rot).toBe(0);
    // no circle or box collider: a player walks across it
    expect(plaza.r).toBeUndefined();
    expect(plaza.hw).toBeUndefined();
    expect(plaza.hd).toBeUndefined();
    expect(plaza.standableTop).toBeUndefined();
    // the disc is the model's own width, on the level crown, under the whole lane
    expect(COUNCIL_PLAZA.radius * 2).toBeCloseTo(COUNCIL_SEAT_KIT.councilPlaza.w, 1);
    for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const x = COUNCIL_PLAZA.x + Math.cos((a * Math.PI) / 4) * COUNCIL_PLAZA.radius;
      const z = COUNCIL_PLAZA.z + Math.sin((a * Math.PI) / 4) * COUNCIL_PLAZA.radius;
      expect(Math.abs(ground(x, z) - CROWN_Y), `rim ${a}`).toBeLessThan(0.6);
    }
  });

  it('puts a beacon with a circle collider and no terrain calm at every stop', () => {
    expect(beacons).toHaveLength(COUNCIL_BEACON_STOPS.length);
    for (const d of beacons) {
      expect(d.key).toBe('councilBeacon');
      expect(d.r).toBe(COUNCIL_BEACON_R);
      expect(d.hw).toBeUndefined();
      expect(d.terrainCalm).toBe(false);
      expect(d.h).toBeCloseTo(COUNCIL_SEAT_KIT.councilBeacon.h, 1);
      // the collider sits inside the plinth
      expect(d.r).toBeLessThanOrEqual(
        Math.min(COUNCIL_SEAT_KIT.councilBeacon.w, COUNCIL_SEAT_KIT.councilBeacon.d) / 2,
      );
    }
  });
});

describe("the Council's Seat beacons", () => {
  const pieces = councilBeaconPieces();
  const peakDist = (x: number, z: number) => Math.hypot(x - GYRE_PEAK.x, z - GYRE_PEAK.z);

  it("stands each on the path's outer lip, leaving most of the walk clear", () => {
    expect(pieces).toHaveLength(COUNCIL_BEACON_STOPS.length);
    for (const b of pieces) {
      const lane = gyrePathPoint(b.t);
      // outboard of the path's centre line by the offset, inside its edge
      expect(peakDist(b.x, b.z) - peakDist(lane.x, lane.z), `t ${b.t}`).toBeCloseTo(
        COUNCIL_BEACON_OFFSET,
        3,
      );
      expect(COUNCIL_BEACON_OFFSET + COUNCIL_BEACON_R).toBeLessThan(GYRE_PEAK.pathW / 2);
      // the walk that remains beside the beacon, from the inner edge to its collider
      expect(
        GYRE_PEAK.pathW / 2 + (COUNCIL_BEACON_OFFSET - COUNCIL_BEACON_R),
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("seats each on the path's own ground", () => {
    for (const b of pieces) {
      const lane = gyrePathPoint(b.t);
      expect(Math.abs(ground(b.x, b.z) - lane.y), `t ${b.t}`).toBeLessThan(1);
    }
  });

  it('spaces the beacons up the climb, none within twenty yards of another', () => {
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const d = Math.hypot(pieces[i].x - pieces[j].x, pieces[i].z - pieces[j].z);
        expect(d, `${pieces[i].t} / ${pieces[j].t}`).toBeGreaterThan(20);
      }
    }
    // the last stands by the way onto the crown
    const last = pieces[pieces.length - 1];
    expect(peakDist(last.x, last.z)).toBeLessThan(16);
  });

  it('turns each face back down the path, toward whoever is climbing', () => {
    for (const b of pieces) {
      const behind = gyrePathPoint(b.t - 0.03);
      const toBehind = { x: behind.x - b.x, z: behind.z - b.z };
      const len = Math.hypot(toBehind.x, toBehind.z);
      const f = { x: Math.sin(b.rot), z: Math.cos(b.rot) };
      expect((f.x * toBehind.x + f.z * toBehind.z) / len, `t ${b.t}`).toBeGreaterThan(0.6);
    }
  });
});

describe("the Council's Seat layout", () => {
  it('stands every footprint on the level crown, within a stride of its height', () => {
    for (const p of COUNCIL_SEAT_PIECES) {
      for (const c of corners(box(p))) {
        expect(Math.abs(ground(c.x, c.z) - CROWN_Y), `${p.key} at ${c.x},${c.z}`).toBeLessThan(0.9);
      }
    }
  });

  it('keeps the pieces apart, with no collider touching another', () => {
    const boxes = COUNCIL_SEAT_PIECES.map((p) => box(p, 0.96));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(
          overlap(boxes[i], boxes[j]),
          `${COUNCIL_SEAT_PIECES[i].key} / ${COUNCIL_SEAT_PIECES[j].key}`,
        ).toBe(false);
      }
    }
  });

  it('leaves the crown open: the gate is its only piece, on the lane axis at the west end', () => {
    expect(COUNCIL_SEAT_PIECES.map((p) => p.key)).toEqual(['councilSeatGate']);
    expect(Object.keys(COUNCIL_SEAT_KIT).filter((k) => k.startsWith('councilSeat'))).toEqual([
      'councilSeatGate',
    ]);
    expect(Math.abs(COUNCIL_SEAT_GATE.z - COUNCIL_LANE_Z)).toBeLessThan(0.5);
    expect(COUNCIL_SEAT_GATE.x).toBeLessThan(COUNCIL_PLAZA.x);
    // nothing else of the isle's decor stands on the crown's level top: no seat, no stone
    for (const d of QUARTERED_ISLE_DECOR) {
      if (Math.hypot(d.x - GYRE_PEAK.x, d.z - GYRE_PEAK.z) > 5.5) continue;
      expect(['councilPlaza', 'councilSeatGate'], `${d.key} at ${d.x},${d.z}`).toContain(d.key);
    }
  });

  it('opens the lane to the path: its end is clear and a straight walk reaches the lane', () => {
    const end = gyrePathPoint(1);
    const boxes = COUNCIL_SEAT_PIECES.map((p) => box(p, 0.96));
    const MOUTH = { x: 6, z: COUNCIL_LANE_Z };
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = end.x + (MOUTH.x - end.x) * t;
      const z = end.z + (MOUTH.z - end.z) * t;
      for (const b of boxes) expect(inside(b, x, z, 0.5), `walk ${i}`).toBe(false);
    }
    // and the lane itself, from its mouth to the gate's steps
    const gate = box(COUNCIL_SEAT_GATE, 0.96);
    for (let x = MOUTH.x; x > toWorld(gate, 0, gate.hd).x + 1; x -= 0.5) {
      for (const b of boxes) expect(inside(b, x, COUNCIL_LANE_Z, 0.5), `lane ${x}`).toBe(false);
    }
  });

  it('faces the gate up the lane toward the path', () => {
    const end = gyrePathPoint(1);
    const f = facing(COUNCIL_SEAT_GATE);
    const toPath = { x: end.x - COUNCIL_SEAT_GATE.x, z: end.z - COUNCIL_SEAT_GATE.z };
    expect(f.x * toPath.x + f.z * toPath.z).toBeGreaterThan(0);
  });
});

describe("the Council's Seat colliders, as a player meets them", () => {
  const R = 0.5; // a player's body
  const walk = (fromX: number, fromZ: number, toX: number, toZ: number) =>
    resolveMovement(WORLD_SEED, fromX, fromZ, toX, toZ, R);
  const gateFront = toWorld(box(COUNCIL_SEAT_GATE), 0, COUNCIL_SEAT_KIT.councilSeatGate.d / 2);

  it('lets a player walk the whole lane from the path to the gate steps', () => {
    const end = walk(7, COUNCIL_LANE_Z, gateFront.x + R + 0.2, COUNCIL_LANE_Z);
    expect(end.x).toBeCloseTo(gateFront.x + R + 0.2, 1);
    expect(end.z).toBeCloseTo(COUNCIL_LANE_Z, 1);
  });

  it('stops a player at the sealed gate, not through it', () => {
    const end = walk(0, COUNCIL_LANE_Z, COUNCIL_SEAT_GATE.x, COUNCIL_LANE_Z);
    expect(end.x).toBeGreaterThan(gateFront.x - 0.1);
  });

  it('walks freely across the open crown: its heart, both sides of the lane and its east rim', () => {
    // the compass rose at the plaza's heart
    expect(isBlocked(WORLD_SEED, COUNCIL_PLAZA.x, COUNCIL_PLAZA.z, R)).toBe(false);
    // the plaza's east rim, where the path steps onto it
    expect(
      isBlocked(WORLD_SEED, COUNCIL_PLAZA.x + COUNCIL_PLAZA.radius - 0.6, COUNCIL_LANE_Z, R),
    ).toBe(false);
    // where the seats stood, either side of the lane: open ground now
    for (const x of [GYRE_PEAK.x + 0.6, GYRE_PEAK.x + 3.4]) {
      for (const dz of [-3.2, 3.2]) {
        expect(isBlocked(WORLD_SEED, x, COUNCIL_LANE_Z + dz, R), `${x},${dz}`).toBe(false);
      }
    }
  });

  it('keeps every beacon solid while the path beside it stays open', () => {
    for (const b of councilBeaconPieces()) {
      expect(isBlocked(WORLD_SEED, b.x, b.z, R), `beacon ${b.t}`).toBe(true);
      const lane = gyrePathPoint(b.t);
      expect(isBlocked(WORLD_SEED, lane.x, lane.z, R), `path at ${b.t}`).toBe(false);
    }
  });
});
