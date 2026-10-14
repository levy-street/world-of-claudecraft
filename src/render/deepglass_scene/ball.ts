// The Tidesow's render-side juice: its per-entity body views, the goal
// singularity collapse, and its comet trail. Moved out of renderer.ts; the
// renderer constructs one of these up front (it is inert and allocation-free
// until a Tidesow entity is first seen) and drives it from the entity loop.

import type * as THREE from 'three';
import { DG_BALL_RADIUS } from '../../sim/deepglass/ball';
import { deepglassMatch } from '../../sim/deepglass/match';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { BallTrail } from '../ball_trail';
import { buildTidesow, type TidesowBuild } from '../deepglass_ball';
import type { EntityView } from '../renderer';
import { setRenderCategory } from '../renderer_diagnostics';

/** Seconds for the scored ball to implode into its singularity (the goal
 *  celebration runs 4s; the collapse fills the first stretch of it). */
const DG_BALL_COLLAPSE_SECS = 0.9;

export class DeepglassBallFx {
  /** Live Tidesow visuals by entity id (arena only). */
  private readonly views = new Map<number, TidesowBuild>();
  /** 0..1 through the goal singularity (the ball's implosion). Rises while the
   *  match sits in its 'goal' phase, snaps back to 0 on the kickoff. */
  private collapse = 0;
  /** The Tidesow's comet trail, created lazily the first time the ball moves. */
  private trail: BallTrail | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  /** The Tidesow: machined metal, wisp lenses at the poles, and an aura that
   *  reads its speed. Registered so the per-frame sync can feed it. */
  createBody(id: number): TidesowBuild {
    const tidesow = buildTidesow();
    this.views.set(id, tidesow);
    return tidesow;
  }

  /** Feed each Tidesow its live speed so the aura tracks how hard it was hit,
   *  plus the camera (for the reticle billboard) and the goal-collapse phase
   *  (the singularity implosion while the match sits in its 'goal' phase). */
  sync(sim: IWorld, dt: number, camQuat: THREE.Quaternion, showMark: boolean): void {
    const m = deepglassMatch();
    this.collapse =
      m?.phase === 'goal' ? Math.min(1, this.collapse + dt / DG_BALL_COLLAPSE_SECS) : 0;
    // The pace the aura and the pole wisps burn at, read from the MATCH's own
    // velocity. It used to be differenced out of the entity's position between
    // render frames and divided by DT, a FRAME delta over a TICK step, which
    // is only ever right when the two happen to be equal, and they never are.
    // The sim ticks at 20 Hz, so above 20 fps most frames find pos === prevPos
    // and report a stationary ball: `shown` eases down, `lit` falls under
    // AURA_IDLE_CUT, and `aura.visible` switches OFF for those frames. That is
    // the ball strobing in the bell. Below 20 fps it errs the other way, a
    // whole run of ticks over one tick's DT, and the measured error there was
    // 100x (1,114 yd/s drawn against 10.8 real), pinning the aura at full.
    // The match velocity is authoritative and frame-rate independent, and it
    // is what the strike cue already reads.
    const ball = m?.ball;
    const speed = ball ? Math.hypot(ball.vx, ball.vy, ball.vz) : 0;
    for (const [id, view] of this.views) {
      const e = sim.entities.get(id);
      if (!e) {
        view.dispose();
        this.views.delete(id);
        continue;
      }
      view.update(speed, dt, camQuat, this.collapse, showMark);
    }
  }

  // The Tidesow's comet trail: a glow mote dropped at the ball each frame,
  // fatter and brighter the harder it was struck, so a ball crossing a 76 yd
  // sphere at 34 yd/s stays readable. Lifted out of the retired boarball
  // renderer with the Vale Cup (see ball_trail.ts); the roll, contact shadow
  // and ground dust went with the minigame, the Tidesow floats, spins under
  // its own view's update(), and casts no contact blob.
  updateBall(e: Entity, v: EntityView, dt: number): void {
    v.group.rotation.y = 0; // the ball's own view owns orientation
    const x = v.group.position.x;
    const y = v.group.position.y;
    const z = v.group.position.z;
    const dx = x - v.lastX;
    const dz = z - v.lastZ;
    v.lastX = x;
    v.lastZ = z;
    if (!v.group.visible) return;
    const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    if (!this.trail) {
      this.trail = new BallTrail();
      setRenderCategory(this.trail.group, 'vfx');
      this.scene.add(this.trail.group);
    }
    // Ride the ball's own centre: the Tidesow publishes 0 (its sim y IS the
    // centre), and the lift is read rather than assumed so a future ball that
    // rests on the ground still trails from the middle of itself.
    const bodyGroup = v.objectMesh as THREE.Group | undefined;
    const centreLift = (bodyGroup?.userData.ballCentreLift as number | undefined) ?? 0;
    this.trail.emit(x, y + centreLift * e.scale, z, speed, dt, DG_BALL_RADIUS / e.scale);
  }

  /** Age the trail's motes (a no-op until the ball first moved). */
  tick(dt: number): void {
    this.trail?.update(dt);
  }
}
