// Feed the deepball match strip. Render-side because this is where the live
// match state, the camera and the local player are all already in hand; the
// strip is pure DOM and never touches the sim (src/ui/deepglass_hud.ts).

import * as THREE from 'three';
import {
  DG_BOOST_SPEED,
  DG_CHARGE_MAX,
  DG_DASH_COST,
  DG_SWIM_SPEED,
} from '../../sim/deepglass/flight';
import { DG_MATCH_DURATION, type DgMatch, deepglassMatch } from '../../sim/deepglass/match';
import { DT } from '../../sim/types';
import {
  ballMarkFromNdc,
  type DeepglassBallMark,
  updateDeepglassHud,
} from '../../ui/deepglass_hud';
import type { IWorld } from '../../world_api';

/** Scratch for projecting the Tidesow to screen space (the HUD ball marker). */
const markV = new THREE.Vector3();

/** A fighter's display name, for the goal credit. */
function deepglassName(sim: IWorld, pid: number | null): string | null {
  if (pid === null) return null;
  return sim.entities.get(pid)?.name ?? null;
}

/** Project the Tidesow to screen space for the HUD marker. The three-case
 *  mapping from there lives in ballMarkFromNdc (pure, and unit-tested);
 *  this end owns only the camera. */
function deepglassBallMark(
  sim: IWorld,
  camera: THREE.Camera,
  m: DgMatch,
  showMark: boolean,
): DeepglassBallMark | null {
  if (!showMark || !m.ball) return null;
  const p = sim.player as { pos?: { x: number; y: number; z: number } };
  const ball = m.ball;
  const dist = p.pos ? Math.hypot(ball.x - p.pos.x, ball.y - p.pos.y, ball.z - p.pos.z) : 0;
  markV.set(ball.x, ball.y, ball.z);
  markV.project(camera);
  return ballMarkFromNdc(markV.x, markV.y, markV.z, dist);
}

/** Push this frame's match strip (or clear it when no bout is live). */
export function syncDeepglassHud(sim: IWorld, camera: THREE.Camera, showMark: boolean): void {
  const m = deepglassMatch();
  if (!m) {
    updateDeepglassHud(null);
    return;
  }
  const me = sim.player as {
    id?: number;
    pos?: { x: number; y: number; z: number };
    vx?: number;
    vy?: number;
    vz?: number;
    dgCharge?: number;
    dgBoosting?: boolean;
    dgOverburnTicks?: number;
    dgDashCd?: number;
    dgBraking?: boolean;
    dgPowerup?: 'zap' | 'overburn';
    dgDeadTicks?: number;
    dgZappedBy?: number;
  };
  const pid = me.id ?? -1;
  const overburn = (me.dgOverburnTicks ?? 0) > 0;
  updateDeepglassHud({
    phase: m.phase,
    timer: m.timer,
    clock: m.clock,
    matchLength: DG_MATCH_DURATION,
    scoreA: m.scoreA,
    scoreB: m.scoreB,
    charge: (me.dgCharge ?? 0) / DG_CHARGE_MAX,
    boosting: me.dgBoosting === true,
    overburn,
    team: m.teamA.includes(pid) ? 'A' : m.teamB.includes(pid) ? 'B' : null,
    lastGoalBy: m.lastGoalBy,
    powerup: me.dgPowerup ?? null,
    dead: (me.dgDeadTicks ?? 0) * DT,
    zappedBy: (me.dgDeadTicks ?? 0) > 0 ? deepglassName(sim, me.dgZappedBy ?? null) : null,
    speed: Math.hypot(me.vx ?? 0, me.vy ?? 0, me.vz ?? 0),
    cruise: DG_SWIM_SPEED,
    topSpeed: DG_BOOST_SPEED,
    dashReady: (me.dgDashCd ?? 0) <= 0 && (overburn || (me.dgCharge ?? 0) >= DG_DASH_COST),
    braking: me.dgBraking === true,
    ball: deepglassBallMark(sim, camera, m, showMark),
    scorer: deepglassName(sim, m.lastGoalScorer),
    assist: deepglassName(sim, m.lastGoalAssist),
    ownGoal: m.lastGoalOwn,
    overtime: m.overtime,
  });
}
