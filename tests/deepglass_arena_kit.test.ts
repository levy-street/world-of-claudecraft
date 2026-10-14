import { describe, expect, it } from 'vitest';
import overrides from '../data/asset_collision_overrides.json';
import { authoredGroundLine, targetHeightFor } from '../src/render/asset_scale';
import {
  DG_BOWL_INNER_R,
  DG_BOWL_OUTER_R,
  DG_BOWL_TOP_Y,
  DG_LANDING_DEPTH,
  DG_ROW_LANDINGS,
  DG_ROW_RUN,
  DG_ROWS,
  dgBowlDeckY,
} from '../src/sim/deepglass/layout';

// The arena kit (scripts/assets/deepglass/bl_dg_arena.py) is the spectator
// bowl as placeable wedges. These pin the three contracts between the Blender
// build and the engine that are silent when they break.

describe('the Deepglass seat rake', () => {
  it('spans the bowl exactly, flat at the lip and full height at the wall', () => {
    expect(dgBowlDeckY(DG_BOWL_INNER_R)).toBe(0);
    expect(dgBowlDeckY(DG_BOWL_INNER_R - 10)).toBe(0);
    expect(dgBowlDeckY(DG_BOWL_OUTER_R)).toBeCloseTo(DG_BOWL_TOP_Y, 6);
    expect(dgBowlDeckY(DG_BOWL_OUTER_R + 40)).toBeCloseTo(DG_BOWL_TOP_Y, 6);
  });

  it('consumes the whole radial run: rows plus landings fill the bowl', () => {
    const run = DG_ROWS * DG_ROW_RUN + DG_ROW_LANDINGS.length * DG_LANDING_DEPTH;
    expect(run).toBeCloseTo(DG_BOWL_OUTER_R - DG_BOWL_INNER_R, 6);
  });

  it('never steps down, and never steps up by more than one row', () => {
    const rise = DG_BOWL_TOP_Y / DG_ROWS;
    let prev = 0;
    for (let r = DG_BOWL_INNER_R; r <= DG_BOWL_OUTER_R; r += 0.05) {
      const y = dgBowlDeckY(r);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y - prev).toBeLessThanOrEqual(rise + 1e-9);
      prev = y;
    }
  });

  it('holds height across a landing', () => {
    // the first cross-gangway starts where row 12 would have
    const at = DG_BOWL_INNER_R + DG_ROW_LANDINGS[0] * DG_ROW_RUN;
    expect(dgBowlDeckY(at + 0.1)).toBeCloseTo(dgBowlDeckY(at + DG_LANDING_DEPTH - 0.1), 6);
  });
});

describe('the arena kit assets', () => {
  const PIECES = [
    'arena_stand',
    'arena_stand_vom',
    'arena_gatehouse',
    'arena_concourse',
    'arena_canopy',
    'arena_brazier',
    'arena_banner',
    'arena_box',
    'arena_scoreboard',
    'arena_pennant',
    'arena_causeway',
    'arena_floor',
    'arena_floor_gate',
    'arena_floor_core',
  ];

  it('is authored in yards: scale 1 is as built', () => {
    // targetHeightFor must carry each piece's own max dimension, or the
    // loader normalizes it to the 2.2 yd prop height and a 39-yd wedge
    // arrives doll-sized.
    for (const tag of PIECES) {
      const h = targetHeightFor(`/models/deepglass/${tag}.glb`);
      expect(h, tag).toBeGreaterThan(5);
    }
  });

  it('seats on its origin, not its bounding box', () => {
    // the wedges bury a base course 2.2 yd below the floor plane
    for (const tag of PIECES) {
      expect(authoredGroundLine(`/models/deepglass/${tag}.glb`), tag).toBe(0);
    }
  });

  it('ships authored collision, not a voxel bake', () => {
    // A bake seals the arcade and turns the rake into a wall, so every piece
    // carries hand-authored boxes and walkable decks.
    for (const tag of PIECES) {
      const o = (overrides as Record<string, { boxes?: unknown[]; ramps?: unknown[] }>)[
        `deepglass/${tag}`
      ];
      expect(o, tag).toBeTruthy();
      expect((o.boxes?.length ?? 0) + (o.ramps?.length ?? 0), tag).toBeGreaterThan(0);
    }
  });

  it('gives the seating walkable decks and the arcade a way through', () => {
    const stand = overrides['deepglass/arena_stand'];
    // one deck per rake band: a solid box there would wall the bowl off
    expect(stand.ramps?.length ?? 0).toBeGreaterThanOrEqual(8);
    // and the facade's boxes must leave the three ground arches open
    expect(stand.boxes.length).toBeLessThan(24);
  });
});

// v2 (2026-09-25): the gate, the floor and the vomitories. These pin the
// collision contracts the live walk probes verified, in the override frame
// the sim reads (glTF: +X outward along the piece's own radius, y up).
type Deck = { x: number; z: number; hx: number; hz: number; y0: number; y1: number; ry?: number };
type Box = { x: number; y: number; z: number; hx: number; hy: number; hz: number; ry?: number };
const O = overrides as unknown as Record<string, { boxes: Box[]; ramps?: Deck[] }>;
/** The bowl wedges' own origin radius (bl_dg_arena.py RMID). */
const RMID = (DG_BOWL_INNER_R + DG_BOWL_OUTER_R) / 2;
const FLOOR = 0.4;
const BRIDGE_DECK = 6;

/** Heights of every deck under the override-frame point (x, z). A deck's
 *  local +X is (cos ry, -sin ry) in that frame (colliders.ts), and its floor
 *  rises from y0 at its -X end to y1 at its +X end. */
function deckAt(decks: Deck[], x: number, z = 0): number[] {
  const out: number[] = [];
  for (const d of decks) {
    const ry = d.ry ?? 0;
    const dx = x - d.x;
    const dz = z - d.z;
    const lx = dx * Math.cos(ry) - dz * Math.sin(ry);
    const lz = dx * Math.sin(ry) + dz * Math.cos(ry);
    if (Math.abs(lx) > d.hx + 1e-6 || Math.abs(lz) > d.hz + 1e-6) continue;
    const u = (lx + d.hx) / (2 * d.hx);
    out.push(d.y0 + (d.y1 - d.y0) * u);
  }
  return out;
}

/** The line a seated body's feet ride (bl_dg_arena.py rake_mid): through the
 *  middle of every row's tread along a run of rows, level across a landing. */
function rakeMid(r: number): number {
  const rise = DG_BOWL_TOP_Y / DG_ROWS;
  const treadMid = (DG_ROW_RUN - 0.42) / 2;
  let rr = DG_BOWL_INNER_R;
  let z = 0;
  let start = rr;
  let zs = 0;
  for (let i = 0; i < DG_ROWS; i++) {
    if (DG_ROW_LANDINGS.includes(i)) {
      if (r <= rr + 1e-9) return zs + (r - start - treadMid) * (rise / DG_ROW_RUN);
      if (r <= rr + DG_LANDING_DEPTH + 1e-9) return z;
      rr += DG_LANDING_DEPTH;
      start = rr;
      zs = z;
    }
    rr += DG_ROW_RUN;
    z += rise;
  }
  return zs + (r - start - treadMid) * (rise / DG_ROW_RUN);
}

describe('the v2 gatehouse', () => {
  const gate = O['deepglass/arena_gatehouse'];

  it('carries an unbroken walking line from the arena floor to the bridge deck', () => {
    // every 0.1 yd along the centre line, from the floor's edge to past the
    // bridge's first span, there is a deck under the feet ...
    // (the floor wedge paves up to r 63.9; the gate carries on from there)
    let prev = FLOOR;
    for (let r = 63.9; r <= 104.4; r += 0.1) {
      const hs = deckAt(gate.ramps ?? [], r - RMID);
      expect(hs.length, `no deck at r ${r.toFixed(1)}`).toBeGreaterThan(0);
      const h = Math.max(...hs);
      // ... and it never steps by more than one stair riser between samples
      expect(Math.abs(h - prev), `step at r ${r.toFixed(1)}`).toBeLessThan(0.33);
      prev = h;
    }
    expect(prev).toBeCloseTo(BRIDGE_DECK, 6);
  });

  it('leaves the centre line clear of every box up to head height', () => {
    for (const b of gate.boxes) {
      if (b.ry) continue;
      const blocksAxis = Math.abs(b.z) < b.hz + 0.5;
      const low = b.y - b.hy < BRIDGE_DECK + 2.2;
      const inRun = b.x + b.hx > DG_BOWL_INNER_R - RMID && b.x - b.hx < 104.8 - RMID;
      expect(blocksAxis && low && inRun, `box at x ${b.x} z ${b.z}`).toBe(false);
    }
  });

  it('stays inside the Collision Master caps', () => {
    expect(gate.boxes.length).toBeLessThanOrEqual(64);
    expect((gate.ramps ?? []).length).toBeLessThanOrEqual(24);
  });
});

describe('the v2 vomitory', () => {
  it('runs from the arena floor through to the ambulatory at floor height', () => {
    const vom = O['deepglass/arena_stand_vom'];
    // the ambulatory's back wall: facade inner face (R_OUT - 2.4) minus 5.2
    const rAmb = DG_BOWL_OUTER_R - 2.4 - 5.2;
    const passage = (vom.ramps ?? []).find(
      (d) =>
        Math.abs(d.z) < 1e-6 &&
        d.y0 === FLOOR &&
        d.y1 === FLOOR &&
        d.x - d.hx <= DG_BOWL_INNER_R - RMID + 1e-3,
    );
    expect(passage).toBeTruthy();
    expect((passage as Deck).x + (passage as Deck).hx).toBeGreaterThanOrEqual(rAmb - RMID - 1e-3);
  });
});

describe('the v2 floor', () => {
  it('paves the disc at one height, the tide channel a quarter-yard down', () => {
    const wedge = O['deepglass/arena_floor'].ramps ?? [];
    const gate = O['deepglass/arena_floor_gate'].ramps ?? [];
    const core = O['deepglass/arena_floor_core'].ramps ?? [];
    for (const d of [...wedge, ...gate, ...core]) {
      expect(d.y0).toBe(d.y1);
      expect([FLOOR, 0.15, 0.5]).toContain(d.y0);
    }
    const RF_MID = (3.5 + 63.9) / 2;
    for (let r = 3.5; r <= 63.9; r += 0.25) {
      const hs = deckAt(wedge, r - RF_MID);
      expect(hs.length, `gap at r ${r}`).toBeGreaterThan(0);
      const inChannel = r > 34.35 && r < 36.15;
      expect(Math.max(...hs), `r ${r}`).toBe(inChannel ? 0.15 : FLOOR);
      // the gate's wedge bridges the channel on the processional
      const hg = Math.max(...deckAt(gate, r - RF_MID));
      expect(hg, `gate r ${r}`).toBe(
        r >= 34.0 - 1e-6 && r <= 36.5 + 1e-6 ? 0.5 : inChannel ? 0.15 : FLOOR,
      );
    }
  });
});

describe('the seating decks follow the ring', () => {
  it('hold a seated body on the stone at every angle, seam to seam', () => {
    // v1 and v2 laid straight decks along each wedge's centre line, which
    // read the rake at the wrong radius off that line: a body at a seam sat a
    // yard inside the seats. The slices keep it within a third of a yard.
    for (const tag of ['arena_stand', 'arena_stand_vom']) {
      const ramps = O[`deepglass/${tag}`].ramps ?? [];
      let n = 0;
      let sum = 0;
      for (let r = 64.6; r <= 96.5; r += 0.37) {
        for (let deg = -11.2; deg <= 11.21; deg += 0.8) {
          const a = (deg * Math.PI) / 180;
          const bx = r * Math.cos(a) - RMID;
          const by = r * Math.sin(a);
          // the gangway rides a riser above the seats; a vom's slot is open
          if (Math.abs(by) < 1.5) continue;
          if (tag === 'arena_stand_vom' && Math.abs(by) < 3.4 && r < 73.2) continue;
          const hs = deckAt(ramps, bx, -by);
          expect(
            hs.length,
            `${tag}: no deck at r ${r.toFixed(2)} ${deg.toFixed(1)} deg`,
          ).toBeGreaterThan(0);
          const err = Math.abs(Math.max(...hs) - rakeMid(r));
          expect(err, `${tag}: r ${r.toFixed(2)} ${deg.toFixed(1)} deg`).toBeLessThan(0.4);
          sum += err;
          n++;
        }
      }
      expect(sum / n, `${tag}: mean error`).toBeLessThan(0.12);
    }
  });
});
