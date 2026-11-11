// The Masterless Strength's arrival, painted (plan: final_arrival_core.ts;
// shaders: final_arrival_glsl.ts), hosted by final_fx.ts (the scene's clock
// with a pull's skip, the boss's drawn body, the shared particles, flashes
// and camera thud are its):
//  - the four veins' light running down their carved grooves from the
//    altars, spiralling in to the boss's feet (one draw: four ribbons laid on
//    the grooves' own polylines, ../smith_heart/heart_vein_groove_core.ts,
//    arching over the central ring's kerb, each with a low veil of light
//    standing on its centreline so it reads from the terrace), sparks riding
//    each front and motes rising off each lit trail (thinned by density);
//  - the giant beam where they meet: a white-hot core and a swirl of the
//    four colours (two draws on one cylinder), a pool of light at its foot,
//    a crown of light in the sky at its top, sparks spiralling up it; its
//    eruption's shockwave and thud; its collapse back down into the boss;
//  - the boss lit: the colours poured into its chest, its eyes igniting;
//  - the roar's four-colour shockwave out over the raid.
// The body's own clips and glow are final_body_fx.ts's (the stance, the dark
// cracks, the roar); the room's altars and sky are the interior's
// (../smith_heart/heart_arrival_light_core.ts, written by the host).
// Cosmetic layers thin on the low tier (the particles, the swirl's streaks)
// and under reduced motion (the thuds); the scene itself plays on every
// tier.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the host's root, before the host's gated attach; no light; fixed
// meshes and pools, no per-frame allocation; disposed with the host.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { radialGlowTexture } from '../textures';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  ARRIVAL,
  ARRIVAL_BEAM,
  ARRIVAL_BEAM_FALL,
  ARRIVAL_CONVERGE,
  ARRIVAL_IGNITE,
  ARRIVAL_SHAKES,
  ARRIVAL_VEINS,
  ARRIVAL_WAVE_AT,
  type ArrivalBeamLook,
  arrivalBeam,
  arrivalStreamLevel,
  arrivalStreamLift,
  arrivalStreamPath,
  arrivalStreamPointAt,
  arrivalVeinColor,
  arrivalVeinFront,
  arrivalVeinStart,
} from './final_arrival_core';
import {
  ARRIVAL_BEAM_VERT,
  ARRIVAL_CORE_FRAG,
  ARRIVAL_POOL_FRAG,
  ARRIVAL_POOL_VERT,
  ARRIVAL_STREAM_FRAG,
  ARRIVAL_STREAM_VERT,
  ARRIVAL_SWIRL_FRAG,
} from './final_arrival_glsl';

/** What the host lends: its particles, flashes, camera thud and dice. */
export interface FinalArrivalHost {
  readonly particles: EngineParticles;
  readonly density: number;
  flash(x: number, y: number, z: number, size: number, span: number, color: number): void;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
  rand(): number;
  groundY(x: number, z: number): number;
}

/** The frame the host hands over: the scene's clock (`t`, -1 asleep) and the
 *  last frame's, the slot's origin, and the boss's drawn body in world
 *  yards (its feet, its heart, its eyes' midpoint, its facing). */
export interface FinalArrivalFrame {
  t: number;
  prev: number;
  ox: number;
  oz: number;
  footX: number;
  footY: number;
  footZ: number;
  chestY: number;
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  facing: number;
  dead: boolean;
  dt: number;
}

/** A stream's half width (yards): the groove's bed and the glow spilt either
 *  side of it, a little narrower where it curls in over the ring. */
const STREAM_HALF = 3.4;
const STREAM_HALF_END = 2.3;
/** How far a stream floats over the floor (yards), clear of its paint. */
const STREAM_LIFT = 0.12;
/** The veil of light standing on a stream's centreline (yards tall). */
const STREAM_VEIL = 3.6;

const VEIN_RGB = ARRIVAL_VEINS.map((v) => {
  const c = new THREE.Color(arrivalVeinColor(v));
  return [c.r, c.g, c.b] as const;
});
const WHITE: readonly [number, number, number] = [1, 0.96, 0.88];
/** Each vein's stream path (instance-local), laid once. */
const PATHS = ARRIVAL_VEINS.map((v) => arrivalStreamPath(v));

export class FinalArrivalBeam {
  private readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly streams: THREE.Mesh;
  private readonly streamMat: THREE.ShaderMaterial;
  private readonly streamPos: THREE.BufferAttribute;
  /** Each stream vertex's height over the walk (the leap over the kerb). */
  private readonly streamLift: Float32Array;
  private readonly swirl: THREE.Mesh;
  private readonly swirlMat: THREE.ShaderMaterial;
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly pool: THREE.Mesh;
  private readonly poolMat: THREE.ShaderMaterial;
  private readonly crown: THREE.Sprite;
  private readonly sheath: THREE.Sprite;
  private readonly eyes: THREE.Sprite[] = [];
  /** The slot the streams' floor heights were laid for. */
  private laidX = Number.NaN;
  private laidZ = Number.NaN;
  private readonly beamLook: ArrivalBeamLook = { phase: 'off', k: 0, top: 0, width: 0, glow: 0 };
  private sparkDebt = 0;
  private readonly streamDebt = [0, 0, 0, 0];
  private readonly moteDebt = [0, 0, 0, 0];
  /** A point down a stream (reused; no per-frame allocation). */
  private readonly at = { x: 0, z: 0 };
  /** A running front's spark puff (reused; its colour set per vein). */
  private readonly spark: SanctumPuffOptions = {
    speed: 3,
    up: 5,
    life: 1.1,
    size: [1.2, 0.15],
    color: WHITE,
    alpha: 1,
    pool: 'glow',
    radius: 0.8,
    drag: 1.4,
  };
  /** A trail mote's puff (reused; its rise, life and colour set per mote). */
  private readonly mote: SanctumPuffOptions = {
    speed: 0.6,
    up: 2.4,
    life: 1.4,
    size: [0.7, 0.1],
    color: WHITE,
    alpha: 0.9,
    pool: 'glow',
    drag: 0.6,
  };
  /** The low tier sheds the sky billboards (cosmetic only; the beam stays). */
  private readonly rich: boolean;

  constructor(
    root: THREE.Group,
    private readonly host: FinalArrivalHost,
  ) {
    this.rich = host.density >= 1;
    this.group.name = 'smithHeartFinalArrival';
    this.group.visible = false;
    root.add(this.group);
    const colors = () => {
      const u: Record<string, { value: THREE.Color }> = {};
      ARRIVAL_VEINS.forEach((v, i) => {
        u[`uC${i}`] = { value: new THREE.Color(arrivalVeinColor(v)) };
      });
      return u;
    };
    const additive = (
      name: string,
      vert: string,
      frag: string,
      uniforms: Record<string, { value: unknown }>,
      side: THREE.Side = THREE.FrontSide,
    ): THREE.ShaderMaterial => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
        side,
      });
      this.materials.push(m);
      return m;
    };
    // ---- the four streams: one draw, each a ribbon laid down its groove ----
    // Two strips per vein: the ribbon flat in the groove, then a low veil of
    // light standing on its centreline (`aRise` 0 at its foot, 1 at its top;
    // the ribbon's -1), so a stream still reads from the terrace, where the
    // floor is seen almost edge on.
    const pts = PATHS[0].x.length;
    const strip = ARRIVAL_VEINS.length * pts * 2;
    const n = strip * 2;
    const pos = new Float32Array(n * 3);
    const along = new Float32Array(n);
    const side = new Float32Array(n);
    const vein = new Float32Array(n);
    const rise = new Float32Array(n).fill(-1);
    const index: number[] = [];
    let length = 0;
    const lift = new Float32Array(n);
    ARRIVAL_VEINS.forEach((_, i) => {
      const path = PATHS[i];
      length = Math.max(length, path.length);
      for (let s = 0; s < pts; s++) {
        // Square to the run here (its neighbours' chord), in the plan.
        const a0 = Math.max(0, s - 1);
        const a1 = Math.min(pts - 1, s + 1);
        const tx = path.x[a1] - path.x[a0];
        const tz = path.z[a1] - path.z[a0];
        const tl = Math.hypot(tx, tz) || 1;
        const px = -tz / tl;
        const pz = tx / tl;
        const k = path.along[s] / path.length;
        const half = STREAM_HALF + (STREAM_HALF_END - STREAM_HALF) * k * k;
        for (let e = 0; e < 2; e++) {
          const j = (i * pts + s) * 2 + e;
          const sd = e === 0 ? -half : half;
          // Instance-local (the mesh stands at the slot's origin).
          pos[j * 3] = path.x[s] + px * sd;
          pos[j * 3 + 1] = STREAM_LIFT;
          lift[j] = STREAM_LIFT + arrivalStreamLift(path.r[s]);
          pos[j * 3 + 2] = path.z[s] + pz * sd;
          along[j] = k;
          side[j] = sd;
          vein[j] = i;
        }
        for (let e = 0; e < 2; e++) {
          const j = strip + (i * pts + s) * 2 + e;
          pos[j * 3] = path.x[s];
          pos[j * 3 + 1] = STREAM_LIFT;
          pos[j * 3 + 2] = path.z[s];
          lift[j] = STREAM_LIFT + arrivalStreamLift(path.r[s]) + e * STREAM_VEIL;
          along[j] = k;
          side[j] = 0;
          vein[j] = i;
          rise[j] = e;
        }
        if (s < pts - 1) {
          const a = (i * pts + s) * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          const b = strip + a;
          index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
    });
    this.streamLift = lift;
    const streamGeo = new THREE.BufferGeometry();
    this.streamPos = new THREE.BufferAttribute(pos, 3);
    streamGeo.setAttribute('position', this.streamPos);
    streamGeo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    streamGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    streamGeo.setAttribute('aVein', new THREE.BufferAttribute(vein, 1));
    streamGeo.setAttribute('aRise', new THREE.BufferAttribute(rise, 1));
    streamGeo.setIndex(index);
    this.geometries.push(streamGeo);
    this.streamMat = additive(
      'smithHeartArrivalStreams',
      ARRIVAL_STREAM_VERT,
      ARRIVAL_STREAM_FRAG,
      {
        ...colors(),
        uFront: { value: new THREE.Vector4(-1, -1, -1, -1) },
        uLevel: { value: new THREE.Vector4() },
        uTime: sharedUniforms.uTime,
        uLength: { value: length },
      },
      THREE.DoubleSide,
    );
    this.streamMat.polygonOffset = true;
    this.streamMat.polygonOffsetFactor = -2;
    this.streamMat.polygonOffsetUnits = -2;
    this.streams = new THREE.Mesh(streamGeo, this.streamMat);
    this.streams.name = 'smithHeartArrivalStreams';
    this.streams.frustumCulled = false;
    this.streams.renderOrder = 2;
    this.group.add(this.streams);
    // ---- the beam: one cylinder, two looks ----
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 24, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    const detail = host.density >= 1 ? 1 : 0;
    this.swirlMat = additive(
      'smithHeartArrivalSwirl',
      ARRIVAL_BEAM_VERT,
      ARRIVAL_SWIRL_FRAG,
      {
        ...colors(),
        uTime: sharedUniforms.uTime,
        uHeight: { value: 1 },
        uGlow: { value: 0 },
        uDetail: { value: detail },
      },
      THREE.DoubleSide,
    );
    this.swirl = new THREE.Mesh(beamGeo, this.swirlMat);
    this.swirl.name = 'smithHeartArrivalSwirl';
    this.swirl.frustumCulled = false;
    this.swirl.renderOrder = 3;
    this.group.add(this.swirl);
    this.coreMat = additive('smithHeartArrivalCore', ARRIVAL_BEAM_VERT, ARRIVAL_CORE_FRAG, {
      uTime: sharedUniforms.uTime,
      uHeight: { value: 1 },
      uGlow: { value: 0 },
    });
    this.core = new THREE.Mesh(beamGeo, this.coreMat);
    this.core.name = 'smithHeartArrivalCore';
    this.core.frustumCulled = false;
    this.core.renderOrder = 4;
    this.group.add(this.core);
    // ---- the pool of light at its foot ----
    const poolGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    this.geometries.push(poolGeo);
    this.poolMat = additive('smithHeartArrivalPool', ARRIVAL_POOL_VERT, ARRIVAL_POOL_FRAG, {
      ...colors(),
      uTime: sharedUniforms.uTime,
      uGlow: { value: 0 },
    });
    this.poolMat.polygonOffset = true;
    this.poolMat.polygonOffsetFactor = -3;
    this.poolMat.polygonOffsetUnits = -3;
    this.pool = new THREE.Mesh(poolGeo, this.poolMat);
    this.pool.name = 'smithHeartArrivalPool';
    this.pool.frustumCulled = false;
    this.pool.renderOrder = 2;
    this.group.add(this.pool);
    // ---- the crown in the sky, the eyes ----
    const glowTex = typeof document !== 'undefined' ? radialGlowTexture() : null;
    const sprite = (name: string, color: number): THREE.Sprite => {
      const m = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
        name,
      });
      this.materials.push(m);
      const s = new THREE.Sprite(m);
      s.name = name;
      s.visible = false;
      s.frustumCulled = false;
      this.group.add(s);
      return s;
    };
    this.crown = sprite('smithHeartArrivalCrown', 0xfff0d8);
    // The air round the column glowing with it (a tall soft billboard).
    this.sheath = sprite('smithHeartArrivalSheath', 0xfff2e0);
    for (let i = 0; i < 2; i++) this.eyes.push(sprite('smithHeartArrivalEye', 0xfff6e8));
  }

  /** Paint the scene at the frame's clock (the moments fire as they pass). */
  update(f: FinalArrivalFrame): void {
    const t = f.t;
    const live = !f.dead && t >= 0 && t < ARRIVAL_WAVE_AT + ARRIVAL.waveSeconds;
    if (!live) {
      if (this.group.visible) this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.layStreams(f.ox, f.oz);
    this.paintStreams(f);
    this.paintBeam(f);
    this.paintEyes(f);
    this.moments(f);
  }

  /** Nothing in view (no boss): the scene's draws off. */
  hide(): void {
    if (this.group.visible) this.group.visible = false;
  }

  /** The streams' floor heights for this slot (once per slot). */
  private layStreams(ox: number, oz: number): void {
    if (ox === this.laidX && oz === this.laidZ) return;
    this.laidX = ox;
    this.laidZ = oz;
    this.streams.position.set(ox, 0, oz);
    const a = this.streamPos.array as Float32Array;
    for (let j = 0; j < a.length; j += 3)
      a[j + 1] = this.host.groundY(ox + a[j], oz + a[j + 2]) + this.streamLift[j / 3];

    this.streamPos.needsUpdate = true;
  }

  private paintStreams(f: FinalArrivalFrame): void {
    const front = this.streamMat.uniforms.uFront.value as THREE.Vector4;
    const level = this.streamMat.uniforms.uLevel.value as THREE.Vector4;
    const h = this.host;
    let any = false;
    for (let i = 0; i < ARRIVAL_VEINS.length; i++) {
      const fr = arrivalVeinFront(f.t, i);
      const lv = arrivalStreamLevel(f.t, i);
      front.setComponent(i, fr);
      level.setComponent(i, lv);
      if (fr >= 0 && lv > 0.002) any = true;
      if (fr < 0 || lv <= 0.2) continue;
      const path = PATHS[i];
      // Sparks off the running front, its light lifting off the floor.
      if (fr < 1) {
        const p = arrivalStreamPointAt(path, fr, this.at);
        const x = f.ox + p.x;
        const z = f.oz + p.z;
        this.streamDebt[i] += f.dt * 50;
        while (this.streamDebt[i] >= 1) {
          this.streamDebt[i] -= 1;
          this.spark.color = VEIN_RGB[i];
          h.particles.puff(x, h.groundY(x, z) + 0.4, z, 4, this.spark);
        }
      }
      // Motes rising off the lit groove behind it (fewer on the low tier).
      this.moteDebt[i] += f.dt * 26 * h.density * lv;
      while (this.moteDebt[i] >= 1) {
        this.moteDebt[i] -= 1;
        const p = arrivalStreamPointAt(path, h.rand() * fr, this.at);
        const x = f.ox + p.x + (h.rand() - 0.5) * 1.6;
        const z = f.oz + p.z + (h.rand() - 0.5) * 1.6;
        const m = this.mote;
        m.up = 2.4 + h.rand() * 2;
        m.life = 1.4 + h.rand() * 0.8;
        m.color = h.rand() < 0.2 ? WHITE : VEIN_RGB[i];
        h.particles.puff(x, h.groundY(x, z) + 0.2, z, 1, m);
      }
    }
    this.streams.visible = any;
  }

  private paintBeam(f: FinalArrivalFrame): void {
    const H = ARRIVAL_BEAM.height;
    const chest = (f.chestY - f.footY) / H;
    const b = arrivalBeam(f.t, chest, this.beamLook);
    const on = b.phase !== 'off';
    this.swirl.visible = on;
    this.core.visible = on;
    // The pool burns from the streams' meeting until the boss is lit.
    const pool =
      f.t < ARRIVAL_CONVERGE - 0.3
        ? 0
        : f.t < ARRIVAL_CONVERGE
          ? (f.t - ARRIVAL_CONVERGE + 0.3) / 0.3
          : on
            ? b.glow
            : Math.max(0, 1 - (f.t - ARRIVAL_IGNITE) / 0.6);
    this.pool.visible = pool > 0.01;
    if (this.pool.visible) {
      const r = ARRIVAL_BEAM.poolR * (on ? 0.6 + 0.4 * b.width : 0.6);
      this.pool.position.set(f.footX, f.footY + 0.18, f.footZ);
      this.pool.scale.set(r, 1, r);
      this.poolMat.uniforms.uGlow.value = pool;
    }
    if (!on) {
      this.crown.visible = false;
      this.sheath.visible = false;
      return;
    }
    const pulse = 1 + 0.05 * Math.sin(sharedUniforms.uTime.value * 7.0);
    const top = Math.max(0.5, b.top * H);
    const sw = ARRIVAL_BEAM.swirlR * b.width * pulse;
    const cr = ARRIVAL_BEAM.coreR * (0.6 + 0.4 * b.width);
    this.swirl.position.set(f.footX, f.footY, f.footZ);
    this.swirl.scale.set(sw, top, sw);
    this.swirlMat.uniforms.uHeight.value = top;
    this.swirlMat.uniforms.uGlow.value = b.glow;
    this.core.position.copy(this.swirl.position);
    this.core.scale.set(cr, top, cr);
    this.coreMat.uniforms.uHeight.value = top;
    this.coreMat.uniforms.uGlow.value = b.glow;
    // The crown of light where it meets the sky (while it stands tall).
    const crown = b.phase === 'fall' ? Math.max(0, 1 - b.k * 2.5) : b.phase === 'rise' ? b.k : 1;
    this.crown.visible = this.rich && crown > 0.01;
    if (this.crown.visible) {
      const s = 150 * (0.7 + 0.3 * crown);
      this.crown.position.set(f.footX, f.footY + top * 0.82, f.footZ);
      this.crown.scale.set(s, s * 1.4, 1);
      (this.crown.material as THREE.SpriteMaterial).opacity = 0.75 * crown;
    }
    this.sheath.visible = this.rich;
    this.sheath.position.set(f.footX, f.footY + top * 0.45, f.footZ);
    this.sheath.scale.set(ARRIVAL_BEAM.sheathR * 2 * b.width, top * 1.15, 1);
    (this.sheath.material as THREE.SpriteMaterial).opacity = 0.26 * Math.min(1.2, b.glow);
    // Sparks spiralling up it and grit flung off its foot.
    this.sparkDebt += f.dt * (b.phase === 'fall' ? 30 : 90);
    while (this.sparkDebt >= 1) {
      this.sparkDebt -= 1;
      const a = this.host.rand() * Math.PI * 2;
      const r = sw * (0.6 + 0.7 * this.host.rand());
      const i = Math.floor(this.host.rand() * 4) % 4;
      const tang = b.phase === 'fall' ? -1 : 1;
      this.host.particles.puff(
        f.footX + Math.cos(a) * r,
        f.footY + 1 + this.host.rand() * Math.min(top, 40),
        f.footZ + Math.sin(a) * r,
        1,
        {
          speed: 26 + this.host.rand() * 22,
          life: 1.6,
          size: [1.1, 0.2],
          color: this.host.rand() < 0.25 ? WHITE : VEIN_RGB[i],
          alpha: 1,
          pool: 'glow',
          dir: [-Math.sin(a) * 0.35, tang, Math.cos(a) * 0.35],
          spread: 0.08,
          drag: 0.25,
          floor: f.footY - 400,
        },
      );
    }
  }

  /** The eyes ignite as the beam lands in it and burn down to its own. */
  private paintEyes(f: FinalArrivalFrame): void {
    const age = f.t - ARRIVAL_IGNITE;
    const k = age < 0 ? 0 : age < 0.25 ? age / 0.25 : Math.max(0, 1 - (age - 0.25) / 3.2);
    for (let i = 0; i < 2; i++) {
      const e = this.eyes[i];
      e.visible = k > 0.01;
      if (!e.visible) continue;
      // The eyes either side of the brow, across the facing.
      const sd = i === 0 ? 1 : -1;
      const gap = 0.55;
      e.position.set(
        f.eyeX + Math.cos(f.facing) * sd * gap,
        f.eyeY,
        f.eyeZ - Math.sin(f.facing) * sd * gap,
      );
      const s = 2.2 + 2.6 * k;
      e.scale.set(s, s, 1);
      (e.material as THREE.SpriteMaterial).opacity = k;
    }
  }

  /** The beats as they pass (never replayed for a raid that sees the heart
   *  already awake: the host hands a clock long past them). */
  private moments(f: FinalArrivalFrame): void {
    const prev = f.prev;
    const t = f.t;
    if (prev < 0 || t <= prev) return;
    const crossed = (at: number) => prev < at && t >= at && t - at < 0.5;
    const h = this.host;
    const P = h.particles;
    // Each vein igniting at its altar: a flare of its colour.
    for (let i = 0; i < ARRIVAL_VEINS.length; i++) {
      if (!crossed(arrivalVeinStart(i))) continue;
      const path = PATHS[i];
      const x = f.ox + path.from.x;
      const z = f.oz + path.from.z;
      const y = h.groundY(x, z);
      h.flash(x, y + 2, z, 14, 0.7, arrivalVeinColor(ARRIVAL_VEINS[i]));
      P.puff(x, y + 0.5, z, 18, {
        speed: 5,
        up: 4,
        life: 1.1,
        size: [0.8, 0.12],
        color: VEIN_RGB[i],
        alpha: 1,
        pool: 'glow',
        radius: 1.2,
      });
    }
    if (crossed(ARRIVAL_CONVERGE)) {
      // The streams meet and the beam erupts: the floor's shockwave, a white
      // flash, the four colours flung out, the thud.
      const x = f.footX;
      const z = f.footZ;
      h.flash(x, f.footY + 4, z, 46, 0.7, 0xffffff);
      h.flash(x, f.footY + 14, z, 70, 1.0, 0xfff0d8);
      for (let i = 0; i < 4; i++)
        P.shockRing(x, z, arrivalVeinColor(ARRIVAL_VEINS[i]), 30 + i * 12, 1.0 + i * 0.25, {
          wake: 0.25,
          crest: 0.07,
          strength: 0.8,
        });
      P.shockRing(x, z, 0xfff0d0, 80, 1.9, { wake: 0.2, crest: 0.06, strength: 0.7 });
      for (let i = 0; i < Math.round(90 * h.density) + 16; i++) {
        const a = h.rand() * Math.PI * 2;
        P.puff(x, f.footY + 1.5, z, 1, {
          speed: 30 + h.rand() * 18,
          life: 1.2,
          size: [0.8, 0.14],
          color: VEIN_RGB[i % 4],
          alpha: 1,
          pool: 'glow',
          dir: [Math.cos(a), 0.05 + h.rand() * 0.4, Math.sin(a)],
          spread: 0.12,
          drag: 0.8,
        });
      }
      P.puff(x, f.footY + 0.6, z, 46, {
        speed: 18,
        up: 1.5,
        life: 1.8,
        size: [2.4, 7],
        color: [0.42, 0.38, 0.36],
        alpha: 0.4,
        drag: 1.3,
        radius: 4,
      });
      h.shakeNear(x, z, ARRIVAL_SHAKES.beam.amount, ARRIVAL_SHAKES.beam.reach);
    }
    if (crossed(ARRIVAL_BEAM_FALL)) {
      // The light drawn down and in: motes from all round falling to it.
      for (let i = 0; i < Math.round(70 * h.density) + 12; i++) {
        const a = h.rand() * Math.PI * 2;
        const r = 14 + h.rand() * 12;
        const y = f.footY + 4 + h.rand() * 30;
        const dx = -Math.cos(a) * r;
        const dy = f.chestY - y;
        const dz = -Math.sin(a) * r;
        const l = Math.hypot(dx, dy, dz) || 1;
        P.puff(f.footX + Math.cos(a) * r, y, f.footZ + Math.sin(a) * r, 1, {
          speed: l * 1.5,
          life: 0.7,
          size: [0.9, 0.15],
          color: VEIN_RGB[i % 4],
          alpha: 1,
          pool: 'glow',
          dir: [dx / l, dy / l, dz / l],
          spread: 0.04,
          drag: 0.1,
          floor: f.footY - 10,
        });
      }
    }
    if (crossed(ARRIVAL_IGNITE)) {
      // It lands in the chest: the colours burst through the stone, the
      // eyes catch light, a thud.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.6;
        h.flash(
          f.footX + Math.cos(a) * 1.5,
          f.chestY + Math.sin(a * 2) * 1.2,
          f.footZ + Math.sin(a) * 1.5,
          16,
          0.9,
          arrivalVeinColor(ARRIVAL_VEINS[i]),
        );
      }
      h.flash(f.footX, f.chestY, f.footZ, 34, 0.6, 0xfff6e8);
      for (let i = 0; i < Math.round(60 * h.density) + 10; i++) {
        P.puff(f.footX, f.chestY, f.footZ, 1, {
          speed: 14,
          life: 0.9,
          size: [0.6, 0.1],
          color: VEIN_RGB[i % 4],
          alpha: 1,
          pool: 'glow',
          radius: 2.4,
          drag: 0.9,
        });
      }
      h.shakeNear(f.footX, f.footZ, ARRIVAL_SHAKES.collapse.amount, ARRIVAL_SHAKES.collapse.reach);
    }
    if (crossed(ARRIVAL_WAVE_AT)) {
      // The roar: the four-colour shockwave races out over the raid.
      const x = f.footX;
      const z = f.footZ;
      for (let i = 0; i < 4; i++)
        P.shockRing(x, z, arrivalVeinColor(ARRIVAL_VEINS[i]), 36 + i * 14, 1.2 + i * 0.3, {
          wake: 0.25,
          crest: 0.07,
          strength: 0.75,
        });
      P.shockRing(x, z, 0xffe6b8, 90, 2.2, { wake: 0.25, crest: 0.07, strength: 0.75 });
      h.flash(x, f.chestY, z, 60, 1.0, 0xffeed0);
      for (let i = 0; i < Math.round(80 * h.density) + 12; i++) {
        const a = h.rand() * Math.PI * 2;
        P.puff(x, f.chestY, z, 1, {
          speed: 26 + h.rand() * 16,
          life: 1.1,
          size: [0.7, 0.12],
          color: VEIN_RGB[i % 4],
          alpha: 1,
          pool: 'glow',
          dir: [Math.cos(a), -0.15 + h.rand() * 0.5, Math.sin(a)],
          spread: 0.12,
          drag: 0.7,
        });
      }
      P.puff(x, f.footY + 0.5, z, 40, {
        speed: 16,
        up: 1,
        life: 1.6,
        size: [2, 6],
        color: [0.42, 0.38, 0.36],
        alpha: 0.4,
        drag: 1.4,
        radius: 4,
      });
      h.shakeNear(x, z, ARRIVAL_SHAKES.wave.amount, ARRIVAL_SHAKES.wave.reach);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
