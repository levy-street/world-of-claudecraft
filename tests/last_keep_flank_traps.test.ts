// The Last Keep must never wedge a player. Authored defects put standable
// ground into cracks a body cannot turn around in (player reports: "VERY easy
// to fall in-between the cracks or get stuck underground", one death with the
// corpse left in the gap; later, "if the player walks into the foundation they
// get stuck along the side of the foundation"). The first two were both beside
// the keep:
//   NORTH FLANK: the alley flight's mass stopped at z 1991.3 while the ward's
//   retaining edge starts at 1991.4, leaving a sliver of BAILEY floor under the
//   stair, up to 6.8yd below the tread beside it. Falling in put the player
//   between the drawn stair wedge and the terrace, which reads as underground.
//   WEST FLANK: the keep and the great hall stand 1.2yd apart on the terrace,
//   a corridor narrower than a player can use, and its floor is inside both
//   rendered building masses (the circle colliders are inscribed in square
//   meshes, so the mesh corners overhang walkable ground).
// The regression gate is a REACHABLE-WEDGE scan: every spot a player can walk
// or fall to must sit in a corridor at least a body diameter plus margin wide,
// counting static colliders and unclimbable risers as walls.
import { describe, expect, it } from 'vitest';
import { CASTLE, CASTLE_RAMPS, WARD_STEPS } from '../src/sim/castle_layout';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import { DUNGEONS } from '../src/sim/data';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { rideSteepnessAt } from '../src/sim/ride_height';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

// the live world seed: the reports are seed-pinned castle geometry
const SEED = 20061;

// The WHOLE castle: barbican forecourt, bailey, ward, and a skirt outside
// every curtain. It started as the ward and its two flanks, but the defect is
// not local to the keep: every mass here collides as a circle (or a straight
// stair riser), so any two that come within a body diameter leave a tapering
// alley, and the second sweep over the full grounds found fifteen more of them
// out in the bailey, behind the market stalls and the east wall's climbing
// shelves. Scanning the ward alone would have called that clean.
const RECT = { x0: 348, x1: 452, z0: 1982, z1: 2080 };
const TICK_STEP = 0.35; // one movement tick of run at RUN_SPEED 7
const FINE = 0.1; // corridor-width sampling
const WALL_RISE = 1.5; // ground this much higher within reach is a wall face
const LOOK = 1.5; // how far to look for the facing wall
const MIN_CORRIDOR = 1.4; // player diameter 1.0 plus a 0.4 margin

interface Wedge {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  width: number;
  samples: number;
}

/**
 * Ground a player can stand on and actually get to (walking in or dropping in
 * from anywhere in the rect), whose free corridor is narrower than a body.
 * Reachability runs the real gates: the climb limit, the standing-steepness
 * limit, and the collider slide, on a one-tick lattice.
 */
function reachableWedges(): Wedge[] {
  const gnx = Math.round((RECT.x1 - RECT.x0) / TICK_STEP) + 1;
  const gnz = Math.round((RECT.z1 - RECT.z0) / TICK_STEP) + 1;
  const gh = new Float64Array(gnx * gnz);
  const gsteep = new Float64Array(gnx * gnz);
  const gstand = new Uint8Array(gnx * gnz);
  for (let i = 0; i < gnx; i++) {
    for (let j = 0; j < gnz; j++) {
      const x = RECT.x0 + i * TICK_STEP;
      const z = RECT.z0 + j * TICK_STEP;
      const k = i * gnz + j;
      gh[k] = groundHeight(x, z, SEED);
      gsteep[k] = rideSteepnessAt(x, z, SEED);
      gstand[k] =
        gsteep[k] <= PLAYER_MAX_CLIMB_SLOPE && !isBlocked(SEED, x, z, PLAYER_BODY_RADIUS) ? 1 : 0;
    }
  }
  const neigh = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;
  // seed from the rect rim (open bailey and open waste on every side), then
  // flood along every legal one-tick step
  const reached = new Uint8Array(gnx * gnz);
  const queue: number[] = [];
  for (let i = 0; i < gnx; i++) {
    for (let j = 0; j < gnz; j++) {
      const k = i * gnz + j;
      if (!gstand[k] || (i > 0 && j > 0 && i < gnx - 1 && j < gnz - 1)) continue;
      reached[k] = 1;
      queue.push(k);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const i = Math.floor(k / gnz);
    const j = k % gnz;
    for (const [di, dj] of neigh) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= gnx || nj >= gnz) continue;
      const nk = ni * gnz + nj;
      if (reached[nk] || !gstand[nk]) continue;
      const x = RECT.x0 + i * TICK_STEP;
      const z = RECT.z0 + j * TICK_STEP;
      const nx = RECT.x0 + ni * TICK_STEP;
      const nz = RECT.z0 + nj * TICK_STEP;
      const run = Math.hypot(nx - x, nz - z);
      const rise = gh[nk] - gh[k];
      if (
        rise > 0 &&
        (rise / run > PLAYER_MAX_CLIMB_SLOPE || gsteep[nk] > PLAYER_MAX_CLIMB_SLOPE)
      ) {
        continue;
      }
      const res = resolveMovement(SEED, x, z, nx, nz, PLAYER_BODY_RADIUS);
      if (Math.hypot(res.x - nx, res.z - nz) > TICK_STEP * 0.5) continue;
      reached[nk] = 1;
      queue.push(nk);
    }
  }
  const canReach = (x: number, z: number): boolean => {
    const i = Math.round((x - RECT.x0) / TICK_STEP);
    const j = Math.round((z - RECT.z0) / TICK_STEP);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= gnx || nj >= gnz) continue;
        if (reached[ni * gnz + nj]) return true;
      }
    }
    return false;
  };

  // fine geometry pass: corridor width on each axis, colliders and risers both
  const nx = Math.round((RECT.x1 - RECT.x0) / FINE) + 1;
  const nz = Math.round((RECT.z1 - RECT.z0) / FINE) + 1;
  const h = new Float64Array(nx * nz);
  const wall = new Uint8Array(nx * nz);
  const stand = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = RECT.x0 + i * FINE;
      const z = RECT.z0 + j * FINE;
      const k = i * nz + j;
      h[k] = groundHeight(x, z, SEED);
      wall[k] = isBlocked(SEED, x, z, PLAYER_BODY_RADIUS) ? 1 : 0;
      stand[k] = !wall[k] && rideSteepnessAt(x, z, SEED) <= PLAYER_MAX_CLIMB_SLOPE ? 1 : 0;
    }
  }
  const look = Math.round(LOOK / FINE);
  const hits = new Map<number, number>(); // fine index -> corridor width
  for (let i = look; i < nx - look; i++) {
    for (let j = look; j < nz - look; j++) {
      const k = i * nz + j;
      if (!stand[k]) continue;
      let width = Infinity;
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ] as const) {
        let ahead = -1;
        let behind = -1;
        for (let n = 1; n <= look; n++) {
          const kp = (i + dx * n) * nz + (j + dz * n);
          const km = (i - dx * n) * nz + (j - dz * n);
          if (ahead < 0 && (wall[kp] || h[kp] >= h[k] + WALL_RISE)) ahead = n;
          if (behind < 0 && (wall[km] || h[km] >= h[k] + WALL_RISE)) behind = n;
        }
        if (ahead > 0 && behind > 0) width = Math.min(width, (ahead + behind) * FINE);
      }
      if (width >= MIN_CORRIDOR) continue;
      if (!canReach(RECT.x0 + i * FINE, RECT.z0 + j * FINE)) continue;
      hits.set(k, width);
    }
  }

  // cluster the hits so a failure names each pocket once
  const out: Wedge[] = [];
  const seen = new Set<number>();
  for (const start of hits.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    const w: Wedge = {
      x0: Infinity,
      x1: -Infinity,
      z0: Infinity,
      z1: -Infinity,
      width: Infinity,
      samples: 0,
    };
    while (stack.length > 0) {
      const k = stack.pop() as number;
      const i = Math.floor(k / nz);
      const j = k % nz;
      w.x0 = Math.min(w.x0, RECT.x0 + i * FINE);
      w.x1 = Math.max(w.x1, RECT.x0 + i * FINE);
      w.z0 = Math.min(w.z0, RECT.z0 + j * FINE);
      w.z1 = Math.max(w.z1, RECT.z0 + j * FINE);
      w.width = Math.min(w.width, hits.get(k) as number);
      w.samples++;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const nk = (i + di) * nz + (j + dj);
          if (!hits.has(nk) || seen.has(nk)) continue;
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    out.push(w);
  }
  return out.sort((a, b) => b.samples - a.samples);
}

function describeWedges(list: Wedge[]): string {
  return list
    .map(
      (w) =>
        `x ${w.x0.toFixed(1)}..${w.x1.toFixed(1)} z ${w.z0.toFixed(1)}..${w.z1.toFixed(1)} ` +
        `corridor ${w.width.toFixed(2)}yd (${w.samples} samples)`,
    )
    .join('; ');
}

function makeWalker(spot: { x: number; z: number }) {
  // The Last Keep's grounds are the documented zero-combat keep (no camp,
  // npc, or ground object sits anywhere near the ward): terrain and colliders
  // read the module-level BUILTIN_WORLD regardless of this Sim's `world`
  // option (data.ts getActiveWorldContent), so an empty ambient world cannot
  // change the physics this file exercises.
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const meta = (
    sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
  ).players.get((sim as unknown as { playerId: number }).playerId);
  if (!meta) throw new Error('no meta');
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.pos.y = groundHeight(spot.x, spot.z, SEED) + 0.05;
  p.prevPos = { ...p.pos };
  for (let i = 0; i < 40; i++) {
    p.hp = p.maxHp;
    sim.tick();
  }
  return { sim, p, meta };
}

interface Walker {
  pos: { x: number; y: number; z: number };
  facing: number;
  hp: number;
  maxHp: number;
  onGround: boolean;
}

/** Drive toward a target, reporting each tick's pose to an optional watcher. */
function pushToward(
  sim: Sim,
  p: Walker,
  meta: { moveInput: { forward: boolean } },
  target: { x: number; z: number },
  ticks: number,
  watch?: (p: Walker) => void,
): boolean {
  let arrived = false;
  for (let i = 0; i < ticks && !arrived; i++) {
    p.facing = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
    meta.moveInput.forward = true;
    p.hp = p.maxHp; // terrain question, not combat
    sim.tick();
    watch?.(p);
    arrived = Math.hypot(target.x - p.pos.x, target.z - p.pos.z) < 1.2;
  }
  meta.moveInput.forward = false;
  return arrived;
}

describe('the Last Keep flanks hold no wedge pockets', () => {
  // A million fine samples over the whole castle, each one a groundHeight, a
  // steepness and a collider query, takes about 15s alone and longer sharing
  // cores with the rest of a run: past the 20s default, so it is spelled out
  // rather than left to flake in a full sweep.
  it('leaves no reachable spot in a corridor narrower than a body', () => {
    const wedges = reachableWedges();
    expect(wedges.length, `wedge pockets: ${describeWedges(wedges)}`).toBe(0);
  }, 120_000);

  it('carries the alley flight onto the ward edge with no bailey sliver under it', () => {
    // the flight's mass must overlap the ward's retaining edge: any dip back to
    // the bailey floor between them is the crack players fell into
    const flight = CASTLE_RAMPS[2];
    expect(flight.axis, 'the alley flight is the third authored ramp').toBe('x');
    expect(flight.b1, 'the flight band must reach past the ward edge').toBeGreaterThanOrEqual(
      CASTLE.ward.z0,
    );
    for (let x = 418; x <= CASTLE.ward.x1; x += 0.2) {
      for (let z = 1991.3; z <= CASTLE.ward.z0 + 0.7; z += 0.05) {
        expect(
          groundHeight(x, z, SEED),
          `sliver of bailey floor under the alley flight at (${x.toFixed(1)}, ${z.toFixed(2)})`,
        ).toBeGreaterThan(CASTLE.pad.h + 1.2);
      }
    }
  });

  it('stops a walker pushed off the flight and out of the keep/hall slot', () => {
    // pushed south off the alley flight: the walker rides the stair mass or the
    // terrace, and never comes down onto the bailey floor beside them (the old
    // crack), and can still walk out west into the open alley afterwards
    {
      const { sim, p, meta } = makeWalker({ x: 428, z: 1990.2 });
      let crackTicks = 0;
      pushToward(sim, p, meta, { x: 428, z: 1996 }, 20 * 8, (w) => {
        const inBand = w.pos.z > 1991.2 && w.pos.z < CASTLE.ward.z0 + 0.9;
        const beside = w.pos.x > 418 && w.pos.x < CASTLE.ward.x1;
        if (w.onGround && inBand && beside && w.pos.y < CASTLE.pad.h + 1.2) crackTicks++;
      });
      expect(crackTicks, 'stood in the crack beside the alley flight').toBe(0);
      expect(
        pushToward(sim, p, meta, { x: 404, z: 1990.3 }, 20 * 20),
        'walks out west into the open alley',
      ).toBe(true);
    }
    // There is no keep/hall slot to be held out of any more. The great hall
    // moved down into the bailey and the barracks wing that replaced it now
    // stands clear of the keep, so the ground between them is a 2.3yd passage
    // across the terrace. Assert it is genuinely walkable end to end, in both
    // directions, since a slot that reads as a corridor but is not one is the
    // defect this whole file exists to catch.
    {
      const { sim, p, meta } = makeWalker({ x: 412, z: 2010 });
      expect(
        pushToward(sim, p, meta, { x: 412, z: 1994 }, 20 * 10),
        'walks north through the terrace passage',
      ).toBe(true);
    }
    {
      const { sim, p, meta } = makeWalker({ x: 412, z: 1994 });
      expect(
        pushToward(sim, p, meta, { x: 412, z: 2010 }, 20 * 10),
        'walks south through the terrace passage',
      ).toBe(true);
    }
    // ...and driven west along the alley flight's foot, where the flight's
    // side and the keep's arc close on each other to nothing
    {
      const { sim, p, meta } = makeWalker({ x: 430.5, z: 1994.4 });
      pushToward(sim, p, meta, { x: 424, z: 1994.4 }, 20 * 6);
      expect(p.pos.x, 'held east of the flight slot').toBeGreaterThan(428.1);
    }
  });

  it('lets a body pushed OUT of any castle mass walk away from where it lands', () => {
    // The wedge scan above cannot see this failure, by construction. Where two
    // masses both push a body and their standoffs overlap, the push vectors
    // CANCEL: isBlocked reports that ground free (net displacement is zero) and
    // the flood fill cannot walk in, so the scan files it as unreachable and
    // skips it. A body put there by depenetration is held solid.
    //
    // That is not hypothetical. A blocker laid across the keep's facade to
    // close the door-jamb slivers reached 0.85yd (its OBB pad plus a body
    // radius), not the 0.5 a bare segment suggests, which put its standoff
    // north of the keep circle's own. The keep's restore path (sim.ts, the
    // branch that deliberately skips findSafePos) drops a logged-out character
    // at doorPos.z - 4, INSIDE the circle; the circle pushed them south onto
    // the blocker and they could not move in any direction. So: every spot a
    // mass can depenetrate a body into must leave it somewhere it can leave.
    const keepDoor = DUNGEONS.the_last_keep.doorPos;
    const seeds: { at: { x: number; z: number }; what: string }[] = [
      { at: { x: keepDoor.x, z: keepDoor.z - 4 }, what: 'the keep instance-restore point' },
      { at: { x: 419.5, z: 2009 }, what: 'inside the keep, west of the door axis' },
      { at: { x: 422.5, z: 2009 }, what: 'inside the keep, east of the door axis' },
      { at: { x: 413, z: 1996.5 }, what: 'the terrace passage beside the keep' },
      { at: { x: 403.5, z: 2001.5 }, what: 'the ward barracks wing core' },
      { at: { x: 427, z: 1995 }, what: 'the keep arc beside the alley flight' },
      { at: { x: 421, z: 2001.5 }, what: 'the keep core' },
      { at: { x: 371, z: 2022.5 }, what: 'the blacksmith core' },
      { at: { x: 384, z: 2061 }, what: 'the west barracks core' },
    ];
    for (const s of seeds) {
      const { sim, p, meta } = makeWalker(s.at);
      const from = { x: p.pos.x, z: p.pos.z };
      let best = 0;
      for (const [dx, dz] of [
        [0, 12],
        [0, -12],
        [12, 0],
        [-12, 0],
      ] as const) {
        pushToward(sim, p, meta, { x: from.x + dx, z: from.z + dz }, 20 * 4);
        // past the dungeon threshold means it walked into the keep's door,
        // which is leaving under its own power, not being stuck
        if (Math.abs(p.pos.x) > 1000) {
          best = Infinity;
          break;
        }
        best = Math.max(best, Math.hypot(p.pos.x - from.x, p.pos.z - from.z));
        p.pos.x = from.x;
        p.pos.z = from.z;
        p.prevPos = { ...p.pos };
      }
      expect(best, `held solid after being pushed out of ${s.what}`).toBeGreaterThan(1);
    }
  });

  it('keeps the ward routes open: the alley flight, the ward step, the keep door', () => {
    // the alley flight still climbs east to the NE walk
    {
      const { sim, p, meta } = makeWalker({ x: 416, z: 1990.2 });
      pushToward(sim, p, meta, { x: 433, z: 1990.2 }, 20 * 12);
      expect(p.pos.x, 'climbs the flight').toBeGreaterThan(431);
      expect(p.pos.y, 'reaches the wall walk').toBeGreaterThan(CASTLE.walkAbs - 0.6);
    }
    // the grand ward stair still climbs the terrace (one broad processional
    // cut on the keep's door axis now, not the pair of narrow west flights)
    {
      const mid = (WARD_STEPS[0].x0 + WARD_STEPS[0].x1) / 2;
      const { sim, p, meta } = makeWalker({ x: mid, z: 2026 });
      pushToward(sim, p, meta, { x: mid, z: 2016 }, 20 * 12);
      expect(p.pos.z, 'on the terrace').toBeLessThan(2018);
      expect(p.pos.y, 'at terrace height').toBeGreaterThan(CASTLE.ward.h - 0.4);
    }
    // the terrace east of the keep still carries traffic to the north yard
    {
      const { sim, p, meta } = makeWalker({ x: 431.2, z: 2014 });
      pushToward(sim, p, meta, { x: 431.2, z: 1995 }, 20 * 12);
      expect(p.pos.z, 'rounds the keep to the north yard').toBeLessThan(1997);
      expect(p.pos.y, 'stays on the terrace').toBeGreaterThan(CASTLE.ward.h - 0.4);
    }
  });

  it('never freezes a walker pressed into the ward terrace retaining edge', () => {
    // The ward terrace's faces are sheer 2.6yd risers. The steepness gate reads
    // a 1-yard-cell memo, so the flat bailey ground one step out from the west
    // face inherits the cell's slope and reads as steep. That alone used to strip
    // movement control while the exact-position downhill was flat (nothing to
    // slide off), trapping the body at the base with input disabled: players were
    // stuck all along the west edge and had to /unstuck. A walker pressed into
    // the edge must be REFUSED the climb yet still free to walk back off it.
    for (const z of [2000, 2005, 2010, 2015]) {
      const { sim, p, meta } = makeWalker({ x: 395, z });
      pushToward(sim, p, meta, { x: 404, z }, 20 * 3); // press east into the face
      const pinnedX = p.pos.x;
      const pinnedZ = p.pos.z;
      expect(pinnedX, `refused the sheer west face at z=${z}`).toBeLessThan(CASTLE.ward.x0);
      // Walk back off the edge. At z=2015 the great hall stands in the bailey
      // just west of the face (hexrTownhall at 390, 2016, colliding as the
      // rectangle it is drawn as), so due west is honest stone, not a freeze:
      // the escape there rounds the hall through the alley between its east
      // face and the terrace, which the walkable-alley sweep below keeps open.
      const escapeTo = z === 2015 ? { x: 384, z: 2004 } : { x: 384, z };
      pushToward(sim, p, meta, escapeTo, 20 * 3);
      expect(
        Math.hypot(pinnedX - p.pos.x, pinnedZ - p.pos.z),
        `walks back off the west edge instead of freezing at z=${z}`,
      ).toBeGreaterThan(3);
    }
    // The alley between the great hall's east face and the terrace riser is a
    // real lane, not a wedge: a body standing in it walks its full length.
    {
      const { sim, p, meta } = makeWalker({ x: 396.4, z: 2013 });
      pushToward(sim, p, meta, { x: 396.4, z: 2022.5 }, 20 * 6);
      expect(p.pos.z, 'the hall-terrace alley carries through').toBeGreaterThan(2020);
    }
  });
});
