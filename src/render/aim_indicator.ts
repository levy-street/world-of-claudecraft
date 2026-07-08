import * as THREE from 'three';
import { drapeRingLocalY, type HeightSampler } from './selection_ring';

// Render-only visual for the M7B skill smart-cast UX: a range ring drawn at the
// caster's feet while the local player holds an eligible skill button, so they
// can see the ability's reach before releasing to cast. The renderer owns one
// instance, adds its group to the scene, feeds it the state the HUD supplies, and
// calls update() each frame. Like the selection ring, the ring is DRAPED over the
// terrain each frame so it reads on slopes instead of sinking into the uphill
// ground. Purely an input aid shown during the player's own press; it carries no
// actionable combat information, so the graphics-fairness invariant does not
// apply. (This game has no ground-targeted spells, so there is no reticle: the
// ring only communicates range.)

export interface AimIndicatorState {
  /** Ring center (the caster) in world XZ. */
  centerX: number;
  centerZ: number;
  /** Ring radius in yards (the ability's cast range or AoE radius). */
  radius: number;
}

const RING_LIFT = 0.09; // ring height above terrain, world units
const AIM_GOLD = 0xd4af37; // matches the selection reticle palette

export class AimIndicator {
  readonly group: THREE.Group;
  private readonly rangeRing: THREE.Mesh;
  private readonly rangeMat: THREE.MeshBasicMaterial;
  private readonly ringLocalXZ: Float32Array;
  private readonly ringDrapeY: Float32Array;
  private readonly sample: HeightSampler;
  private state: AimIndicatorState | null = null;

  constructor(sample: HeightSampler) {
    this.sample = sample;
    this.group = new THREE.Group();

    // A unit-radius thin annulus, uniformly scaled to the radius and draped each
    // frame (same math as the selection ring).
    const ringGeo = new THREE.RingGeometry(0.975, 1.0, 72);
    ringGeo.rotateX(-Math.PI / 2);
    this.rangeMat = new THREE.MeshBasicMaterial({
      color: AIM_GOLD,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.rangeRing = new THREE.Mesh(ringGeo, this.rangeMat);
    this.rangeRing.frustumCulled = false; // the draped ring's bounds go stale each frame
    const ringPos = ringGeo.getAttribute('position') as THREE.BufferAttribute;
    this.ringLocalXZ = new Float32Array(ringPos.count * 2);
    for (let i = 0; i < ringPos.count; i++) {
      this.ringLocalXZ[i * 2] = ringPos.getX(i);
      this.ringLocalXZ[i * 2 + 1] = ringPos.getZ(i);
    }
    this.ringDrapeY = new Float32Array(ringPos.count);
    this.group.add(this.rangeRing);

    this.group.visible = false;
  }

  /** Arm/refresh (state) or hide (null) the ring. */
  set(state: AimIndicatorState | null): void {
    this.state = state;
    this.group.visible = state !== null;
  }

  /** Re-drape + pulse for the current frame. `time` drives the gentle pulse. */
  update(time: number): void {
    const s = this.state;
    if (!s) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const baseY = this.sample(s.centerX, s.centerZ);

    // Uniform scale so the draped local Y (divided by scale) resolves back to the
    // sampled ground height, exactly as the selection ring does.
    const radius = Math.max(0.001, s.radius);
    this.rangeRing.position.set(s.centerX, baseY, s.centerZ);
    this.rangeRing.scale.setScalar(radius);
    const drape = drapeRingLocalY(
      this.ringLocalXZ,
      s.centerX,
      s.centerZ,
      baseY,
      radius,
      RING_LIFT,
      this.sample,
      this.ringDrapeY,
    );
    const rp = this.rangeRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < drape.length; i++) rp.setY(i, drape[i]);
    rp.needsUpdate = true;
    this.rangeMat.opacity = 0.4 + 0.1 * Math.sin(time * 3);
  }
}
