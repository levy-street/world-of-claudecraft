// Rift boss lethal death zone visual: a pulsing red danger ring drawn on the
// terrain at the zone's (x, z) position while the boss casts. The cast bar is
// the primary telegraph; this ring makes the exact danger radius visible so
// players can step out before the detonation. The ring fades on detonation.
//
// Fairness note: this is an actionable cue (a player reacts to it), so it MUST
// draw at every graphics tier and NEVER be hidden by the FPS governor. The
// ring geometry is minimal (a LineLoop, < 100 vertices) and has negligible cost.

import * as THREE from 'three';
import type { RiftBossDeathZoneView } from '../world_api/dungeons';

const SEGMENTS = 64;
const BASE_COLOR = 0xff2200;
const BASE_OPACITY = 0.85;
const PULSE_SPEED = 4.0; // full pulse cycle per second
const LINE_WIDTH = 1; // THREE LineBasicMaterial uses pixel width; browsers cap at 1

/** One live death zone visual (a terrain-draped red danger ring). */
interface ZoneVisual {
  loop: THREE.LineLoop;
  mat: THREE.LineBasicMaterial;
  x: number;
  z: number;
  radius: number;
  /** 0..1 phase clock for the pulse animation, driven by update(dt). */
  phase: number;
}

/** Manages rift boss lethal death zone visuals. Add to the renderer alongside
 * other ground-ring systems (ringOfFrostVisuals, etc.). */
export class RiftDeathZoneVisuals {
  private readonly zones = new Map<string, ZoneVisual>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  /** Called each frame with the current zone list from IWorld.riftBossDeathZones().
   * Zones are keyed by position + radius (short-lived, so a simple position key
   * is sufficient; two coincident zones on the same tick are collapsed, which is
   * fine for gameplay). */
  sync(zones: readonly RiftBossDeathZoneView[]): void {
    const seen = new Set<string>();
    for (const z of zones) {
      const key = `${z.x.toFixed(1)}:${z.z.toFixed(1)}:${z.radius.toFixed(1)}`;
      seen.add(key);
      if (!this.zones.has(key)) {
        this.create(key, z);
      }
    }
    for (const [key, visual] of this.zones) {
      if (!seen.has(key)) {
        this.scene.remove(visual.loop);
        visual.mat.dispose();
        visual.loop.geometry.dispose();
        this.zones.delete(key);
      }
    }
  }

  /** Called each frame with the elapsed frame time in seconds. */
  update(dt: number): void {
    for (const visual of this.zones.values()) {
      visual.phase = (visual.phase + dt * PULSE_SPEED) % (Math.PI * 2);
      // Pulse between full opacity and ~40% so the ring reads clearly but is not
      // static (the motion draws the eye to the danger zone).
      const alpha = BASE_OPACITY * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(visual.phase)));
      visual.mat.opacity = alpha;
    }
  }

  private create(key: string, zone: RiftBossDeathZoneView): void {
    // Build a horizontal circle at terrain height. The groundY callback already
    // includes the rift platform lift (applied in the renderer constructor),
    // so the ring sits on the correct floor even on elevated boss sanctums.
    const y = this.groundY(zone.x, zone.z) + 0.08; // slight lift to avoid z-fight
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          zone.x + Math.cos(angle) * zone.radius,
          y,
          zone.z + Math.sin(angle) * zone.radius,
        ),
      );
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color: BASE_COLOR,
      transparent: true,
      opacity: BASE_OPACITY,
      linewidth: LINE_WIDTH,
      depthWrite: false,
    });
    const loop = new THREE.LineLoop(geo, mat);
    loop.renderOrder = 10; // above terrain, below entities
    this.scene.add(loop);
    this.zones.set(key, { loop, mat, x: zone.x, z: zone.z, radius: zone.radius, phase: 0 });
  }
}
