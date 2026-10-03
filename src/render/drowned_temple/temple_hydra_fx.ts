// The Mere Hydra's sixth-pass visuals, composed by temple_hydra.ts:
//  - each head's ELEMENT burns at its mouth: ice (frost motes and a pale
//    mist), venom (green drips and a sickly glow), water (droplets wheeling
//    round the jaw). An element follows whoever wields it, so a survivor that
//    inherits a fallen head's attack visibly carries two;
//  - the Tsunami's breaking wave, its spray and its lingering foam
//    (temple_tsunami_fx.ts; the floor half-disc is temple_fx.ts's telegraph);
//  - a regrowing head's burst of venom-green light as it bursts back up.
// The per-vertex element tint of the three necks is `tintHydraNecks`.
//
// Cosmetic: every state is read off IWorld (the heads' dead flags and bars,
// the wave object and its template id), so offline and online look the same. GPU
// particles on the Hollow Crypt kit; built once under the gated temple root.

import * as THREE from 'three';
import { HYDRA_ELEMENTS, type HydraElement } from '../../sim/encounters/drowned_temple/ids';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from '../hollow_crypt/crypt_fx_particles';
import { TempleTsunamiFx, type TsunamiWaveInput } from './temple_tsunami_fx';

/** Each element's look: the particle colour, and the neck tint multiplier. */
export const HYDRA_ELEMENT_LOOK: Readonly<
  Record<HydraElement, { glow: [number, number, number]; tint: [number, number, number] }>
> = {
  frost: { glow: [0.7, 0.9, 1.0], tint: [0.82, 0.96, 1.22] },
  venom: { glow: [0.55, 1.0, 0.3], tint: [0.78, 1.08, 0.52] },
  tide: { glow: [0.3, 0.7, 1.0], tint: [0.52, 0.82, 1.1] },
};

const NECK = ['L', 'C', 'R'] as const;

/** Which neck a bone belongs to (0 L, 1 C, 2 R) and how far up it (0 base,
 *  1 head), or null for the body. */
function neckOfBone(name: string): { neck: number; up: number } | null {
  const m = /^(neck|head|jaw|lid)_([LCR])(?:_(\d+))?/.exec(name);
  if (!m) return null;
  const neck = NECK.indexOf(m[2] as (typeof NECK)[number]);
  if (m[1] !== 'neck') return { neck, up: 1 };
  return { neck, up: Number(m[3] ?? 1) / 7 };
}

/** Tint the three necks of the Hydra's cloned body by their elements, in
 *  their vertex colours (strongest at the head, fading into the mound). The
 *  geometry is cloned so the shared source stays untouched. */
export function tintHydraNecks(body: THREE.Object3D): void {
  body.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.skeleton) return;
    const geo = m.geometry.clone();
    const color = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    const joints = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    const weights = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    if (!color || !joints || !weights) return;
    const bones = m.skeleton.bones.map((b) => neckOfBone(b.name));
    const out = new Float32Array(color.count * 3);
    for (let i = 0; i < color.count; i++) {
      const tint = [0, 0, 0];
      let body = 0;
      for (let k = 0; k < 4; k++) {
        const w = weights.getComponent(i, k);
        if (w <= 0) continue;
        const b = bones[joints.getComponent(i, k)];
        if (!b) {
          body += w;
          continue;
        }
        const look = HYDRA_ELEMENT_LOOK[HYDRA_ELEMENTS[b.neck]].tint;
        const s = 0.35 + 0.65 * b.up;
        for (let c = 0; c < 3; c++) tint[c] += w * (1 + (look[c] - 1) * s);
      }
      for (let c = 0; c < 3; c++) out[i * 3 + c] = color.getComponent(i, c) * (tint[c] + body);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
    m.geometry = geo;
  });
}

export interface HydraFxInput {
  /** Each head's mouth (world), or null when that head is gone. */
  sockets: (THREE.Vector3 | null)[];
  /** Which head wields each element (HYDRA_ELEMENTS order), or null. */
  wielders: (number | null)[];
  /** The Tsunami's wave object, if one stands. */
  wave: TsunamiWaveInput | null;
}

export class TempleHydraFx {
  private readonly uTime = { value: 0 };
  private readonly glow: ParticlePool;
  private readonly mist: ParticlePool;
  private readonly materials: THREE.Material[] = [];
  private readonly tsunami: TempleTsunamiFx;
  private emitDebt = [0, 0, 0];
  private seed = 1;

  constructor(
    root: THREE.Group,
    private readonly detail: boolean,
    groundY?: (x: number, z: number) => number,
  ) {
    const mat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(detail ? 900 : 360, mat(GLOW_FRAG, THREE.AdditiveBlending), 12);
    this.mist = new ParticlePool(detail ? 500 : 200, mat(DUST_FRAG, THREE.NormalBlending), 11);
    root.add(this.glow.mesh, this.mist.mesh);
    this.tsunami = new TempleTsunamiFx(root, detail, this.uTime, groundY);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** A regrown head bursts back up out of the pool. */
  burstAt(p: THREE.Vector3, clock: number): void {
    const n = this.detail ? 60 : 24;
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 3 + this.rand() * 6;
      this.glow.emit(clock, {
        x: p.x,
        y: p.y,
        z: p.z,
        vx: Math.cos(a) * s,
        vy: 2 + this.rand() * 6,
        vz: Math.sin(a) * s,
        ay: -6,
        drag: 1.2,
        life: 0.9 + this.rand() * 0.6,
        size0: 1.2,
        size1: 0.3,
        r: 0.6,
        g: 1,
        b: 0.45,
        a: 1,
      });
    }
  }

  private emitElement(el: HydraElement, at: THREE.Vector3, clock: number, dt: number): void {
    const i = HYDRA_ELEMENTS.indexOf(el);
    const rate = this.detail ? 34 : 14;
    this.emitDebt[i] += rate * dt;
    const [r, g, b] = HYDRA_ELEMENT_LOOK[el].glow;
    while (this.emitDebt[i] >= 1) {
      this.emitDebt[i] -= 1;
      const a = this.rand() * Math.PI * 2;
      const rr = 0.4 + this.rand() * 1.3;
      const x = at.x + Math.cos(a) * rr;
      const z = at.z + Math.sin(a) * rr;
      const y = at.y + (this.rand() - 0.5) * 1.2;
      if (el === 'frost') {
        this.glow.emit(clock, {
          x,
          y,
          z,
          vx: (this.rand() - 0.5) * 0.8,
          vy: 0.6 + this.rand(),
          vz: (this.rand() - 0.5) * 0.8,
          life: 1.1 + this.rand() * 0.8,
          size0: 0.5,
          size1: 0.15,
          spin: 2,
          r,
          g,
          b,
          a: 0.9,
        });
        if (this.rand() < 0.35)
          this.mist.emit(clock, {
            x,
            y: y - 0.4,
            z,
            vx: 0,
            vy: -0.3,
            vz: 0,
            life: 1.8,
            size0: 1.4,
            size1: 2.6,
            r: 0.8,
            g: 0.9,
            b: 1,
            a: 0.3,
          });
      } else if (el === 'venom') {
        this.glow.emit(clock, {
          x,
          y,
          z,
          vx: 0,
          vy: -0.5,
          vz: 0,
          ay: -14,
          drag: 0.4,
          life: 0.9 + this.rand() * 0.4,
          size0: 0.42,
          size1: 0.3,
          r,
          g,
          b,
          a: 1,
        });
      } else {
        // Water wheels round the jaw.
        const s = 3.2;
        this.glow.emit(clock, {
          x,
          y,
          z,
          vx: -Math.sin(a) * s,
          vy: 0.4 + this.rand() * 0.6,
          vz: Math.cos(a) * s,
          ay: -3,
          drag: 1.5,
          life: 0.8 + this.rand() * 0.5,
          size0: 0.45,
          size1: 0.2,
          r,
          g,
          b,
          a: 0.95,
        });
      }
    }
  }

  update(dt: number, clock: number, input: HydraFxInput): void {
    this.uTime.value = clock;
    input.wielders.forEach((head, i) => {
      const at = head !== null ? input.sockets[head] : null;
      if (at) this.emitElement(HYDRA_ELEMENTS[i], at, clock, dt);
    });
    this.tsunami.update(dt, clock, input.wave);
    this.glow.update(clock);
    this.mist.update(clock);
  }

  dispose(): void {
    this.glow.dispose();
    this.mist.dispose();
    this.tsunami.dispose();
    for (const m of this.materials) m.dispose();
  }
}
