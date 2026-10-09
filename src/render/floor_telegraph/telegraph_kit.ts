// The shared floor-telegraph shapes (look: telegraph_look_core.ts, shaders:
// telegraph_material.ts): pooled fans (a cone, a ring, a kick glyph) and
// lanes, each a footprint draped on the real floor plus a cosmetic glowing
// curtain on its edge. The Hollow Crypt and Sunken Bastion painters and the
// Bastion's boss casts all lay their telegraphs through one kit, so every
// dungeon's telegraphs read alike.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built once per
// slot when the owner builds its pool (attached through the owner's compile
// gate), no per-frame allocation. The footprint (tint, fill, fill front,
// outline) draws on every graphics tier; the curtain and the flowing bands and
// motes are cosmetic and shed on the low tier.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  TELEGRAPH_CURTAIN_HEIGHT,
  type TelegraphLook,
  telegraphLook,
  telegraphOutline,
} from './telegraph_look_core';
import {
  createTelegraphCurtainMaterial,
  createTelegraphFloorMaterial,
  type TelegraphCurtainMaterial,
  type TelegraphFloorMaterial,
} from './telegraph_material';

/** Arc segments of a fan and rings of vertices out from its apex (the
 *  rings let the footprint follow a stair or a ramp under it). */
const ARC = 48;
const RINGS = 5;
const FLANK = 10;
const MAX_STATIONS = ARC + 1 + 2 * FLANK;
const LANE_STEPS = 24;
/** How far a telegraph floats over the floor it drapes on (no z-fight). */
const LIFT = 0.07;

export interface TelegraphStyle {
  /** The threat colour (TELEGRAPH_THREAT_COLORS). */
  color: number;
  /** The element accent for motes and the fill front (default: the colour). */
  accent?: number;
  /** A kick glyph instead of a filling footprint. */
  sigil?: boolean;
}

export interface TelegraphFan {
  group: THREE.Group;
  floor: THREE.Mesh;
  floorMat: TelegraphFloorMaterial;
  curtain: THREE.Mesh | null;
  curtainMat: TelegraphCurtainMaterial | null;
  /** The arc (degrees) the geometry was last laid out for. */
  laidArc: number;
  /** Unit (x, z) of every footprint vertex, kept to drape each frame. */
  unitFloor: Float32Array;
  /** Unit (x, z) of every curtain station and how many are live. */
  unitStations: Float32Array;
  stations: number;
}

export interface TelegraphLane {
  group: THREE.Group;
  floor: THREE.Mesh;
  floorMat: TelegraphFloorMaterial;
  curtain: THREE.Mesh | null;
  curtainMat: TelegraphCurtainMaterial | null;
}

export interface TelegraphPaint {
  /** 0..1 of the cast bar (1: landing). */
  fill: number;
  /** The painter's clock (seconds). */
  clock: number;
  /** Yards: a fan's radius or a lane's length. */
  range: number;
  /** 0..1 master fade (flashes and bursts fading out). */
  fade?: number;
  /** Override the fill front's brightness (a flash has none). */
  front?: number;
}

function fanFloorGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const count = 1 + RINGS * (ARC + 1);
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const index: number[] = [];
  for (let i = 0; i < ARC; i++) index.push(0, 1 + i, 2 + i);
  for (let r = 0; r + 1 < RINGS; r++) {
    const a0 = 1 + r * (ARC + 1);
    const b0 = a0 + ARC + 1;
    for (let i = 0; i < ARC; i++) {
      index.push(a0 + i, b0 + i, a0 + i + 1, a0 + i + 1, b0 + i, b0 + i + 1);
    }
  }
  g.setIndex(index);
  return g;
}

function curtainGeometry(stations: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(stations * 2 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  g.setAttribute(
    'aAlong',
    new THREE.BufferAttribute(new Float32Array(stations * 2), 1).setUsage(THREE.DynamicDrawUsage),
  );
  const h = new Float32Array(stations * 2);
  for (let i = 0; i < stations; i++) h[i * 2 + 1] = 1;
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  const index: number[] = [];
  for (let i = 0; i + 1 < stations; i++) {
    const b = i * 2;
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  g.setIndex(index);
  return g;
}

function laneFloorGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array((LANE_STEPS + 1) * 3 * 3), 3).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  const index: number[] = [];
  for (let i = 0; i < LANE_STEPS; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      const b = a + 3;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  g.setIndex(index);
  return g;
}

function applyLook(m: TelegraphFloorMaterial, look: TelegraphLook, p: TelegraphPaint): void {
  const u = m.uniforms;
  u.uFill.value = p.fill;
  u.uTime.value = p.clock;
  u.uBase.value = look.base;
  u.uFilled.value = look.filled;
  u.uFront.value = p.front ?? look.front;
  u.uRim.value = look.rim;
  u.uWarn.value = look.warn;
  u.uDetail.value = look.detail;
  u.uFade.value = p.fade ?? 1;
}

export class TelegraphKit {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** One reused look (paintFan and paintLane allocate nothing per frame). */
  private readonly look: TelegraphLook = {
    base: 0,
    filled: 0,
    front: 0,
    rim: 0,
    warn: 0,
    detail: 0,
  };

  /** `detail`: the cosmetic layers (off on the low tier). */
  constructor(
    private readonly root: THREE.Group,
    private readonly detail: boolean,
  ) {}

  /** A pooled fan on encounter rung `order` (its curtain two rungs above). */
  fan(order: number): TelegraphFan {
    const floorGeo = fanFloorGeometry();
    const floorMat = createTelegraphFloorMaterial(false);
    this.geometries.push(floorGeo);
    this.materials.push(floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.renderOrder = floorVfxRenderOrder('encounter', order);
    floor.frustumCulled = false;
    const group = new THREE.Group();
    group.visible = false;
    group.add(floor);
    let curtain: THREE.Mesh | null = null;
    let curtainMat: TelegraphCurtainMaterial | null = null;
    if (this.detail) {
      const geo = curtainGeometry(MAX_STATIONS);
      curtainMat = createTelegraphCurtainMaterial();
      this.geometries.push(geo);
      this.materials.push(curtainMat);
      curtain = new THREE.Mesh(geo, curtainMat);
      curtain.renderOrder = floorVfxRenderOrder('encounter', order + 2);
      curtain.frustumCulled = false;
      group.add(curtain);
    }
    this.root.add(group);
    return {
      group,
      floor,
      floorMat,
      curtain,
      curtainMat,
      laidArc: -1,
      unitFloor: new Float32Array((1 + RINGS * (ARC + 1)) * 2),
      unitStations: new Float32Array(MAX_STATIONS * 2),
      stations: 0,
    };
  }

  /** A pooled lane on encounter rung `order`. */
  lane(order: number): TelegraphLane {
    const floorGeo = laneFloorGeometry();
    const floorMat = createTelegraphFloorMaterial(true);
    this.geometries.push(floorGeo);
    this.materials.push(floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.renderOrder = floorVfxRenderOrder('encounter', order);
    floor.frustumCulled = false;
    const group = new THREE.Group();
    group.visible = false;
    group.add(floor);
    let curtain: THREE.Mesh | null = null;
    let curtainMat: TelegraphCurtainMaterial | null = null;
    if (this.detail) {
      // Both long edges as one strip each: 2 x (steps + 1) stations.
      const geo = curtainGeometry((LANE_STEPS + 1) * 2);
      const idx: number[] = [];
      for (let side = 0; side < 2; side++) {
        const o = side * (LANE_STEPS + 1);
        for (let i = 0; i < LANE_STEPS; i++) {
          const b = (o + i) * 2;
          idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      geo.setIndex(idx);
      curtainMat = createTelegraphCurtainMaterial();
      this.geometries.push(geo);
      this.materials.push(curtainMat);
      curtain = new THREE.Mesh(geo, curtainMat);
      curtain.renderOrder = floorVfxRenderOrder('encounter', order + 2);
      curtain.frustumCulled = false;
      group.add(curtain);
    }
    this.root.add(group);
    return { group, floor, floorMat, curtain, curtainMat };
  }

  /** Lay a fan out for an arc (360: a ring) and set its colours. */
  layOutFan(f: TelegraphFan, arcDeg: number, style: TelegraphStyle): void {
    const u = f.floorMat.uniforms;
    u.uColor.value.setHex(style.color);
    u.uAccent.value.setHex(style.accent ?? style.color);
    u.uSigil.value = style.sigil ? 1 : 0;
    if (f.curtainMat) {
      f.curtainMat.uniforms.uColor.value.setHex(style.color);
      f.curtainMat.uniforms.uAccent.value.setHex(style.accent ?? style.color);
    }
    if (f.laidArc === arcDeg) return;
    f.laidArc = arcDeg;
    const half = (Math.min(360, arcDeg) * Math.PI) / 180 / 2;
    u.uHalfArc.value = arcDeg >= 360 ? Math.PI * 1.01 : half;
    const pos = f.floor.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, 0, 0, 0);
    f.unitFloor[0] = 0;
    f.unitFloor[1] = 0;
    for (let r = 0; r < RINGS; r++) {
      const radius = (r + 1) / RINGS;
      for (let i = 0; i <= ARC; i++) {
        const a = -half + (2 * half * i) / ARC;
        const k = 1 + r * (ARC + 1) + i;
        const x = Math.sin(a) * radius;
        const z = Math.cos(a) * radius;
        pos.setXYZ(k, x, 0, z);
        f.unitFloor[k * 2] = x;
        f.unitFloor[k * 2 + 1] = z;
      }
    }
    pos.needsUpdate = true;
    if (f.curtain) {
      const outline = telegraphOutline(arcDeg, ARC, FLANK);
      f.stations = outline.points.length;
      const along = f.curtain.geometry.getAttribute('aAlong') as THREE.BufferAttribute;
      for (let i = 0; i < f.stations; i++) {
        f.unitStations[i * 2] = outline.points[i][0];
        f.unitStations[i * 2 + 1] = outline.points[i][1];
        along.setX(i * 2, outline.along[i]);
        along.setX(i * 2 + 1, outline.along[i]);
      }
      along.needsUpdate = true;
      f.curtain.geometry.setDrawRange(0, Math.max(0, f.stations - 1) * 6);
    }
  }

  /**
   * Drape a fan on the floor under its own world spot: `y` is the floor under
   * (x, z); the group floats a hand over it with yaw `yaw` and horizontal
   * scale `range`, and every vertex takes the ground height under its own
   * spot (a cone down a stair stays on the steps).
   */
  drapeFan(
    f: TelegraphFan,
    groundY: (x: number, z: number) => number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    range: number,
  ): void {
    f.group.position.set(x, y + LIFT, z);
    f.group.rotation.y = yaw;
    f.group.scale.set(range, 1, range);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const pos = f.floor.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const lx = f.unitFloor[i * 2] * range;
      const lz = f.unitFloor[i * 2 + 1] * range;
      pos.setY(i, groundY(x + lx * c + lz * s, z - lx * s + lz * c) - y);
    }
    pos.needsUpdate = true;
    if (f.curtain) {
      const cp = f.curtain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < f.stations; i++) {
        const ux = f.unitStations[i * 2];
        const uz = f.unitStations[i * 2 + 1];
        const g =
          groundY(x + ux * range * c + uz * range * s, z - ux * range * s + uz * range * c) - y;
        cp.setXYZ(i * 2, ux, g, uz);
        cp.setXYZ(i * 2 + 1, ux, g + TELEGRAPH_CURTAIN_HEIGHT, uz);
      }
      cp.needsUpdate = true;
    }
  }

  /** Paint a fan's layers for this frame. */
  paintFan(f: TelegraphFan, p: TelegraphPaint): void {
    const look = telegraphLook(p.fill, p.clock, this.detail, this.look);
    applyLook(f.floorMat, look, p);
    f.floorMat.uniforms.uRange.value = p.range;
    if (f.curtainMat) {
      const cu = f.curtainMat.uniforms;
      cu.uTime.value = p.clock;
      cu.uScale.value = p.range;
      cu.uStrength.value = 0.35 + 0.45 * p.fill + 0.35 * look.warn;
      cu.uFade.value = p.fade ?? 1;
    }
  }

  /** Lay a lane of `length` x 2 `half` from (x, z) along `yaw` on the floor. */
  drapeLane(
    l: TelegraphLane,
    groundY: (x: number, z: number) => number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    length: number,
    half: number,
    style: TelegraphStyle,
  ): void {
    l.group.position.set(x, y + LIFT, z);
    const ax = Math.sin(yaw);
    const az = Math.cos(yaw);
    const px = az;
    const pz = -ax;
    const u = l.floorMat.uniforms;
    u.uColor.value.setHex(style.color);
    u.uAccent.value.setHex(style.accent ?? style.color);
    u.uDir.value.set(ax, az);
    u.uLen.value = Math.max(0.1, length);
    u.uHalf.value = half;
    const pos = l.floor.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= LANE_STEPS; i++) {
      const t = (i / LANE_STEPS) * length;
      for (let k = 0; k < 3; k++) {
        const w = (k - 1) * half;
        const wx = x + ax * t + px * w;
        const wz = z + az * t + pz * w;
        pos.setXYZ(i * 3 + k, wx - x, groundY(wx, wz) - y, wz - z);
      }
    }
    pos.needsUpdate = true;
    if (l.curtain && l.curtainMat) {
      l.curtainMat.uniforms.uColor.value.setHex(style.color);
      l.curtainMat.uniforms.uAccent.value.setHex(style.accent ?? style.color);
      const cp = l.curtain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const along = l.curtain.geometry.getAttribute('aAlong') as THREE.BufferAttribute;
      for (let side = 0; side < 2; side++) {
        const w = side === 0 ? -half : half;
        for (let i = 0; i <= LANE_STEPS; i++) {
          const t = (i / LANE_STEPS) * length;
          const wx = x + ax * t + px * w;
          const wz = z + az * t + pz * w;
          const g = groundY(wx, wz) - y;
          const k = (side * (LANE_STEPS + 1) + i) * 2;
          cp.setXYZ(k, wx - x, g, wz - z);
          cp.setXYZ(k + 1, wx - x, g + TELEGRAPH_CURTAIN_HEIGHT, wz - z);
          along.setX(k, t);
          along.setX(k + 1, t);
        }
      }
      cp.needsUpdate = true;
      along.needsUpdate = true;
    }
  }

  /** Paint a lane's layers for this frame. */
  paintLane(l: TelegraphLane, p: TelegraphPaint): void {
    const look = telegraphLook(p.fill, p.clock, this.detail, this.look);
    applyLook(l.floorMat, look, p);
    if (l.curtainMat) {
      const cu = l.curtainMat.uniforms;
      cu.uTime.value = p.clock;
      cu.uScale.value = 1;
      cu.uStrength.value = 0.35 + 0.45 * p.fill + 0.35 * look.warn;
      cu.uFade.value = p.fade ?? 1;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
