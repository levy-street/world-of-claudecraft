// The Masterless Strength's Overload in the world (plan: final_overload_core.ts;
// the team's review of 2026-11-17, the owner's rework of 2026-11-18), a part
// of FinalFx (final_fx.ts, which reads the boss and hands its frame in). As
// the bar of the quarter it drinks fills, every tier sees it on the boss and
// the arena, never only on the HUD:
//   - a shell of strain round the body in the quarter's colour: it swells,
//     its cracks open wider and burn hotter, throbbing faster as it nears
//     full, light bleeding off it in sparks;
//   - at three quarters the quarter's wall erupts: its landmark throws its
//     element up (the Heat's lava, the Quench's shards and mist, the
//     Breath's sparks, the Hammer's stone and gold), with a thud as it
//     starts (the landmark's own light flaring and the floor's cracks
//     throbbing are the interior's, through heart_quarters_core.ts `strain`);
//   - the burst itself is FinalFx's wave of light out of the body.
// The shell draws on every tier; the sparks and the eruption's particles thin
// with the host's density; the thud goes under reduced motion.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the host's root (FinalFx's gated attach); no light; no per-frame
// allocation.

import * as THREE from 'three';
import { HEART_ROOM, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { heartLandmarkSpots } from '../smith_heart/heart_landmarks_core';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { KIT_NOISE, KIT_UV_VERT } from './final_kit_glsl';
import { eruptLevel, eruptStarts, strainLook } from './final_overload_core';

/** What FinalFx lends. */
export interface FinalOverloadHost {
  root: THREE.Group;
  uTime: { value: number };
  particles: EngineParticles;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  density: number;
  shakeNear: (x: number, z: number, amount: number) => void;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

/** One frame of the boss as FinalFx saw it. */
export interface FinalOverloadFrame {
  /** Its feet (world) and its drawn height. */
  x: number;
  y: number;
  z: number;
  height: number;
  /** The quarter it drinks (null: the ring, or no fight) and that bar's fill
   *  (0..1). */
  vein: SmithHeartVein | null;
  fill: number;
  /** Its quarter's colour. */
  color: number;
  /** The slot's origin (world). */
  ox: number;
  oz: number;
  clock: number;
  dt: number;
}

const STRAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCrack;
uniform float uHeat;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vView;
${KIT_NOISE}
void main() {
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 1.7);
  // The cracks: ridged noise on the shell's own points, opening wider as
  // the strain grows, crawling slowly.
  vec2 q = vec2(atan(vObj.z, vObj.x) * 2.2, vObj.y * 3.0);
  float r1 = kridge(q * 1.6 + vec2(uTime * 0.07, 0.0));
  float r2 = kridge(q * 3.3 - vec2(0.0, uTime * 0.11));
  // Thin veins of light only (no filled shell: the body stays seen through
  // it), a faint rim as it nears full.
  float lines = pow(max(r1, r2 * 0.85), mix(54.0, 26.0, uCrack));
  float glow = min(1.0, lines) * (0.4 + 0.9 * uHeat) + pow(fres, 3.0) * 0.18 * uHeat;
  vec3 col = uColor * glow + vec3(1.0, 0.97, 0.9) * min(1.0, lines) * uHeat * 0.25;
  gl_FragColor = vec4(col * uCrack * 0.85, 1.0);
}
`;

const _look = { swell: 1, crack: 0, heat: 0, throb: 0 };
const _rgb: [number, number, number] = [1, 1, 1];

export class FinalOverloadFx {
  private readonly shell: THREE.Mesh;
  private readonly u: {
    uCrack: { value: number };
    uHeat: { value: number };
    uColor: { value: THREE.Color };
  };
  private lastFill = 0;
  private lastVein: SmithHeartVein | null = null;
  private sparkOwed = 0;
  private eruptOwed = 0;

  constructor(private readonly h: FinalOverloadHost) {
    const geo = new THREE.SphereGeometry(1, 48, 32);
    h.geometries.push(geo);
    this.u = {
      uCrack: { value: 0 },
      uHeat: { value: 0 },
      uColor: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalStrain',
      uniforms: { uTime: h.uTime, ...this.u },
      vertexShader: KIT_UV_VERT,
      fragmentShader: STRAIN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    h.materials.push(mat);
    this.shell = new THREE.Mesh(geo, mat);
    this.shell.name = 'smithHeartFinalStrain';
    this.shell.frustumCulled = false;
    this.shell.visible = false;
    h.root.add(this.shell);
  }

  update(f: FinalOverloadFrame): void {
    const H = this.h;
    const fill = f.vein ? f.fill : 0;
    const look = strainLook(fill, f.clock, _look);
    if (look.crack <= 0.001) {
      this.shell.visible = false;
    } else {
      this.shell.visible = true;
      const r = f.height * 0.22 * look.swell;
      this.shell.scale.set(r, f.height * 0.5 * look.swell, r);
      this.shell.position.set(f.x, f.y + f.height * 0.5, f.z);
      this.u.uCrack.value = look.crack;
      this.u.uHeat.value = look.heat;
      this.u.uColor.value.setHex(f.color);
      // Light bleeding off the strained shell.
      this.sparkOwed += f.dt * 30 * look.crack * look.crack * H.density;
      const c = this.u.uColor.value;
      _rgb[0] = c.r;
      _rgb[1] = c.g;
      _rgb[2] = c.b;
      while (this.sparkOwed >= 1) {
        this.sparkOwed -= 1;
        const a = H.rand() * Math.PI * 2;
        H.particles.puff(
          f.x + Math.cos(a) * r,
          f.y + f.height * (0.2 + 0.7 * H.rand()),
          f.z + Math.sin(a) * r,
          1,
          {
            speed: 3 + 5 * look.heat,
            up: 2,
            life: 0.6,
            size: [0.45, 0.08],
            color: _rgb,
            alpha: 1,
            pool: 'glow',
            dir: [Math.cos(a), 0.3, Math.sin(a)],
            spread: 0.4,
          },
        );
      }
    }
    // The quarter's wall erupting from three quarters full.
    if (f.vein && f.vein === this.lastVein && eruptStarts(this.lastFill, fill))
      H.shakeNear(f.x, f.z, 0.35);
    const erupt = f.vein ? eruptLevel(fill) : 0;
    if (f.vein && erupt > 0) this.erupt(f, f.vein, erupt);
    this.lastFill = fill;
    this.lastVein = f.vein;
  }

  /** The wall's eruption: its element thrown up off its signature spots. */
  private erupt(f: FinalOverloadFrame, vein: SmithHeartVein, level: number): void {
    const H = this.h;
    this.eruptOwed += f.dt * 26 * level * H.density;
    if (this.eruptOwed < 1) return;
    const spots = heartLandmarkSpots(vein);
    const cx = f.ox + HEART_ROOM.x;
    const cz = f.oz + HEART_ROOM.z;
    const floor = H.groundY(cx, cz);
    while (this.eruptOwed >= 1) {
      this.eruptOwed -= 1;
      const s = spots[Math.floor(H.rand() * spots.length) % spots.length];
      const x = cx + s.x;
      const y = floor + s.y;
      const z = cz + s.z;
      if (vein === 'heat') {
        H.particles.puff(x, y, z, 3, {
          speed: 4,
          up: 16 + H.rand() * 10,
          life: 1.6,
          size: [1.1, 0.4],
          color: [1, 0.55, 0.15],
          alpha: 1,
          pool: 'pyre',
          gravity: 14,
          radius: 2,
        });
      } else if (vein === 'quench') {
        H.particles.puff(x, y, z, 3, {
          speed: 5,
          up: 12 + H.rand() * 8,
          life: 1.4,
          size: [0.6, 0.2],
          color: [0.75, 0.92, 1],
          alpha: 1,
          pool: 'glow',
          gravity: 12,
          radius: 2,
        });
        H.particles.puff(x, y, z, 1, {
          speed: 2,
          up: 3,
          life: 2,
          size: [3, 7],
          color: [0.7, 0.85, 1],
          alpha: 0.25,
          radius: 3,
        });
      } else if (vein === 'breath') {
        H.particles.puff(x, y, z, 4, {
          speed: 12,
          up: 6,
          life: 0.45,
          size: [0.7, 0.08],
          color: [0.85, 0.8, 1],
          alpha: 1,
          pool: 'glow',
          radius: 1.5,
        });
      } else {
        H.particles.puff(x, y, z, 2, {
          speed: 5,
          up: 10 + H.rand() * 6,
          life: 1.5,
          size: [0.8, 0.5],
          color: [0.55, 0.45, 0.32],
          alpha: 1,
          gravity: 22,
          radius: 2,
        });
        H.particles.puff(x, y, z, 2, {
          speed: 6,
          up: 8,
          life: 0.8,
          size: [0.5, 0.1],
          color: [1, 0.82, 0.4],
          alpha: 1,
          pool: 'glow',
          radius: 2,
        });
      }
    }
  }

  hide(): void {
    this.shell.visible = false;
    this.lastFill = 0;
    this.lastVein = null;
  }
}
