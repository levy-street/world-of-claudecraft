// King of the Hill: the circle on the ground (src/sim/pvp/hill.ts, read
// through IWorld.hillInfo). Two terrain-draped meshes, an interior wash and a
// rim glow, keyed by the hill's geometry so a new hill is a new mesh set and a
// holder change only retints the standing one; the colour and the pulse come
// from the pure core (hill_ring_core.ts).
//
// The circle reads as light on the ground, not a sheet over it: both meshes are
// dense grids draped vertex by vertex on the terrain (a vertex every couple of
// yards along each radius, and around the circumference), so they follow a
// slope instead of cutting through it, and their per-vertex alpha follows the
// core's radial curves: the wash is clear at the centre and thickens toward
// the edge, and the rim is a soft additive glow that feathers in and out of the
// true radius instead of a hard band.

import * as THREE from 'three';
import type { HillInfo } from '../world_api/world_pvp';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import {
  HILL_RADIAL_STEP_YARDS,
  HILL_RIM_INNER_T,
  HILL_RIM_OUTER_T,
  HILL_RIM_STEP_YARDS,
  hillFillAlpha,
  hillPulseSpeed,
  hillRadialStops,
  hillRimAlpha,
  hillRingKey,
  hillRingPlan,
} from './hill_ring_core';

/** Around the circumference: about two yards apart on a 50 yd circle. */
const SEGMENTS = 160;
/** Lift over the sampled ground; the materials' polygon offset does the rest. */
const GROUND_LIFT = 0.12;

interface RingVisual {
  group: THREE.Group;
  rimMat: THREE.MeshBasicMaterial;
  fillMat: THREE.MeshBasicMaterial;
  ownedGeometries: THREE.BufferGeometry[];
  phase: number;
  hillPhase: HillInfo['phase'];
  holder: HillInfo['holder'];
  challenger: HillInfo['challenger'];
}

export class HillRingVisuals {
  private visual: { key: string; ring: RingVisual } | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  /** Called each frame with IWorld.hillInfo (null while no hill stands). */
  sync(info: HillInfo | null): void {
    if (!info) {
      this.clear();
      return;
    }
    const key = hillRingKey(info);
    if (this.visual && this.visual.key !== key) this.clear();
    if (!this.visual) this.visual = { key, ring: this.create(info) };
    this.visual.ring.hillPhase = info.phase;
    this.visual.ring.holder = info.holder;
    this.visual.ring.challenger = info.challenger;
  }

  /** Called each frame with the elapsed frame time in seconds. */
  update(dt: number): void {
    const ring = this.visual?.ring;
    if (!ring) return;
    const contested = ring.challenger !== 'none';
    ring.phase = (ring.phase + dt * hillPulseSpeed(contested)) % (Math.PI * 2);
    const plan = hillRingPlan(ring.phase, {
      phase: ring.hillPhase,
      holder: ring.holder,
      challenger: ring.challenger,
    });
    ring.rimMat.color.setHex(plan.color);
    ring.fillMat.color.setHex(plan.color);
    ring.rimMat.opacity = plan.ringOpacity;
    ring.fillMat.opacity = plan.fillOpacity;
  }

  private clear(): void {
    if (!this.visual) return;
    const ring = this.visual.ring;
    this.scene.remove(ring.group);
    ring.rimMat.dispose();
    ring.fillMat.dispose();
    for (const geo of ring.ownedGeometries) geo.dispose();
    this.visual = null;
  }

  private material(color: number, opacity: number, additive: boolean): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
  }

  private create(info: HillInfo): RingVisual {
    const group = new THREE.Group();
    group.name = 'hill-ring';
    const plan = hillRingPlan(0, info);
    const fillMat = this.material(plan.color, plan.fillOpacity, false);
    const rimMat = this.material(plan.color, plan.ringOpacity, true);
    const fillStops = hillRadialStops(info.radius, 0, 1, HILL_RADIAL_STEP_YARDS);
    const rimStops = hillRadialStops(
      info.radius,
      HILL_RIM_INNER_T,
      HILL_RIM_OUTER_T,
      HILL_RIM_STEP_YARDS,
    );
    const fillGeo = this.drapedBand(info, fillStops, hillFillAlpha);
    const rimGeo = this.drapedBand(info, rimStops, hillRimAlpha);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    // Ground band, above the world's own marks and under every player and boss
    // floor effect (docs/design/vfx-floor-layering.md).
    fill.renderOrder = floorVfxRenderOrder('ground', 5);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.renderOrder = floorVfxRenderOrder('ground', 6);
    group.add(fill, rim);
    this.scene.add(group);
    return {
      group,
      rimMat,
      fillMat,
      ownedGeometries: [fillGeo, rimGeo],
      phase: 0,
      hillPhase: info.phase,
      holder: info.holder,
      challenger: info.challenger,
    };
  }

  /** A terrain-draped polar grid over the radial `stops` (fractions of the
   *  radius), every vertex sampled on the ground, with a white RGBA vertex
   *  colour whose alpha is `alpha(t)` so the material colour tints it. */
  private drapedBand(
    info: Pick<HillInfo, 'x' | 'z' | 'radius'>,
    stops: readonly number[],
    alpha: (t: number) => number,
  ): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const ringSize = SEGMENTS + 1;
    for (const t of stops) {
      const r = t * info.radius;
      const a0 = alpha(t);
      for (let i = 0; i <= SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        const px = info.x + Math.cos(a) * r;
        const pz = info.z + Math.sin(a) * r;
        positions.push(px, this.groundY(px, pz) + GROUND_LIFT, pz);
        colors.push(1, 1, 1, a0);
      }
    }
    for (let s = 0; s < stops.length - 1; s++) {
      const inner = s * ringSize;
      const outer = (s + 1) * ringSize;
      for (let i = 0; i < SEGMENTS; i++) {
        indices.push(inner + i, outer + i, inner + i + 1, inner + i + 1, outer + i, outer + i + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
    geo.setIndex(indices);
    return geo;
  }
}
