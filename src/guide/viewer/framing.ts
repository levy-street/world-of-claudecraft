// Pure camera-framing math for the Guide turntable, with NO three.js dependency, so it is
// unit-testable in plain Node. The turntable spins the model about the world Y axis at the
// origin, so to keep a rig centered for every spin angle its (posed) bounds must be
// re-centered onto that axis; the camera then frames the bounding sphere head-on with a
// small headroom lift, mirroring the still renderer (scripts/wiki/stills_render_entry.js).
//
// scene.ts measures the model's POSED, skin-aware bounds (the union over the idle clip) and
// feeds them here; this module decides where to put the model (offset) and the camera.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

export interface TurntableFraming {
  /** Translate the model on x/z by this so its bounds center lands on the Y spin axis. */
  offset: { x: number; z: number };
  cameraPos: Vec3;
  /** Camera aim point (on the spin axis, lifted by the headroom). */
  target: Vec3;
  near: number;
  far: number;
}

// Distance padding past the exact fit (1 = tight) and the fraction of the radius to lift the
// aim so the subject sits low with headroom. Match the still renderer (stills_render_entry.js).
const MARGIN = 1.15;
const HEADROOM = 0.08;

/**
 * Frame a spinning turntable to the given (posed) bounds.
 *
 * The radius is the bounds' bounding-sphere radius (half the box diagonal, matching
 * THREE.Box3.getBoundingSphere), so the framing holds for every yaw once the model is
 * re-centered onto the spin axis via `offset`.
 *
 * `aspect` is the viewport width/height. `fovDeg` is the camera's VERTICAL fov, so a portrait
 * stage (aspect < 1, e.g. the 4/5 inline embeds) has a narrower HORIZONTAL fov; we frame by
 * whichever is tighter so a wide rig is not clipped on the sides. A square stage (aspect 1,
 * the gallery) is unaffected.
 */
export function frameTurntable(b: Bounds3, fovDeg: number, aspect = 1): TurntableFraming {
  const center = {
    x: (b.min.x + b.max.x) / 2,
    y: (b.min.y + b.max.y) / 2,
    z: (b.min.z + b.max.z) / 2,
  };
  const dx = b.max.x - b.min.x;
  const dy = b.max.y - b.min.y;
  const dz = b.max.z - b.min.z;
  const radius = Math.max(Math.hypot(dx, dy, dz) / 2, 0.05);

  const vHalf = (fovDeg * Math.PI) / 180 / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * Math.max(aspect, 0.01));
  const halfFov = Math.min(vHalf, hHalf);
  const dist = (radius / Math.sin(halfFov)) * MARGIN;

  // Aim on the spin axis (x=z=0) once the model is re-centered there, lifted a touch so the
  // subject sits slightly low. Camera stays level with the aim (a vertical reframe, not a
  // downward tilt), exactly like the still renderer.
  const aimY = center.y + radius * HEADROOM;

  return {
    offset: { x: -center.x, z: -center.z },
    cameraPos: { x: 0, y: aimY, z: dist },
    target: { x: 0, y: aimY, z: 0 },
    near: Math.max(0.05, dist / 50),
    far: dist * 12,
  };
}
