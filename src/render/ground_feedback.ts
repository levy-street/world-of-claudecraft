// Ground feedback the player's own input leaves on the terrain, moved out of
// renderer.ts: the pooled OSRS-style click markers, the pooled ground-targeted
// AoE impact rings, and the ground-aim reticle. Pure presentation: it never
// reads or writes sim state. The renderer builds the pools at construction
// (pushing into `clickMarkers` / `aoeRings`) and ticks update() per frame.

import type * as THREE from 'three';
import { AOE_RING_LIFETIME, aoeRingAnim } from './aoe_ring';
import { CLICK_MARKER_LIFETIME, clickMarkerAnim, clickMarkerColor } from './click_marker';
import { groundCueY } from './dais_lift';
import type { GroundAimReticleVisual } from './ground_aim_reticle_visual';
import { SCHOOL_COLORS } from './vfx';

export interface ClickMarkerSlot {
  group: THREE.Group;
  ring: THREE.Mesh;
  cross: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  crossMat: THREE.MeshBasicMaterial;
  elapsed: number; // seconds since spawn; >= CLICK_MARKER_LIFETIME means free
}

export interface AoeRingSlot {
  ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  radius: number; // blast radius in yards this flash represents
  elapsed: number; // seconds since spawn; >= AOE_RING_LIFETIME means free
}

/** A ground-targeted ability's aim, as the HUD hands it over. */
export interface GroundAim {
  x: number;
  z: number;
  radius: number;
  school: string;
  dimmed: boolean;
  blocked?: boolean;
}

export class GroundFeedback {
  // Pool of transient click-feedback markers (ring plus crossed "X"). Each slot is
  // a group reused round-robin, so rapid clicking never allocates. A slot with
  // `elapsed >= lifetime` is free. See click_marker.ts for the animation curves.
  readonly clickMarkers: ClickMarkerSlot[] = [];
  private clickMarkerNext = 0;
  // ground-targeted AoE impact rings (see aoe_ring.ts), pooled like click markers
  readonly aoeRings: AoeRingSlot[] = [];
  private aoeRingNext = 0;
  /** Set by the renderer once it builds the reticle. */
  reticle: GroundAimReticleVisual | null = null;

  constructor(
    private readonly groundHeight: (x: number, z: number) => number,
    private readonly groundSample: (x: number, z: number) => number,
    private readonly lowGfx: () => boolean,
    /** The bloom-edge HDR boost (SELECTION_RING_BOOST), skipped on low. */
    private readonly ringBoost: number,
  ) {}

  // Drop a transient OSRS-style click marker at a world ground point. Called from
  // main.ts on a qualifying left-click; `hostile` tints it red. No-op if the pool
  // is empty.
  spawnClickMarker(x: number, z: number, hostile: boolean): void {
    if (this.clickMarkers.length === 0) return;
    const slot = this.clickMarkers[this.clickMarkerNext];
    this.clickMarkerNext = (this.clickMarkerNext + 1) % this.clickMarkers.length;
    const y = this.groundHeight(x, z) + 0.06; // tiny lift to avoid z-fighting
    slot.group.position.set(x, y, z);
    slot.elapsed = 0;
    const color = clickMarkerColor(hostile);
    slot.ringMat.color.setHex(color);
    slot.crossMat.color.setHex(color);
    if (!this.lowGfx()) {
      slot.ringMat.color.multiplyScalar(this.ringBoost); // subtle bloom edge, matches reticle
      slot.crossMat.color.multiplyScalar(this.ringBoost);
    }
    slot.group.visible = true;
  }

  // Flash a school-colored AoE ring on the terrain at a ground-targeted blast's
  // landing spot, sized to the blast radius (see aoe_ring.ts for the curves).
  spawnAoeRing(x: number, z: number, radius: number, school: string, colorHex?: number): void {
    if (this.aoeRings.length === 0) return;
    const slot = this.aoeRings[this.aoeRingNext];
    this.aoeRingNext = (this.aoeRingNext + 1) % this.aoeRings.length;
    const y = groundCueY(this.groundSample, x, z, radius) + 0.12; // lift to avoid z-fighting
    slot.ring.position.set(x, y, z);
    slot.radius = radius;
    slot.elapsed = 0;
    slot.mat.color.setHex(colorHex ?? SCHOOL_COLORS[school] ?? 0xffffff);
    if (!this.lowGfx()) slot.mat.color.multiplyScalar(this.ringBoost);
    slot.ring.visible = true;
  }

  setGroundAimReticle(aim: GroundAim | null): void {
    this.reticle?.setAim(
      aim
        ? {
            x: aim.x,
            z: aim.z,
            radius: aim.radius,
            color: SCHOOL_COLORS[aim.school] ?? 0xffffff,
            dimmed: aim.dimmed,
            blocked: aim.blocked === true,
          }
        : null,
    );
  }

  // Advance every live click marker by dt and apply the ring/X fade+scale curves.
  updateClickMarkers(dt: number): void {
    for (const slot of this.clickMarkers) {
      if (slot.elapsed >= CLICK_MARKER_LIFETIME) continue;
      slot.elapsed += dt;
      const a = clickMarkerAnim(slot.elapsed);
      if (!a.active) {
        slot.group.visible = false;
        continue;
      }
      slot.ring.scale.setScalar(a.ringScale);
      slot.ringMat.opacity = a.ringAlpha;
      slot.cross.scale.setScalar(a.crossScale);
      slot.crossMat.opacity = a.crossAlpha;
    }
  }

  updateAoeRings(dt: number): void {
    for (const slot of this.aoeRings) {
      if (slot.elapsed >= AOE_RING_LIFETIME) continue;
      slot.elapsed += dt;
      const a = aoeRingAnim(slot.elapsed);
      if (!a.active) {
        slot.ring.visible = false;
        continue;
      }
      slot.ring.scale.setScalar(slot.radius * a.ringScale);
      slot.mat.opacity = a.ringAlpha;
    }
  }
}
