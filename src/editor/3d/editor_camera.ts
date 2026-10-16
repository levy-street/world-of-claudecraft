// Free/orbit editor camera for the 3D map editor, tuned to feel like Blender's
// viewport: turntable orbit around a free pivot with a near-full pitch range
// (look up from under the world to almost straight down), view-plane panning
// that grabs the world 1:1, and a wide dolly range. Terrain-agnostic BY DESIGN:
// nothing clamps the pivot or the camera to the ground. Hand-rolled (not
// OrbitControls) so it never fights the Renderer's own camera writes.

import * as THREE from 'three';

const MAX_FLY_DISTANCE_SCALE = 80;
// Free-Fly flies at a FIXED gear instead of the orbit distance, so the wheel
// (which now drives moveSpeed there, see camera_speed_core.ts) is the only
// thing that changes flight speed. 20 sits where the old distance term landed
// at a normal editing zoom, so the default feel is unchanged.
const FREE_FLY_BASE_SCALE = 20;
const MIN_FLY_DISTANCE_SCALE = 8;
const MAX_WHEEL_DELTA = 160;
const CAMERA_MOVEMENT_KEYS = 'wasdqe';
const AXIS_TRANSITION_SECONDS = 0.36;

export type CameraAxisView =
  | 'positiveX'
  | 'negativeX'
  | 'positiveY'
  | 'negativeY'
  | 'positiveZ'
  | 'negativeZ';

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function shortestAngleDelta(from: number, to: number): number {
  const fullTurn = Math.PI * 2;
  let delta = (to - from) % fullTurn;
  if (delta > Math.PI) delta -= fullTurn;
  if (delta < -Math.PI) delta += fullTurn;
  return delta;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A repeated keydown may outlive a renderer reload even though its matching
 * keyup happened while viewport listeners were detached. Only accept repeats
 * for a key this viewport already saw go down. */
export function shouldAcceptCameraMovementKey(
  key: string,
  repeat: boolean,
  alreadyHeld: boolean,
): boolean {
  return CAMERA_MOVEMENT_KEYS.includes(key.toLowerCase()) && (!repeat || alreadyHeld);
}

export class EditorCamera {
  // The orbit pivot; free-floating in all three axes.
  target = new THREE.Vector3(0, 0, 0);
  yaw = Math.PI; // azimuth (matches the game's default behind-the-player yaw)
  pitch = 0.62; // elevation, radians; negative looks up from below the pivot
  dist = 70;

  /** Drag direction preference. The default makes the view follow the pointer;
   *  disabling it restores the legacy opposite-direction navigation. */
  panInverted = false;

  /** Per-user speed multipliers (Camera tab sliders), 1 = the shipped feel.
   *  moveSpeed scales WASD/QE fly, lookSpeed scales orbit + mouse-look,
   *  panSpeedMul scales drag-pan. */
  moveSpeed = 1;
  /** Free-Fly: fly at FREE_FLY_BASE_SCALE instead of the orbit distance, so a
   *  wheel notch changes the speed and nothing else. Set by the viewport when
   *  Free-Fly toggles. */
  flyDistIndependent = false;
  lookSpeed = 1;
  panSpeedMul = 1;

  // Turntable limits just short of the poles (no flip), Blender-style: the
  // camera may dive below the horizon and look up at the world.
  private readonly minPitch = -1.52;
  private readonly maxPitch = 1.52;
  private readonly minDist = 1;
  private readonly maxDist = 600;
  private axisTransition: {
    elapsed: number;
    duration: number;
    startYaw: number;
    startPitch: number;
    endYaw: number;
    endPitch: number;
  } | null = null;

  // Reused output for pose(): called once per frame, so no per-frame Vector3
  // allocations. The renderer copies the vectors immediately (sync()).
  private readonly poseOut = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

  /** The camera pose to hand to Renderer.editorCam: orbit position around the
   *  pivot, looking straight at it (no height offset). */
  pose(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    this.poseOut.pos.set(
      this.target.x - Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z - Math.cos(this.yaw) * cp * this.dist,
    );
    this.poseOut.target.copy(this.target);
    return this.poseOut;
  }

  /** Resolve a world-axis view without changing pivot or distance. */
  private axisAngles(axis: CameraAxisView): { yaw: number; pitch: number } {
    switch (axis) {
      case 'positiveX':
        return { yaw: -Math.PI / 2, pitch: 0 };
      case 'negativeX':
        return { yaw: Math.PI / 2, pitch: 0 };
      case 'positiveY':
        return { yaw: 0, pitch: this.maxPitch };
      case 'negativeY':
        return { yaw: 0, pitch: this.minPitch };
      case 'positiveZ':
        return { yaw: Math.PI, pitch: 0 };
      case 'negativeZ':
        return { yaw: 0, pitch: 0 };
    }
  }

  /** Immediate axis snap, retained for programmatic camera setup. */
  snapToAxis(axis: CameraAxisView): void {
    this.cancelAxisTransition();
    const target = this.axisAngles(axis);
    this.yaw = target.yaw;
    this.pitch = target.pitch;
  }

  /** Begin a short eased navigation-gimbal transition to a world axis. */
  animateToAxis(axis: CameraAxisView, duration = AXIS_TRANSITION_SECONDS): void {
    const target = this.axisAngles(axis);
    const yawDelta = shortestAngleDelta(this.yaw, target.yaw);
    this.axisTransition = {
      elapsed: 0,
      duration: Math.max(0.001, duration),
      startYaw: this.yaw,
      startPitch: this.pitch,
      endYaw: this.yaw + yawDelta,
      endPitch: target.pitch,
    };
  }

  /** Advance the current gimbal transition. Returns true while it is active. */
  advanceAxisTransition(dt: number): boolean {
    const transition = this.axisTransition;
    if (!transition) return false;
    transition.elapsed = Math.min(transition.duration, transition.elapsed + Math.max(0, dt));
    const progress = transition.elapsed / transition.duration;
    const eased = smoothstep(progress);
    this.yaw = transition.startYaw + (transition.endYaw - transition.startYaw) * eased;
    this.pitch = transition.startPitch + (transition.endPitch - transition.startPitch) * eased;
    if (progress >= 1) this.axisTransition = null;
    return this.axisTransition !== null;
  }

  cancelAxisTransition(): void {
    this.axisTransition = null;
  }

  orbit(dxPx: number, dyPx: number): void {
    this.cancelAxisTransition();
    // "Invert camera" (default OFF): the one preference flips every
    // drag-driven camera motion (orbit here, look and pan below), not just
    // panning. The uninverted baseline is dragging-left-looks-right on the
    // horizontal and drag-up-tilts-down on the vertical.
    const flip = this.panInverted ? -1 : 1;
    const s = 0.005 * this.lookSpeed;
    this.yaw -= dxPx * s * flip;
    this.pitch = clamp(this.pitch - dyPx * s * flip, this.minPitch, this.maxPitch);
  }

  zoom(deltaY: number): void {
    this.cancelAxisTransition();
    const controlledDelta = clamp(deltaY, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
    this.dist = clamp(this.dist * Math.exp(controlledDelta * 0.0015), this.minDist, this.maxDist);
  }

  /**
   * First-person mouse-look (Free-Fly mode): rotate the VIEW around the fixed
   * camera position instead of orbiting around the target. Implemented by
   * updating yaw/pitch and then re-deriving the target so the pose()-derived
   * camera position stays exactly where it was.
   */
  look(dxPx: number, dyPx: number): void {
    this.cancelAxisTransition();
    const flip = this.panInverted ? -1 : 1;
    const cp0 = Math.cos(this.pitch);
    const px = this.target.x - Math.sin(this.yaw) * cp0 * this.dist;
    const py = this.target.y + Math.sin(this.pitch) * this.dist;
    const pz = this.target.z - Math.cos(this.yaw) * cp0 * this.dist;
    const s = 0.003 * this.lookSpeed;
    this.yaw += dxPx * s * flip;
    this.pitch = clamp(this.pitch - dyPx * s * flip, this.minPitch, this.maxPitch);
    const cp = Math.cos(this.pitch);
    this.target.set(
      px + Math.sin(this.yaw) * cp * this.dist,
      py - Math.sin(this.pitch) * this.dist,
      pz + Math.cos(this.yaw) * cp * this.dist,
    );
  }

  /**
   * Blender-style view-plane pan (screen-pixel delta): the pivot moves along
   * the camera's OWN right and up axes (including their vertical component
   * when pitched), scaled so the grabbed world point tracks the cursor about
   * 1:1 at the pivot's depth. The default (uninverted) pan moves the CAMERA
   * with the cursor horizontally and grabs the ground vertically; panInverted
   * flips both.
   */
  pan(dxPxIn: number, dyPxIn: number): void {
    this.cancelAxisTransition();
    const flip = this.panInverted ? -1 : 1;
    const dxPx = dxPxIn * flip;
    const dyPx = -dyPxIn * flip;
    const k = this.dist * 0.00135 * this.panSpeedMul;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    // Camera basis: screen-right and screen-up in world space.
    const rx = -cy;
    const rz = sy;
    const ux = sy * sp;
    const uy = cp;
    const uz = cy * sp;
    this.target.x += (-dxPx * rx + dyPx * ux) * k;
    this.target.y += dyPx * uy * k;
    this.target.z += (-dxPx * rz + dyPx * uz) * k;
  }

  /**
   * Free-Fly WASD/QE (`dt` seconds): W/S move along the full VIEW direction
   * (including its vertical component, like Blender's fly), A/D strafe
   * horizontally, Q/E move straight down/up.
   */
  fly(forward: number, right: number, up: number, dt: number): void {
    this.cancelAxisTransition();
    const scale = this.flyDistIndependent
      ? FREE_FLY_BASE_SCALE
      : clamp(this.dist, MIN_FLY_DISTANCE_SCALE, MAX_FLY_DISTANCE_SCALE);
    const speed = scale * dt * 1.4 * this.moveSpeed;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw) * cp;
    const fy = -sp;
    const fz = Math.cos(this.yaw) * cp;
    // Screen-right of the camera basis (D strafes right, A strafes left).
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    const mx = forward * fx + right * rx;
    const my = forward * fy + up;
    const mz = forward * fz + right * rz;
    const movementLength = Math.hypot(mx, my, mz);
    if (movementLength === 0) return;
    const normalizedSpeed = speed / movementLength;
    this.target.x += mx * normalizedSpeed;
    this.target.y += my * normalizedSpeed;
    this.target.z += mz * normalizedSpeed;
  }
}
