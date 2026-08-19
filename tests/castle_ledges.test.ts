// The castles' parkour shelves have to be REACHABLE, and reachable is a
// narrow thing: the engine gives a body two ways up onto a standable top and
// leaves a gap between them.
//
//   VAULT  up to jump apex + MANTLE_REACH
//   CLIMB  CLIMB_MIN_OVERHEAD up to LEDGE_GRAB_MAX above the feet
//
// A shelf authored between those two bands can be neither jumped onto nor
// grabbed, and nothing in the game says so: the player just bounces off it.
// This pins every authored shelf into one band or the other, and pins the
// chain, so a second shelf is always reachable from the first rather than
// from the floor it is far too high above.
//
// It also pins the thing that made the whole feature inert before: the
// castle interiors emitted ZERO standable colliders, so supportHeightAt
// answered -Infinity everywhere inside and both systems had nothing to read.
import { describe, expect, it } from 'vitest';
import { CASTLE, CASTLE_WALL_LEDGES } from '../src/sim/castle_layout';
import { CLIMB_MIN_OVERHEAD } from '../src/sim/climb';
import { MANTLE_REACH } from '../src/sim/colliders';
import { DUNGEON_FLOOR_Y } from '../src/sim/data';
import { DAWNHOLD, DAWNHOLD_WALL_LEDGES } from '../src/sim/dawnhold_layout';
import {
  DAWNHOLD_LAYOUT,
  DAWNHOLD_LEDGES,
  LASTKEEP_LAYOUT,
  LASTKEEP_LEDGES,
  layoutColliders,
} from '../src/sim/dungeon_layout';
import { LEDGE_GRAB_MAX } from '../src/sim/physics/ledge';
import { GRAVITY, JUMP_VELOCITY } from '../src/sim/player_motion';
import { DT } from '../src/sim/types';

// The apex a jump ACTUALLY reaches, stepped at the sim's fixed tick rather
// than the continuous v^2/2g: the body is sampled once per tick, so the
// highest sampled height is what a mantle can seat from.
const jumpApex = (): number => {
  let y = 0;
  let vy = JUMP_VELOCITY;
  let best = 0;
  for (let i = 0; i < 64 && (vy > 0 || y > 0); i++) {
    vy -= GRAVITY * DT;
    y += vy * DT;
    best = Math.max(best, y);
  }
  return best;
};
const VAULT_MAX = jumpApex() + MANTLE_REACH;

const CASTLES = [
  { id: 'lastkeep', ledges: LASTKEEP_LEDGES, layout: LASTKEEP_LAYOUT },
  { id: 'dawnhold', ledges: DAWNHOLD_LEDGES, layout: DAWNHOLD_LAYOUT },
] as const;

// The OUTSIDE chains: absolute shelf heights climbing each curtain from the
// bailey pad to the wall-walk. Same two bands, but the last rise has to land
// the body on the walk itself, so that step is checked too.
const OUTSIDE = [
  { id: 'lastkeep', ledges: CASTLE_WALL_LEDGES, pad: CASTLE.pad.h, walk: CASTLE.walkAbs },
  { id: 'dawnhold', ledges: DAWNHOLD_WALL_LEDGES, pad: DAWNHOLD.pad.h, walk: DAWNHOLD.walkAbs },
] as const;

describe('castle wall climbing chains', () => {
  it('climbs from the pad to the wall-walk without a dead-band step', () => {
    for (const c of OUTSIDE) {
      const tops = [...c.ledges].map((l) => l.top).sort((a, b) => a - b);
      expect(tops.length, `${c.id} has an outside chain`).toBeGreaterThan(0);
      // every rung, from the pad up through the shelves and onto the walk
      const rungs = [c.pad, ...tops, c.walk];
      for (let i = 1; i < rungs.length; i++) {
        const rise = rungs[i] - rungs[i - 1];
        const vaultable = rise > 0 && rise <= VAULT_MAX;
        const climbable = rise >= CLIMB_MIN_OVERHEAD && rise <= LEDGE_GRAB_MAX;
        expect(
          vaultable || climbable,
          `${c.id} rung ${i} rises ${rise.toFixed(2)} (from ${rungs[i - 1]} to ${rungs[i]}) ` +
            `into the dead band, vault up to ${VAULT_MAX.toFixed(2)}, ` +
            `climb ${CLIMB_MIN_OVERHEAD} to ${LEDGE_GRAB_MAX}`,
        ).toBe(true);
      }
      // the chain really does end ON the walk, not short of it
      expect(tops[tops.length - 1], `${c.id} tops out under the walk`).toBeLessThan(c.walk);
    }
  });

  it('corbels every outside shelf onto its own curtain', () => {
    // A shelf is a corbel: its inner face sits ON the wall's outer face, and
    // its body protrudes outward far enough to stand on. Both halves matter.
    // Standing one OFF the wall (the first cut did) leaves a strip of ground
    // behind it walled by the curtain riser on one side and the shelf's
    // collider on the other, too narrow for a body to turn around in. The
    // curtain is TERRAIN, so it never pushes a body away by its radius the way
    // a collider does: the shelf has to reach the stone itself, not stop a
    // body's width short of it.
    // The inner face is bounded on BOTH sides: it must reach the stone, and it
    // must not pass through it. A shelf that spans the whole wall strip would
    // satisfy "reaches the stone" while becoming a standable bridge out over
    // the bailey side, which no shelf may be.
    const REACH = 1.0; // usable shelf outside the wall face
    const keepFace = CASTLE.wx1 + CASTLE.wallTh / 2;
    for (const l of CASTLE_WALL_LEDGES) {
      const at = `Last Keep shelf at (${l.x},${l.z})`;
      expect(l.x - l.hw, `${at} stands off the curtain`).toBeLessThanOrEqual(keepFace);
      expect(l.x - l.hw, `${at} reaches through the curtain`).toBeGreaterThan(
        keepFace - CASTLE.wallTh,
      );
      expect(l.x + l.hw, `${at} is buried in the curtain`).toBeGreaterThan(keepFace + REACH);
    }
    const dawnFace = DAWNHOLD.wz0 - DAWNHOLD.wallTh / 2;
    for (const l of DAWNHOLD_WALL_LEDGES) {
      const at = `Dawnhold shelf at (${l.x},${l.z})`;
      expect(l.z + l.hd, `${at} stands off the curtain`).toBeGreaterThanOrEqual(dawnFace);
      expect(l.z + l.hd, `${at} reaches through the curtain`).toBeLessThan(
        dawnFace + DAWNHOLD.wallTh,
      );
      expect(l.z - l.hd, `${at} is buried in the curtain`).toBeLessThan(dawnFace - REACH);
    }
  });
});

describe('castle parkour ledges', () => {
  it('gives both castle interiors standable tops at all', () => {
    for (const c of CASTLES) {
      const standable = layoutColliders(c.layout, undefined, DUNGEON_FLOOR_Y).filter(
        (q) => 'standable' in q && q.standable,
      );
      expect(standable.length, `${c.id} standable tops`).toBe(c.ledges.length);
      expect(standable.length, `${c.id} has parkour geometry`).toBeGreaterThan(0);
      for (const s of standable) {
        expect(s.moveTopY, `${c.id} shelf carries a real top`).toBeGreaterThan(DUNGEON_FLOOR_Y);
      }
    }
  });

  it('never leaves a shelf a dead-band rise above what supports it', () => {
    // the gap the engine can cross neither way: too high to jump onto, too
    // low for the climb to arm
    expect(CLIMB_MIN_OVERHEAD).toBeGreaterThan(VAULT_MAX);
    for (const c of CASTLES) {
      for (const l of c.ledges) {
        // The highest surface a body could be standing on when it goes for
        // this shelf: a lower shelf within arm's reach, a SAME-height shelf
        // close enough to run and jump from (no rise at all then), else the
        // room floor.
        let support = 0;
        for (const q of c.ledges) {
          if (q === l || q.top > l.top) continue;
          const gap = Math.hypot(
            Math.max(0, Math.abs(l.x - q.x) - (l.hw + q.hw)),
            Math.max(0, Math.abs(l.z - q.z) - (l.hd + q.hd)),
          );
          const sameHeight = Math.abs(q.top - l.top) < 0.01;
          if (sameHeight ? gap <= 4.0 : gap <= 2.5) support = Math.max(support, q.top);
        }
        const rise = l.top - support;
        const vaultable = rise <= VAULT_MAX;
        const climbable = rise >= CLIMB_MIN_OVERHEAD && rise <= LEDGE_GRAB_MAX;
        expect(
          vaultable || climbable,
          `${c.id} shelf at (${l.x},${l.z}) rises ${rise.toFixed(2)} over its support ` +
            `(vault up to ${VAULT_MAX.toFixed(2)}, climb ${CLIMB_MIN_OVERHEAD} to ${LEDGE_GRAB_MAX})`,
        ).toBe(true);
      }
    }
  });

  it('reaches every shelf from the floor, by vault, climb, or a flat jump', () => {
    // edge-to-edge horizontal gap between two shelves
    const gapBetween = (
      a: { x: number; z: number; hw: number; hd: number },
      b: { x: number; z: number; hw: number; hd: number },
    ): number =>
      Math.hypot(
        Math.max(0, Math.abs(a.x - b.x) - (a.hw + b.hw)),
        Math.max(0, Math.abs(a.z - b.z) - (a.hd + b.hd)),
      );
    // a run-up jump clears this much flat ground (14 airborne ticks at run
    // speed); kept conservative so the pin does not depend on perfect input
    const FLAT_JUMP = 4.0;
    const REACH_UP = 2.5;
    for (const c of CASTLES) {
      // start from every shelf a body can vault straight off the floor
      const reached = new Set(c.ledges.filter((l) => l.top <= VAULT_MAX));
      for (let pass = 0; pass < c.ledges.length; pass++) {
        for (const l of c.ledges) {
          if (reached.has(l)) continue;
          for (const q of reached) {
            const rise = l.top - q.top;
            const gap = gapBetween(l, q);
            const climbUp = rise >= CLIMB_MIN_OVERHEAD && rise <= LEDGE_GRAB_MAX && gap <= REACH_UP;
            const vaultUp = rise > 0 && rise <= VAULT_MAX && gap <= REACH_UP;
            const acrossFlat = Math.abs(rise) < 0.01 && gap <= FLAT_JUMP;
            if (climbUp || vaultUp || acrossFlat) {
              reached.add(l);
              break;
            }
          }
        }
      }
      for (const l of c.ledges) {
        expect(
          reached.has(l),
          `${c.id} shelf at (${l.x},${l.z}) top ${l.top} is unreachable ` +
            `(vault ceiling ${VAULT_MAX.toFixed(2)}, climb ${CLIMB_MIN_OVERHEAD} to ${LEDGE_GRAB_MAX})`,
        ).toBe(true);
      }
    }
  });

  it('stands every shelf inside a room, clear of the walls', () => {
    for (const c of CASTLES) {
      const rooms = c.layout.rooms ?? [];
      for (const l of c.ledges) {
        const room = rooms.find((r) => l.x > r.x0 && l.x < r.x1 && l.z > r.z0 && l.z < r.z1);
        expect(room, `${c.id} shelf at (${l.x},${l.z}) is outside every room`).toBeDefined();
        if (!room) continue;
        // the shelf may hug a wall but never straddle one
        expect(l.x - l.hw, `${c.id} shelf crosses its room's west wall`).toBeGreaterThanOrEqual(
          room.x0 - 0.01,
        );
        expect(l.x + l.hw, `${c.id} shelf crosses its room's east wall`).toBeLessThanOrEqual(
          room.x1 + 0.01,
        );
        expect(l.z - l.hd, `${c.id} shelf crosses its room's south wall`).toBeGreaterThanOrEqual(
          room.z0 - 0.01,
        );
        expect(l.z + l.hd, `${c.id} shelf crosses its room's north wall`).toBeLessThanOrEqual(
          room.z1 + 0.01,
        );
      }
    }
  });
});
