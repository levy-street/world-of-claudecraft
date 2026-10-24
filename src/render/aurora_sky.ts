// A map-authored aurora (MapWeather.aurora, 0..1): the Frostveil's curtains,
// but hung over the CAMERA rather than over one realm. The Reach's aurora
// (frost_sky.ts) is a fixed feature of the shipped world with a zone fade
// band; a maker's map has no such geography, so these ribbons ride a
// camera-relative ring the way the cloud deck rides its box - wherever the
// player stands, the display is overhead and off toward the horizon, never
// left behind at one corner of the map. Render-only and presentation-only.
//
// Brightest at night, faint by day (a real display is washed out by daylight
// but never quite gone in a Howling-Fjord sky), and always slowly shimmering:
// opacity waves per ribbon and the ray columns drift, layers in opposite
// directions, which is what sells the depth of a display.

import * as THREE from 'three';
import { auroraTexture } from './frost_sky';

/** Where the curtains hang, relative to the camera: a ring this far out... */
export const AURORA_RING = 520;
/** ...and this high, so they clear the map's peaks and the cloud deck. */
export const AURORA_HEIGHT = 240;
/** Daylight leaves this much of the night strength showing. */
export const AURORA_DAY_FLOOR = 0.3;
/** Drawn AFTER the sky dome (renderOrder 1000). The curtains write no depth,
 *  so a dome drawn later paints straight over them; additive on top of the
 *  dome is the look anyway. */
export const AURORA_RENDER_ORDER = 1001;

interface Ribbon {
  mat: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
  base: number;
  phase: number;
  drift: number;
  bearing: number;
  lift: number;
}

// Six curtains around the ring, greens with a violet veil behind each (real
// displays crown red-violet above the green border).
const CURTAINS = [
  { bearing: 0.2, len: 620, h: 70, rot: 0.5, tint: 0x62f2b2, phase: 0 },
  { bearing: 1.3, len: 700, h: 84, rot: -0.35, tint: 0x52e8d8, phase: 2.1 },
  { bearing: 2.3, len: 540, h: 56, rot: 0.15, tint: 0x96f2da, phase: 4.2 },
  { bearing: 3.4, len: 500, h: 62, rot: -0.7, tint: 0x72e8a2, phase: 1.3 },
  { bearing: 4.4, len: 560, h: 60, rot: 0.9, tint: 0x58e8c0, phase: 3.2 },
  { bearing: 5.5, len: 480, h: 52, rot: -0.15, tint: 0x7af2c8, phase: 5.1 },
] as const;

/** The opacity scale for a day/night amount (0 = full day, 1 = full night). */
export function auroraNightScale(night: number): number {
  const n = Math.max(0, Math.min(1, night));
  return AURORA_DAY_FLOOR + (1 - AURORA_DAY_FLOOR) * n;
}

export class AuroraSky {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private ribbons: Ribbon[] = [];
  private strength = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** 0 disposes the display; anything above builds it (once) and scales it. */
  setStrength(strength: number): void {
    const s = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    this.strength = s;
    if (s <= 0.005) {
      this.dispose();
      return;
    }
    if (!this.group) this.build();
  }

  private build(): void {
    const tex = auroraTexture();
    if (!tex) return;
    const g = new THREE.Group();
    g.name = 'map-aurora';
    // Tagged like the shipped sky features, so the top-down minimap capture
    // (minimap_capture.ts excludes by renderCategory) never paints it.
    g.userData.renderCategory = 'sky';
    const curtain = (
      c: (typeof CURTAINS)[number],
      tint: number,
      base: number,
      lift: number,
      drift: number,
    ) => {
      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(),
        color: tint,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      });
      // gentle S-curve baked into the verts, like the Reach's curtains
      const geo = new THREE.PlaneGeometry(c.len, c.h * (1 + lift * 0.5), 24, 1);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        pos.setZ(i, Math.sin((px / c.len) * Math.PI * 2 + c.phase + lift * 0.8) * 22);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.y = c.rot;
      mesh.rotation.x = 0.18;
      mesh.renderOrder = AURORA_RENDER_ORDER;
      // Frustum-culled like any mesh: the geometry bounds are static and the
      // per-frame re-seat moves the mesh matrix, so three culls the ribbons
      // behind the camera (usually 8 of the 12) at no cost.
      mesh.frustumCulled = true;
      g.add(mesh);
      this.ribbons.push({
        mat,
        mesh,
        base,
        phase: c.phase + lift * 2.4,
        drift,
        bearing: c.bearing,
        lift,
      });
    };
    for (const c of CURTAINS) {
      curtain(c, c.tint, 0.8, 0, 0.008);
      curtain(c, 0xa06ae8, 0.3, 1, -0.005);
    }
    this.group = g;
    this.scene.add(g);
  }

  /** Re-seat the ring on the camera and shimmer. `night` is 0 (day) .. 1. */
  update(time: number, cam: THREE.Vector3, night: number): void {
    if (!this.group) return;
    const scale = this.strength * auroraNightScale(night);
    for (const r of this.ribbons) {
      const a = r.bearing;
      r.mesh.position.set(
        cam.x + Math.sin(a) * AURORA_RING,
        AURORA_HEIGHT + r.lift * 40 + Math.max(0, cam.y) * 0.25,
        cam.z + Math.cos(a) * AURORA_RING - r.lift * 8,
      );
      r.mat.opacity = r.base * scale * (0.75 + 0.25 * Math.sin(time * 0.21 + r.phase));
      if (r.mat.map) r.mat.map.offset.x = (time * r.drift + r.phase) % 1;
    }
  }

  dispose(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    for (const r of this.ribbons) {
      r.mat.map?.dispose();
      r.mat.dispose();
      r.mesh.geometry.dispose();
    }
    this.ribbons = [];
    this.group = null;
  }
}
