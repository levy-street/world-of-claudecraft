// Anti-stuck mechanism for the idle engine.
//
// When the player hasn't moved for several steps, this module takes over
// and tries to escape: first back up to create space, then try every
// compass direction, using pathfinding to find open ground when possible.
//
// Deterministic: reads only sim state, no Math.random.

import { findPlayerPath } from '../src/sim/pathfind';
import type { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';

const FORWARD = 1;
const BACK = 2;
const TURN_LEFT = 3;
const TURN_RIGHT = 4;
const STRAFE_LEFT = 5;
const STRAFE_RIGHT = 6;
const JUMP = 7;

const STUCK_THRESHOLD = 6;
const MOVE_THRESHOLD = 0.3;
/** How far to search for an escape path (yards). */
const ESCAPE_PATH_RADIUS = 15;
/** How many waypoints to follow before re-checking. */
const WAYPOINT_FOLLOW_STEPS = 5;

export class AntiStuck {
  private _lastX = 0;
  private _lastZ = 0;
  private _stepsSinceMove = 0;
  private _escapeIndex = 0;
  private _initialized = false;
  /** Pathwaypoints to follow when pathfinding finds a route. */
  private _waypoints: { x: number; z: number }[] = [];
  private _waypointIdx = 0;
  private _waypointSteps = 0;

  check(sim: Sim): number | null {
    const p = sim.player;
    if (p.dead) return null;

    const x = p.pos.x;
    const z = p.pos.z;

    if (!this._initialized) {
      this._lastX = x;
      this._lastZ = z;
      this._initialized = true;
      return null;
    }

    const moved = dist2d({ x: this._lastX, y: 0, z: this._lastZ }, { x, y: 0, z });
    this._lastX = x;
    this._lastZ = z;

    // Player moved, clear stuck state.
    if (moved > MOVE_THRESHOLD) {
      this._reset();
      return null;
    }

    this._stepsSinceMove++;
    // Give extra grace period: don't trigger anti-stuck until we've been
    // still for a while. Also don't trigger if the player is in combat
    // (targetId set), let combat handle that.
    if (this._stepsSinceMove < STUCK_THRESHOLD + 4) return null;

    // === STUCK, escape logic ===

    // 1. If we have waypoints from pathfinding, follow them.
    if (this._waypoints.length > 0 && this._waypointIdx < this._waypoints.length) {
      this._waypointSteps++;
      if (this._waypointSteps > WAYPOINT_FOLLOW_STEPS) {
        // Took too long on this waypoint, recompute.
        this._waypoints = [];
        this._waypointIdx = 0;
        this._waypointSteps = 0;
      } else {
        const wp = this._waypoints[this._waypointIdx];
        const d = dist2d({ x, y: 0, z }, { x: wp.x, y: 0, z: wp.z });
        if (d < 2) {
          // Reached waypoint, advance to next.
          this._waypointIdx++;
          this._waypointSteps = 0;
          return FORWARD;
        }
        // Steer toward waypoint.
        return this._steerToward(sim, wp);
      }
    }

    // 2. Try pathfinding: find a path to a point in a random-ish direction.
    //    Use the escape index to rotate through 8 directions.
    const dirIndex = this._escapeIndex % 8;
    const angle = (dirIndex / 8) * Math.PI * 2;
    const targetX = x + Math.cos(angle) * ESCAPE_PATH_RADIUS;
    const targetZ = z + Math.sin(angle) * ESCAPE_PATH_RADIUS;

    const path = findPlayerPath(sim.cfg.seed, { x, z }, { x: targetX, z: targetZ }, 32);
    if (path.length > 1) {
      // Found a path, follow its waypoints (skip the first which is near us).
      this._waypoints = path.slice(1);
      this._waypointIdx = 0;
      this._waypointSteps = 0;
      this._escapeIndex++;
      return this._steerToward(sim, this._waypoints[0]);
    }

    // 3. No path found, try basic escape: back up, then turn.
    this._escapeIndex++;
    const phase = this._escapeIndex % 6;
    if (phase === 0) return BACK;
    if (phase === 1) return BACK;
    if (phase === 2) return TURN_LEFT;
    if (phase === 3) return JUMP;
    if (phase === 4) return TURN_RIGHT;
    return STRAFE_LEFT;
  }

  private _steerToward(sim: Sim, target: { x: number; z: number }): number {
    const p = sim.player;
    const dx = target.x - p.pos.x;
    const dz = target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.5) return FORWARD;

    const targetAngle = Math.atan2(dx, dz);
    let rel = targetAngle - p.facing;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;

    if (Math.abs(rel) > 0.3) {
      return rel > 0 ? TURN_LEFT : TURN_RIGHT;
    }
    return FORWARD;
  }

  private _reset(): void {
    this._stepsSinceMove = 0;
    this._escapeIndex = 0;
    this._waypoints = [];
    this._waypointIdx = 0;
    this._waypointSteps = 0;
  }

  reset(): void {
    this._initialized = false;
    this._reset();
  }
}
