// The state badge floating over a warded boss: is he vulnerable RIGHT NOW.
//
// The ring on his eye (`characters/eye_ward_marker.ts`) says where to aim. This says whether
// to bother, and it is the read the twenty players who are NOT carrying the pike actually
// need: while Barrowhide is down their damage stops being cut by 60%, and that window is
// fourteen seconds long. A ring colour is something you have to learn; a picture of a
// shattered eye is not, which is why this is painted art rather than another tinted torus.
//
// A camera-facing billboard above his head rather than anything parented into the rig: it has
// to be legible from anywhere in the fight, including from behind him, and a quad in his own
// frame is edge-on half the time.
import * as THREE from 'three';
import { loadTexture } from './assets/loader';

/** Where the badge floats, as a multiple of the body's own height above its feet. */
const LIFT = 1.24;
/** Badge size in world units, at the reference body height below. */
const SIZE_AT_REFERENCE = 3.1;
/**
 * Body height the size is tuned against.
 *
 * The badge scales with the body but SUBLINEARLY (the square root below): a badge that scaled
 * flat with a thirteen-yard boss would be a billboard the size of a house, and one sized for
 * him would be invisible on anything smaller. What must stay constant is roughly how much of
 * the screen it takes at the distance you fight the thing from.
 */
const REFERENCE_HEIGHT = 13;

const badgeUrl = (id: string): string => `/ui/status/${id}.webp`;

/**
 * One boss's badge. The renderer owns one per warded entity in view and drives it per frame.
 *
 * Textures come from the shared loader cache, so several bosses (or a respawn) pay for the
 * decode once. The material is per-instance because the alpha is animated per boss.
 */
export class EyeWardBadge {
  private mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private geo: THREE.PlaneGeometry;
  private shownId: string | null = null;
  private clock = 0;

  constructor(private parent: THREE.Object3D) {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      // Depth-TESTED but not depth-writing: it should hide behind terrain the boss is behind
      // (so it cannot advertise him through a hill, which would be an unfair position read)
      // while never occluding the VFX drawn after it.
      depthTest: true,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    parent.add(this.mesh);
  }

  /**
   * Show `badgeId` (or nothing, for null) over a body of `height` units standing at `y`.
   *
   * `pulse` is the plan's own rate, so the badge breathes in step with the ring on the eye
   * rather than at a rate of its own: two cues on the same mechanic beating out of phase read
   * as two unrelated effects.
   */
  update(
    badgeId: string | null,
    pos: { x: number; y: number; z: number },
    height: number,
    pulseHz: number,
    camera: THREE.Camera,
    dt: number,
    reducedMotion = false,
  ): void {
    this.clock += dt;
    if (!badgeId) {
      this.mesh.visible = false;
      return;
    }
    if (badgeId !== this.shownId) {
      this.shownId = badgeId;
      // Fail soft: a missing badge file leaves the previous texture (or none) rather than
      // throwing inside a per-frame path, and the ring still carries the state.
      loadTexture(badgeUrl(badgeId), { srgb: true })
        .then((tex) => {
          // Guard the race: two state changes inside one decode must not leave the older
          // texture on the material.
          if (this.shownId !== badgeId) return;
          this.mat.map = tex;
          this.mat.needsUpdate = true;
        })
        .catch(() => {});
    }
    this.mesh.visible = true;
    const size = SIZE_AT_REFERENCE * Math.sqrt(Math.max(0.2, height / REFERENCE_HEIGHT));
    this.mesh.scale.set(size, size, 1);
    this.mesh.position.set(pos.x, pos.y + height * LIFT, pos.z);
    // Face the camera on all axes: unlike the boss impostor this is a UI mark, not a body, so
    // there is no ground for it to lie down on.
    this.mesh.quaternion.copy(camera.quaternion);
    const breath = reducedMotion ? 1 : 0.78 + 0.22 * Math.sin(this.clock * pulseHz * Math.PI * 2);
    this.mat.opacity = breath;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
