// The ride of the wind (encounters/smith_heart/breath_isles.ts: a scripted
// arc out to an isle and home), a part of BreathIslesFx (looks:
// breath_isles_fx_core.ts):
//
//  - the launch (ISLE_CUES.rideUp at the circle): a funnel of wind spinning
//    up out of the Gale Path, flaring and thinning away, shock rings racing
//    out on the floor, grit and motes thrown up the column, a short shake;
//  - the ride: ribbons of wind wrapped round the rider, and a long ribbon
//    trail streaming behind along the arc it flew (its own past places), a
//    wake of motes;
//  - the landing (ISLE_CUES.rideDown where it sets the body down): a
//    downdraft slamming onto the isle, three shock rings, a ring of dust and
//    grit blown out, motes, a shake for whoever is near.
// On EVERY tier the funnel, the ribbons, the trail and the rings; the grit,
// the dust and the motes thin on the low tier. Built in the constructor
// under the host's root (its one gated attach); fixed pools; the trails'
// points are rewritten in place each frame.

import * as THREE from 'three';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import type { BreathIslesHost } from './breath_isles_fx';
import {
  ISLE_COLORS as C,
  funnelLook,
  ISLE_POOLS as P,
  ISLE_RGB as RGB,
  RIDE,
  RIDE_TRAIL,
  riderLook,
} from './breath_isles_fx_core';
import { FUNNEL_FRAG, ISLE_RIBBON_FRAG, ISLE_UV_VERT } from './breath_isles_glsl';

const RIBBON_DIR = new THREE.Vector3();
const FUNNELS = 4;

interface RiderSlot {
  group: THREE.Group;
  mats: THREE.ShaderMaterial[];
  trail: THREE.Mesh;
  trailMat: THREE.ShaderMaterial;
  trailPos: THREE.BufferAttribute;
  /** The trail's past places (x, y, z), oldest first, and how many. */
  past: Float32Array;
  count: number;
  sample: number;
  id: number;
  born: number;
  mote: number;
}

interface FunnelSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  live: boolean;
  scale: number;
}

/** A flat ribbon (a triangle strip as a list) along `pts`, `half` wide,
 *  its width horizontal (or vertical when `upright`); uv.x along 0..1. */
export function ribbonGeometry(
  pts: readonly { x: number; y: number; z: number }[],
  half: number,
  upright: boolean,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    RIBBON_DIR.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    let ax = 0;
    let ay = 1;
    let az = 0;
    if (!upright) {
      const l = Math.hypot(RIBBON_DIR.x, RIBBON_DIR.z) || 1;
      ax = -RIBBON_DIR.z / l;
      ay = 0;
      az = RIBBON_DIR.x / l;
    }
    const p = pts[i];
    pos.push(p.x - ax * half, p.y - ay * half, p.z - az * half);
    pos.push(p.x + ax * half, p.y + ay * half, p.z + az * half);
    const t = i / (n - 1);
    uv.push(t, 0, t, 1);
    if (i < n - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A helix ribbon round a body (body-local, `turns` round, `h` tall). */
function helixPoints(r: number, h: number, turns: number, phase: number) {
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = phase + t * turns * Math.PI * 2;
    const rr = r * (0.75 + 0.35 * Math.sin(t * Math.PI));
    pts.push({ x: Math.cos(a) * rr, y: 0.2 + t * h, z: Math.sin(a) * rr });
  }
  return pts;
}

export class BreathRideFx {
  private readonly riders: RiderSlot[] = [];
  private readonly funnels: FunnelSlot[] = [];
  private clock = 0;
  private seed = 0x6a2f;

  constructor(private readonly h: BreathIslesHost) {
    const ribbon = (color: number, flow: number, dash: number, fade: number) =>
      new THREE.ShaderMaterial({
        name: 'smithHeartBreathRiderWrap',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(color) },
          uCore: { value: new THREE.Color(C.pathCore) },
          uGlow: { value: 1 },
          uFlow: { value: flow },
          uDash: { value: dash },
          uFade: { value: fade },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_RIBBON_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
    for (let r = 0; r < P.riders; r++) {
      const group = new THREE.Group();
      group.visible = false;
      const mats: THREE.ShaderMaterial[] = [];
      for (let k = 0; k < 3; k++) {
        const mat = ribbon(k === 2 ? C.path : C.ribbon, 2.2, 3, 0.15);
        const geo = ribbonGeometry(helixPoints(1.3 + k * 0.35, 3.2, 1.6, k * 2.1), 0.26, true);
        h.geometries.push(geo);
        h.materials.push(mat);
        mats.push(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      h.root.add(group);
      // The trail: two crossed strips over the rider's past places.
      const N = RIDE_TRAIL.points;
      const posArr = new Float32Array(N * 4 * 3);
      const uvs: number[] = [];
      const idx: number[] = [];
      for (let strip = 0; strip < 2; strip++) {
        const o = strip * N * 2;
        for (let i = 0; i < N; i++) {
          uvs.push(i / (N - 1), 0, i / (N - 1), 1);
          if (i < N - 1) {
            const b = o + i * 2;
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(posArr, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', attr);
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      h.geometries.push(geo);
      const trailMat = ribbon(C.path, 3.2, 6, 0.08);
      h.materials.push(trailMat);
      const trail = new THREE.Mesh(geo, trailMat);
      trail.frustumCulled = false;
      trail.visible = false;
      h.root.add(trail);
      this.riders.push({
        group,
        mats,
        trail,
        trailMat,
        trailPos: attr,
        past: new Float32Array(N * 3),
        count: 0,
        sample: 0,
        id: -1,
        born: 0,
        mote: 0,
      });
    }
    // The funnels (the launch's, the landing's downdraft).
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      prof.push(new THREE.Vector2(0.9 + 2.6 * t * t, t));
    }
    const funnelGeo = new THREE.LatheGeometry(prof, 40);
    h.geometries.push(funnelGeo);
    for (let k = 0; k < FUNNELS; k++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathGaleFunnel',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.path) },
          uCore: { value: new THREE.Color(C.pathCore) },
          uLife: { value: 0 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: FUNNEL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(funnelGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      h.root.add(mesh);
      this.funnels.push({ mesh, mat, born: 0, live: false, scale: 1 });
    }
  }

  /** The scan's riders (keep a slot while its rider rides). */
  setRiders(seen: readonly number[]): void {
    for (const r of this.riders) {
      if (r.id >= 0 && !seen.includes(r.id)) {
        r.id = -1;
        r.group.visible = false;
        // The trail stays to fade (its tail runs out over the next frames).
      }
    }
    for (const id of seen) {
      if (this.riders.some((r) => r.id === id)) continue;
      const free =
        this.riders.find((r) => r.id < 0 && !r.trail.visible) ?? this.riders.find((r) => r.id < 0);
      if (!free) break;
      free.id = id;
      free.born = this.clock;
      free.count = 0;
      free.sample = 0;
      free.group.visible = true;
    }
  }

  update(world: IWorld, dt: number): void {
    this.clock += dt;
    const t = this.h.uTime.value;
    for (const r of this.riders) this.updateRider(world, r, t, dt);
    for (const f of this.funnels) {
      if (!f.live) continue;
      const look = funnelLook(this.clock - f.born);
      if (look.life <= 0) {
        f.live = false;
        f.mesh.visible = false;
        continue;
      }
      f.mesh.scale.set(look.spread * f.scale, look.h * Math.abs(f.scale), look.spread * f.scale);
      f.mesh.rotation.y = t * 2.4;
      f.mat.uniforms.uLife.value = look.life * 1.3;
    }
  }

  private updateRider(world: IWorld, r: RiderSlot, t: number, dt: number): void {
    const e = r.id >= 0 ? world.entities.get(r.id) : undefined;
    if (e) {
      const a = fxAnchor(e);
      const k = Math.min(1, (this.clock - r.born) / RIDE.seconds);
      const look = riderLook(k);
      r.group.position.set(a.x, a.y - 0.4, a.z);
      r.group.rotation.y = t * 5;
      r.group.scale.setScalar(0.85 + 0.45 * look.wrap);
      for (const m of r.mats) m.uniforms.uGlow.value = 0.7 + 1.1 * look.bright;
      // Its past places, every few hundredths of a second.
      r.sample -= dt;
      if (r.sample <= 0) {
        r.sample = RIDE_TRAIL.every;
        this.pushPast(r, a.x, e.pos.y + 1.1, a.z);
      }
      // A wake of motes off the ribbons (cosmetic).
      r.mote += dt * 30 * (0.4 + 0.6 * this.h.density);
      while (r.mote >= 1) {
        r.mote -= 1;
        this.h.particles.puff(a.x, e.pos.y + 0.6 + this.rand() * 1.8, a.z, 1, {
          speed: 0.5,
          life: 1,
          size: [0.8, 0.15],
          color: RGB.ribbon,
          alpha: 0.6,
          pool: 'glow',
          drag: 2,
        });
      }
    } else if (r.count > 0) {
      // Landed (or gone): the tail runs out.
      r.sample -= dt;
      if (r.sample <= 0) {
        r.sample = RIDE_TRAIL.every;
        this.dropPast(r);
      }
    }
    if (r.count < 2) {
      r.trail.visible = false;
      return;
    }
    r.trail.visible = true;
    r.trailMat.uniforms.uGlow.value = e ? 1.4 : 0.9;
    this.writeTrail(r);
  }

  private pushPast(r: RiderSlot, x: number, y: number, z: number): void {
    const N = RIDE_TRAIL.points;
    if (r.count === N) {
      r.past.copyWithin(0, 3);
      r.count = N - 1;
    }
    r.past[r.count * 3] = x;
    r.past[r.count * 3 + 1] = y;
    r.past[r.count * 3 + 2] = z;
    r.count++;
  }

  private dropPast(r: RiderSlot): void {
    if (r.count <= 0) return;
    r.past.copyWithin(0, 3);
    r.count--;
  }

  /** The trail's strips over its past places (oldest the tail, thin; the
   *  newest the head, wide); the unused stations collapse on the head. */
  private writeTrail(r: RiderSlot): void {
    const N = RIDE_TRAIL.points;
    const n = r.count;
    const at = (i: number, c: number) => r.past[Math.min(n - 1, i) * 3 + c];
    for (let i = 0; i < N; i++) {
      const j = Math.min(n - 1, Math.round((i / (N - 1)) * (n - 1)));
      const x = at(j, 0);
      const y = at(j, 1);
      const z = at(j, 2);
      const jn = Math.min(n - 1, j + 1);
      const jp = Math.max(0, j - 1);
      let dx = at(jn, 0) - at(jp, 0);
      let dz = at(jn, 2) - at(jp, 2);
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const w = 0.15 + 1.05 * (i / (N - 1));
      r.trailPos.setXYZ(i * 2, x, y - w, z);
      r.trailPos.setXYZ(i * 2 + 1, x, y + w, z);
      r.trailPos.setXYZ(N * 2 + i * 2, x + dz * w, y, z - dx * w);
      r.trailPos.setXYZ(N * 2 + i * 2 + 1, x - dz * w, y, z + dx * w);
    }
    r.trailPos.needsUpdate = true;
  }

  private funnel(x: number, y: number, z: number, scale: number): void {
    const f = this.funnels.find((q) => !q.live) ?? this.funnels[0];
    f.live = true;
    f.born = this.clock;
    f.scale = scale;
    f.mesh.position.set(x, y, z);
    f.mesh.visible = true;
  }

  /** ISLE_CUES.rideUp at world (x, z): the launch. */
  rideUp(x: number, z: number): void {
    const ground = this.h.groundY(x, z);
    this.funnel(x, ground, z, 1);
    this.h.particles.shockRing(x, z, C.path, 7, 0.6);
    this.h.particles.shockRing(x, z, 0xffffff, 4, 0.35);
    this.h.particles.puff(x, ground + 0.5, z, Math.round(26 * this.h.density), {
      speed: 6,
      up: 14,
      life: 1.1,
      size: [0.6, 1.8],
      color: RGB.ribbon,
      alpha: 0.6,
      drag: 1.2,
      radius: 1.6,
    });
    this.h.particles.puff(x, ground + 1, z, Math.round(20 * this.h.density), {
      speed: 3,
      up: 18,
      life: 0.9,
      size: [0.4, 0.1],
      color: RGB.path,
      alpha: 1,
      pool: 'glow',
      radius: 1.2,
    });
    this.h.shakeNear(x, z, 0.16, 14);
  }

  /** ISLE_CUES.rideDown at world (x, z): the landing on the isle. */
  rideDown(x: number, z: number): void {
    const ground = this.h.groundY(x, z);
    // The downdraft: a short wide funnel slamming down onto the floor.
    this.funnel(x, ground, z, 1.6);
    this.h.particles.shockRing(x, z, C.path, 11, 0.8);
    this.h.particles.shockRing(x, z, 0xffffff, 6, 0.45);
    this.h.particles.shockRing(x, z, C.rune, 15, 1.1);
    this.h.particles.puff(x, ground + 0.3, z, Math.round(34 * this.h.density), {
      speed: 11,
      up: 1.5,
      life: 1.1,
      size: [0.8, 2.6],
      color: RGB.dust,
      alpha: 0.55,
      drag: 1.6,
      radius: 1,
    });
    this.h.particles.puff(x, ground + 0.6, z, Math.round(22 * this.h.density), {
      speed: 7,
      up: 5,
      life: 0.7,
      size: [0.45, 0.1],
      color: RGB.path,
      alpha: 1,
      pool: 'glow',
      radius: 0.8,
    });
    this.h.shakeNear(x, z, 0.32, 16);
  }

  leave(): void {
    for (const r of this.riders) {
      r.id = -1;
      r.count = 0;
      r.group.visible = false;
      r.trail.visible = false;
    }
    for (const f of this.funnels) {
      f.live = false;
      f.mesh.visible = false;
    }
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}
