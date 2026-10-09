// The trash engine's quench zones (DungeonDef.quenchZones, sim/mob/trash_kit/
// brand.ts): the static pools of a dungeon that put out a brand the moment
// its victim stands in one. Painted while the local player is in a dungeon
// that has them (the Gravewyrm Sanctum's meltwater pools, QUENCH_POOLS), in
// the slot the player stands in: calm, clearly COLD meltwater thawed out of
// the snow, a deep teal centre, slow ripples, a glitter of light, and a cool
// cyan rim glowing so a branded player finds one at a glance. Never the
// threat palette: it is the cure.
//
// Permanent level dressing: one merged draw of every pool, draped on the
// floor once each time the slot changes, on the floor ladder's ground band
// (every encounter telegraph paints over it); a mist breathing off them is
// cosmetic and thins on the low tier. ACTIONABLE (it is where the brand goes
// out), so the pools themselves draw on every tier. Built once under the
// host's root before its gated attach; no light; no per-frame allocation.
//
// No z-fight with the floor it lies on (the playtest saw the pools flicker on
// the Sledge Road): the vertices are stored in the slot's own frame round an
// anchor the mesh is placed at (a dungeon slot sits about 100,000 yd out,
// where a float32 world position is only good to a centimetre and the GPU's
// view transform jitters by more), each vertex sampled on the real floor, and
// the vertex shader pulls it QUENCH_DEPTH_PULL toward the camera along its own
// view ray: the pool keeps its exact pixels but always wins the depth test
// against its floor, while a body or a wall standing in it still hides it
// above its lowest few centimetres (it reads as wading).

import * as THREE from 'three';
import { dungeonAt, instanceSlotForZ } from '../../sim/data';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { NOISE_GLSL, SURFACE_LIFT } from './engine_geometry';
import { type QuenchPool, quenchPoolsAt } from './trash_engine_fx_core';
import type { TrashEngineHost } from './trash_engine_host';

/** The most pools one dungeon slot paints (the geometry is sized for it). */
const MAX_POOLS = 16;
const RINGS = 4;
const SEGS = 40;
const PER_POOL = 1 + RINGS * SEGS;
/** Yards each pool vertex is pulled toward the camera (at most a quarter of
 *  its distance to the eye): the depth margin over the floor under it. Small,
 *  since the slot frame already took the float jitter out: only the lowest
 *  few centimetres of a body standing in the pool read as wading. */
export const QUENCH_DEPTH_PULL = 0.08;

const VERT = /* glsl */ `
attribute vec2 aUnit;
attribute float aRadius;
varying vec2 vP;
varying float vRadius;
varying vec3 vWorld;
void main() {
  vP = aUnit;
  vRadius = aRadius;
  // The slot frame (small numbers): the ripples and glints key on it.
  vWorld = position;
  // Eye space through the CPU-composed modelViewMatrix (double precision on
  // the CPU, so no 100,000 yd world coordinate ever reaches the GPU), then a
  // pull toward the eye along the view ray: same pixel, nearer depth.
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dc = max(length(mv.xyz), 1e-3);
  mv.xyz -= mv.xyz * (min(${QUENCH_DEPTH_PULL.toFixed(3)}, dc * 0.25) / dc);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vP;
varying float vRadius;
varying vec3 vWorld;
${NOISE_GLSL}
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  vec2 w = vWorld.xz;
  // Slow, cold water: a deep teal heart, paler shallows, lazy ripples.
  float n = fbm(w * 0.7 + vec2(uTime * 0.08, -uTime * 0.05));
  float ripple = 0.5 + 0.5 * sin(r * vRadius * 5.0 - uTime * 1.4 + n * 3.0);
  vec3 deep = vec3(0.05, 0.27, 0.36);
  vec3 shallow = vec3(0.38, 0.72, 0.82);
  vec3 col = mix(deep, shallow, smoothstep(0.15, 0.95, r) * 0.8 + n * 0.25);
  col += vec3(0.6, 0.9, 1.0) * ripple * 0.08;
  // Glints of light on the surface.
  float g = vnoise(w * 6.0 + uTime * 0.6);
  col += vec3(0.85, 0.97, 1.0) * smoothstep(0.86, 0.98, g) * 0.7;
  // The cool rim: a cyan lip where the meltwater meets the snow.
  float lip = smoothstep(0.78, 0.94, r) * (1.0 - smoothstep(0.94, 1.0, r));
  float breathe = 0.85 + 0.15 * sin(uTime * 1.6 + w.x * 0.3);
  col += vec3(0.45, 0.95, 1.0) * lip * 1.1 * breathe;
  float a = (0.8 + 0.15 * n) * (1.0 - smoothstep(0.95, 1.0, r));
  gl_FragColor = vec4(col, a);
}
`;

export class EngineQuench {
  private readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.ShaderMaterial;
  private pools: QuenchPool[] = [];
  /** The dungeon and slot painted now ('' : none). */
  private key = '';
  private mist = 0;

  constructor(private readonly host: TrashEngineHost) {
    const count = MAX_POOLS * PER_POOL;
    const pos = new Float32Array(count * 3);
    const unit = new Float32Array(count * 2);
    const radius = new Float32Array(count);
    const index: number[] = [];
    for (let p = 0; p < MAX_POOLS; p++) {
      const o = p * PER_POOL;
      for (let r = 0; r < RINGS; r++) {
        const rr = (r + 1) / RINGS;
        for (let i = 0; i < SEGS; i++) {
          const a = (i / SEGS) * Math.PI * 2;
          const k = o + 1 + r * SEGS + i;
          unit[k * 2] = Math.cos(a) * rr;
          unit[k * 2 + 1] = Math.sin(a) * rr;
        }
      }
      for (let i = 0; i < SEGS; i++) index.push(o, o + 1 + ((i + 1) % SEGS), o + 1 + i);
      for (let r = 0; r + 1 < RINGS; r++) {
        const a0 = o + 1 + r * SEGS;
        const b0 = o + 1 + (r + 1) * SEGS;
        for (let i = 0; i < SEGS; i++) {
          const j = (i + 1) % SEGS;
          index.push(a0 + i, a0 + j, b0 + i, a0 + j, b0 + j, b0 + i);
        }
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aUnit', new THREE.BufferAttribute(unit, 2));
    this.geo.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
    this.geo.setIndex(index);
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      name: 'trashEngineQuenchPools',
      uniforms: { uTime: host.uTime },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'trashEngineQuenchPools';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = floorVfxRenderOrder('ground', 7);
    host.root.add(this.mesh);
  }

  /** Lay out the pools of (dungeon, slot) on the floor (once per change). */
  private layOut(pools: QuenchPool[]): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const unit = this.geo.getAttribute('aUnit') as THREE.BufferAttribute;
    const radius = this.geo.getAttribute('aRadius') as THREE.BufferAttribute;
    const n = Math.min(MAX_POOLS, pools.length);
    // The slot frame: every vertex relative to the first pool's floor point.
    const ax = n > 0 ? pools[0].x : 0;
    const az = n > 0 ? pools[0].z : 0;
    const ay = n > 0 ? this.host.groundY(ax, az) : 0;
    this.mesh.position.set(ax, ay, az);
    for (let p = 0; p < n; p++) {
      const q = pools[p];
      for (let v = 0; v < PER_POOL; v++) {
        const k = p * PER_POOL + v;
        const x = q.x + unit.getX(k) * q.r;
        const z = q.z + unit.getY(k) * q.r;
        pos.setXYZ(k, x - ax, this.host.groundY(x, z) - ay + SURFACE_LIFT, z - az);
        radius.setX(k, q.r);
      }
    }
    pos.needsUpdate = true;
    radius.needsUpdate = true;
    this.geo.setDrawRange(0, n * (SEGS * 3 + (RINGS - 1) * SEGS * 6));
    this.geo.computeBoundingSphere();
    this.pools = pools.slice(0, n);
  }

  update(dt: number): void {
    const me = this.host.world.player;
    const dungeon = me ? dungeonAt(me.pos.x) : null;
    const zones = dungeon?.quenchZones;
    if (!me || !dungeon || !zones || zones.length === 0) {
      if (this.key !== '') {
        this.key = '';
        this.mesh.visible = false;
      }
      return;
    }
    const slot = instanceSlotForZ(me.pos.z);
    const key = `${dungeon.id}:${slot}`;
    if (key !== this.key) {
      this.key = key;
      this.layOut(quenchPoolsAt(dungeon.id, slot));
      this.mesh.visible = this.pools.length > 0;
    }
    // A cold mist breathing off the water now and then.
    this.mist += dt * 1.6 * this.host.density * this.pools.length;
    while (this.mist >= 1) {
      this.mist -= 1;
      const q = this.pools[Math.floor(this.host.rand() * this.pools.length)];
      if (!q) break;
      this.host.puff(q.x, this.host.groundY(q.x, q.z) + 0.15, q.z, 1, {
        speed: 0.15,
        up: 0.35,
        life: 3,
        size: [1, 2.6],
        color: [0.82, 0.93, 0.98],
        alpha: 0.16,
        radius: q.r * 0.8,
        drag: 1,
      });
    }
  }

  hideAll(): void {
    this.key = '';
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
