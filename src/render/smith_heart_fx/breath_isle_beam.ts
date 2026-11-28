// A pooled beam of wind for the Islands of the Wind (a part of
// breath_isle_adds_fx.ts's Mending Gale and breath_stillstone_fx.ts's
// channel): two crossed strips on an arc from one point to another (it
// reads from any side), a bright braided core and a soft sheath with pulses
// racing along it (MEND_BEAM_FRAG); cut, it parts at its middle. Built once
// (its strip rewritten in place each frame it shows), one draw each, no
// per-frame allocation. Presentation only.

import * as THREE from 'three';
import { ISLE_UV_VERT, MEND_BEAM_FRAG } from './breath_isles_glsl';

const STEPS = 28;

/** What a beam reads off its host. */
export interface IsleBeamHost {
  readonly root: THREE.Group;
  readonly uTime: { value: number };
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
}

const _p = { x: 0, y: 0, z: 0 };
/** The arc's points as laid (x, y, z per step), reused. */
const _pts = new Float32Array((STEPS + 1) * 3);

export class IsleBeam {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private readonly pos: THREE.BufferAttribute;

  constructor(h: IsleBeamHost, name: string, color: number, core: number) {
    const posArr = new Float32Array((STEPS + 1) * 4 * 3);
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let strip = 0; strip < 2; strip++) {
      const o = strip * (STEPS + 1) * 2;
      for (let i = 0; i <= STEPS; i++) {
        uvs.push(i / STEPS, 0, i / STEPS, 1);
        if (i < STEPS) {
          const b = o + i * 2;
          idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(posArr, 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    h.geometries.push(geo);
    this.mat = new THREE.ShaderMaterial({
      name,
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(color) },
        uCore: { value: new THREE.Color(core) },
        uGlow: { value: 1 },
        uCut: { value: 0 },
        uSheath: { value: 1 },
      },
      vertexShader: ISLE_UV_VERT,
      fragmentShader: MEND_BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.mat);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    h.root.add(this.mesh);
  }

  /** A point on the arc from a to b at k (0..1), lifted by `lift` yards at
   *  its middle and wobbling by `wob` (its clock `t`). */
  static point(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    k: number,
    lift: number,
    wob: number,
    t: number,
    out: { x: number; y: number; z: number } = _p,
  ): { x: number; y: number; z: number } {
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const ax = -(b.z - a.z) / d;
    const az = (b.x - a.x) / d;
    const w = Math.sin(k * 9 - t * 6) * wob * Math.sin(k * Math.PI);
    out.x = a.x + (b.x - a.x) * k + ax * w;
    out.y = a.y + (b.y - a.y) * k + Math.sin(k * Math.PI) * lift;
    out.z = a.z + (b.z - a.z) * k + az * w;
    return out;
  }

  /** Lay the beam from a to b (world), `half` yards wide at its start. */
  lay(
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    half: number,
    lift: number,
    wob: number,
    t: number,
  ): void {
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const ax = -(b.z - a.z) / d;
    const az = (b.x - a.x) / d;
    const n = STEPS + 1;
    for (let i = 0; i <= STEPS; i++) {
      const p = IsleBeam.point(a, b, i / STEPS, lift, wob, t);
      _pts[i * 3] = p.x;
      _pts[i * 3 + 1] = p.y;
      _pts[i * 3 + 2] = p.z;
    }
    for (let i = 0; i <= STEPS; i++) {
      // The two strips stand across the arc's own direction here (a steep
      // stretch, two bodies close together, never collapses into a slab).
      const i0 = Math.max(0, i - 1) * 3;
      const i1 = Math.min(STEPS, i + 1) * 3;
      const tx = _pts[i1] - _pts[i0];
      const ty = _pts[i1 + 1] - _pts[i0 + 1];
      const tz = _pts[i1 + 2] - _pts[i0 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      // Across: level and square to the arc (tangent x up), else the chord's.
      let sx = -tz;
      let sz = tx;
      let sl = Math.hypot(sx, sz);
      if (sl < 1e-4 * tl) {
        sx = ax;
        sz = az;
        sl = 1;
      }
      sx /= sl;
      sz /= sl;
      // Up: square to both (across x tangent).
      let ux = (sz * ty) / tl;
      let uy = (-sz * tx + sx * tz) / tl;
      let uz = (-sx * ty) / tl;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const w = half * (1 - 0.3 * (i / STEPS));
      const px = _pts[i * 3];
      const py = _pts[i * 3 + 1];
      const pz = _pts[i * 3 + 2];
      this.pos.setXYZ(i * 2, px - ux * w, py - uy * w, pz - uz * w);
      this.pos.setXYZ(i * 2 + 1, px + ux * w, py + uy * w, pz + uz * w);
      this.pos.setXYZ(n * 2 + i * 2, px - sx * w, py, pz - sz * w);
      this.pos.setXYZ(n * 2 + i * 2 + 1, px + sx * w, py, pz + sz * w);
    }
    this.pos.needsUpdate = true;
    this.mesh.visible = true;
  }

  /** Its light and its cut (0 whole, 1 parted). */
  paint(glow: number, cut: number): void {
    this.mat.uniforms.uGlow.value = glow;
    this.mat.uniforms.uCut.value = cut;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}
