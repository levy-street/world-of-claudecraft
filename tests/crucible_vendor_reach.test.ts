// The Crucible Quartermaster must be WALKABLE from the raid entrance, not just
// near it. His first overworld spot (510.5 / 2242.5) was thirteen yards below
// the keep door on the terrain outside the stair passage's wall, so a raider at
// the door could not reach him without leaving the fortress and swimming round
// the isle. These walks drive the real player motion kernel (ramps, floor
// plates, the climb gate) from the door threshold and from the tier-three court
// and require arrival inside vendor range.

import { describe, expect, it } from 'vitest';
import { CRUCIBLE_VENDOR_NPC_ID } from '../src/sim/content/ignivar_loot';
import { DUNGEONS } from '../src/sim/data';
import { IGNIVAR_LIFT_ROOM_ID } from '../src/sim/ignivar_raid_ids';
import { type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, emptyMoveInput, INTERACT_RANGE } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

type AnySim = Sim & Record<string, any>;
type Point = { x: number; y: number; z: number };

/** The live motion callbacks the Sim binds for its own tick (private there). */
function motionDeps(sim: Sim): PlayerMotionDeps {
  return (sim as unknown as { playerMotionDeps: PlayerMotionDeps }).playerMotionDeps;
}

// Below the top flight, just outside the door's 2 yd walk-in trigger.
const DOOR_THRESHOLD: Point = { x: 503.05, y: 0, z: 2241 };
// The court at the foot of the upper stair, two flights below the door.
const TIER_THREE_COURT: Point = { x: 504, y: 0, z: 2228.5 };
// The landing court's floor plate top (the upper stair's level run).
const LANDING_COURT: Point = { x: 503.3, y: 15.34, z: 2237.5 };
const MAX_TICKS_PER_LEG = 20 * 20;

function worldSim(): AnySim {
  return new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true }) as AnySim;
}

function vendor(sim: AnySim): Entity {
  const npc = [...sim.entities.values()].find(
    (e: Entity) => e.kind === 'npc' && e.templateId === CRUCIBLE_VENDOR_NPC_ID,
  );
  if (!npc) throw new Error('Crucible Quartermaster did not spawn in the overworld');
  return npc;
}

function standAt(sim: AnySim, at: Point): void {
  const p = sim.player;
  p.pos = { x: at.x, y: sim.groundPos(at.x, at.z).y, z: at.z };
  p.prevPos = { ...p.pos };
  p.onGround = true;
  p.vy = 0;
  sim.rebucket(p);
}

// Vendor range is 2D (dist2d), so a raider on the landing's edge would "reach" a
// vendor nine yards straight below through the wall; arrival must be on the
// same floor for the walk to count.
const SAME_FLOOR_YARDS = 1.5;

/** Hold "forward" toward `target` through the real motion kernel; the closest
 *  same-floor 2D distance reached, so a wall, a drop, or an unclimbable step
 *  shows as a stall. */
function walkToward(sim: AnySim, target: Point, arriveWithin: number): number {
  const p = sim.player;
  const input = { ...emptyMoveInput(), forward: true };
  const sameFloorDist = () =>
    Math.abs(p.pos.y - target.y) <= SAME_FLOOR_YARDS ? dist2d(p.pos, target) : Infinity;
  let closest = sameFloorDist();
  for (let tick = 0; tick < MAX_TICKS_PER_LEG; tick++) {
    if (closest <= arriveWithin) break;
    p.facing = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
    stepPlayerMotion(motionDeps(sim), p, input);
    closest = Math.min(closest, sameFloorDist());
  }
  return closest;
}

describe('crucible quartermaster: walkable from the raid entrance', () => {
  it('stands on the landing court one flight below the keep door', () => {
    const sim = worldSim();
    const npc = vendor(sim);
    const door = sim.groundPos(
      DUNGEONS[IGNIVAR_LIFT_ROOM_ID].doorPos.x,
      DUNGEONS[IGNIVAR_LIFT_ROOM_ID].doorPos.z,
    );
    expect(door.y).toBeGreaterThan(18);
    // Feet on the landing plate's top (15.34), not the terrain a hand's width under it.
    expect(npc.pos.y).toBeCloseTo(15.34, 1);
    expect(dist2d(npc.pos, door)).toBeLessThan(8);
  });

  it('is reached by walking down from the door threshold', () => {
    const sim = worldSim();
    const npc = vendor(sim);
    standAt(sim, DOOR_THRESHOLD);
    expect(walkToward(sim, npc.pos, INTERACT_RANGE - 1)).toBeLessThanOrEqual(INTERACT_RANGE - 1);
  });

  it('is reached by climbing up from the tier-three court', () => {
    const sim = worldSim();
    const npc = vendor(sim);
    standAt(sim, TIER_THREE_COURT);
    expect(walkToward(sim, LANDING_COURT, 1)).toBeLessThanOrEqual(1);
    expect(walkToward(sim, npc.pos, INTERACT_RANGE - 1)).toBeLessThanOrEqual(INTERACT_RANGE - 1);
  });
});
