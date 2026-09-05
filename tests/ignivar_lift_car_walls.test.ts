// The Forge-Lift car's side walls are its own kit: the door frames and arch
// beams the owner placed at x +-6.5 / -7.55 and +-8 stand as solid timber
// panels, yet the room shell that actually stops a body sits a yard further
// out (IGNIVAR_LIFT_LAYOUT wallX 10, collider face 9). A rider could walk
// through the panels into the shaft-side sliver behind them and end up
// wedged between the corner pylon and the invisible shell wall, standing
// outside the car's railing (the "stuck at the Forge-Lift corner" report).
// These walks drive the real player motion kernel from the car's entry and
// require every reachable spot to stay INSIDE the timber line, while the
// entry-to-gate crossing that every rider makes stays open.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { IGNIVAR_LIFT_LAYOUT } from '../src/sim/dungeon_layout';
import {
  IGNIVAR_NON_COLLIDING_PROPS,
  IGNIVAR_PROP_NATIVE,
  ignivarLiftPropPlacements,
  ignivarPropColliders,
} from '../src/sim/ignivar_props';
import { IGNIVAR_LIFT_ROOM_ID } from '../src/sim/ignivar_raid_ids';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { type Entity, emptyMoveInput } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

type AnySim = Sim &
  Record<string, unknown> & {
    player: Entity;
    rebucket(e: Entity): void;
    instances: Array<{ dungeonId: string; slot: number }>;
  };

function motionDeps(sim: Sim): PlayerMotionDeps {
  return (sim as unknown as { playerMotionDeps: PlayerMotionDeps }).playerMotionDeps;
}

/** A solo warrior aboard the lift (dev builds admit a lone rider), with the
 *  car's instance origin so walks can be expressed car-local. */
function boardLift(): { sim: AnySim; origin: { x: number; z: number } } {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
  }) as AnySim;
  if (!enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, sim.playerId)) {
    throw new Error('the keep door refused the lift');
  }
  const inst = sim.instances.find(
    (i: { dungeonId: string }) => i.dungeonId === IGNIVAR_LIFT_ROOM_ID,
  );
  if (!inst) throw new Error('no lift claim');
  return { sim, origin: instanceOrigin(DUNGEONS[IGNIVAR_LIFT_ROOM_ID].index, inst.slot) };
}

function placeAt(sim: AnySim, origin: { x: number; z: number }, x: number, z: number): void {
  const p = sim.player;
  p.pos = { x: origin.x + x, y: p.pos.y, z: origin.z + z };
  p.prevPos = { ...p.pos };
  p.onGround = true;
  p.vy = 0;
  sim.rebucket(p);
}

/** Hold forward along `facing` for `ticks`, returning the car-local end. */
function walk(
  sim: AnySim,
  origin: { x: number; z: number },
  facing: number,
  ticks: number,
): { x: number; z: number } {
  const p = sim.player;
  p.facing = facing;
  const input = { ...emptyMoveInput(), forward: true };
  for (let tick = 0; tick < ticks; tick++) stepPlayerMotion(motionDeps(sim), p, input);
  return { x: p.pos.x - origin.x, z: p.pos.z - origin.z };
}

// The car's timber line: the inner face of the nearer side panel on each
// side (frame at x 6.5, depth 0.16 x 8 => 5.86; frame at x -7.55 => -6.91),
// less the body radius. A body centre past this stands inside a panel.
const BODY_RADIUS = 0.5;
const EAST_INNER_FACE = 6.5 - (IGNIVAR_PROP_NATIVE.lift_frame.dep * 8) / 2;
const WEST_INNER_FACE = -7.55 + (IGNIVAR_PROP_NATIVE.lift_frame.dep * 8) / 2;
// The swept resolver settles a body a few centimetres into a face; the
// tolerance covers that skin, never a whole body width.
const EPS = 0.1;

describe('forge-lift car walls', () => {
  it('the door frames and arch beams are solid side panels, not pass-through', () => {
    expect(IGNIVAR_NON_COLLIDING_PROPS.has('lift_frame')).toBe(false);
    expect(IGNIVAR_NON_COLLIDING_PROPS.has('lift_arch_beam')).toBe(false);
    const colliders = ignivarPropColliders('ignivar_lift', IGNIVAR_LIFT_LAYOUT);
    const panels = ignivarLiftPropPlacements(IGNIVAR_LIFT_LAYOUT).filter(
      (row) => row.key === 'lift_frame' || row.key === 'lift_arch_beam',
    );
    expect(panels.length).toBe(6);
    for (const panel of panels) {
      expect(
        colliders.some((c) => c.type === 'obb' && c.x === panel.x && c.z === panel.z),
        `${panel.key} at ${panel.x},${panel.z} has no collider`,
      ).toBe(true);
    }
  });

  it('a rider pushing into either side wall stops at the timber, not the shell', () => {
    const { sim, origin } = boardLift();
    // Beside the entry, the south frames: east at z -5, west at z -5.
    placeAt(sim, origin, 0, -5);
    expect(walk(sim, origin, Math.PI / 2, 60).x).toBeLessThanOrEqual(
      EAST_INNER_FACE - BODY_RADIUS + EPS,
    );
    placeAt(sim, origin, 0, -5);
    expect(walk(sim, origin, -Math.PI / 2, 60).x).toBeGreaterThanOrEqual(
      WEST_INNER_FACE + BODY_RADIUS - EPS,
    );
    // Beside the gate, the north frames.
    placeAt(sim, origin, 0, 5);
    expect(walk(sim, origin, Math.PI / 2, 60).x).toBeLessThanOrEqual(
      EAST_INNER_FACE - BODY_RADIUS + EPS,
    );
    placeAt(sim, origin, 0, 5);
    expect(walk(sim, origin, -Math.PI / 2, 60).x).toBeGreaterThanOrEqual(
      WEST_INNER_FACE + BODY_RADIUS - EPS,
    );
  });

  it('no spot a rider can walk to lies behind the timber line (the pylon corner is sealed)', () => {
    const { sim, origin } = boardLift();
    const step = 0.5;
    const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
    const entry = DUNGEONS[IGNIVAR_LIFT_ROOM_ID].entry;
    const seen = new Map<string, { x: number; z: number }>();
    const queue = [{ x: entry.x, z: entry.z }];
    seen.set(key(entry.x, entry.z), queue[0]);
    const headings = 16;
    let worstEast = -Infinity;
    let worstWest = Infinity;
    for (let cell = queue.shift(); cell; cell = queue.shift()) {
      for (let h = 0; h < headings; h++) {
        placeAt(sim, origin, cell.x, cell.z);
        const end = walk(sim, origin, (h * 2 * Math.PI) / headings, 4);
        // The whole car floor is explored, corners included; only the two
        // portal triggers (the entry facade and the exit gate, both on the
        // centre line) are left alone, since stepping into one is a
        // crossing, not floor.
        if (Math.abs(end.x) < 2.5 && (end.z < -5 || end.z > 5)) continue;
        worstEast = Math.max(worstEast, end.x);
        worstWest = Math.min(worstWest, end.x);
        const k = key(end.x, end.z);
        if (seen.has(k)) continue;
        const snapped = { x: Math.round(end.x / step) * step, z: Math.round(end.z / step) * step };
        seen.set(k, snapped);
        queue.push(snapped);
      }
    }
    expect(seen.size).toBeGreaterThan(100);
    // The arch beams (x 8 / -8.3) stand a little outside the frames, so the
    // widest honest floor is the frame line; the old shell let a body reach
    // 8.5 / -8.5, wedged behind the panels beside the pylons at +-7.
    expect(worstEast).toBeLessThanOrEqual(EAST_INNER_FACE - BODY_RADIUS + EPS);
    expect(worstWest).toBeGreaterThanOrEqual(WEST_INNER_FACE + BODY_RADIUS - EPS);
    // The pylon-to-shell seam itself is unreachable.
    expect(seen.has(key(8.5, -3))).toBe(false);
    expect(seen.has(key(-8.5, -3))).toBe(false);
  });

  it('the entry-to-gate crossing every rider makes stays open', () => {
    const { sim, origin } = boardLift();
    const entry = DUNGEONS[IGNIVAR_LIFT_ROOM_ID].entry;
    placeAt(sim, origin, entry.x, entry.z);
    const end = walk(sim, origin, 0, 80);
    // The walk is stopped by the Forge-Lift Gate object itself at z 6.5:
    // reaching it proves the lane from the entry to the exit stays open
    // (it would stall at the first frame if the panels sealed the aisle).
    expect(end.z).toBeGreaterThanOrEqual(6);
  });
});
