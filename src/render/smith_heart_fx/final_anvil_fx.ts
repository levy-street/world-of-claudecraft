// Weight of the Anvil's look (plan: final_anvil_core.ts; the mechanic:
// encounters/smith_heart/final_hammer.ts), a part of FinalKitFx: the kit
// lays the mark itself (the shared floor telegraph in the soak's gold, every
// tier) and hands this painter the mark's place, its bar and how many stand
// under it each frame, and the strike's cue.
//   - the build-up: the great anvil of carved stone and gold crystal hanging
//     over its mark, sinking as the weight settles, its stone heating from
//     dull red to white-hot, molten seams and a band of runes burning
//     through it; a column of heat from it down to its mark; six runes round
//     the mark's rim kindling one a second (the countdown, every tier), gold
//     once enough stand under it, ember red while too few; embers drawn up
//     off the floor into it; a shiver, then it lets go: the closing ring
//     slides in onto the rim as it drops (every tier), a streak behind it,
//     the air thrown out of the circle as dust;
//   - the strike: a white flash, the anvil bursting into glowing fragments
//     flung round the mark, a molten splash, sparks, a dust wall rolling
//     out, shock rings, the camera's thud (none under reduced motion), and a
//     scar of cracks racing out of a white-hot crater that cools to nothing;
//   - its sound beats on the fight's own (the stone groaning, the rush of the
//     drop, the splash, the hiss), every key an existing sample.
// The mark's runes, the closing ring, the column and the anvil draw on every
// tier; the particles thin with the kit's density and the low tier draws
// fewer, larger fragments and one shock ring fewer.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the kit's root (its one gated attach links them), no
// light, fixed pools, no per-frame allocation; the particles are the kit's
// (their pools hang off the root at the origin and take WORLD points); the
// floor pieces share the kit's own additive rungs (FINAL_KIT_FLOOR: the
// runes on its marks' rung beside Heart Unbound's blaze, the scar on the
// switch's shock rung; additive pieces on one rung commute, and every rung
// of the encounter band is already taken).

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { heartKitMeshes, SMITH_HEART_HEART_KIT_URL } from '../smith_heart/heart_kit';
import { radialGlowTexture } from '../textures';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  ANVIL_FX,
  ANVIL_SOUNDS,
  type AnvilHang,
  anvilChunkAt,
  anvilCrossed,
  anvilHang,
  anvilImpact,
  anvilRuneLit,
  anvilShake,
  anvilSoakReady,
  newAnvilChunk,
  newAnvilHang,
  newAnvilImpact,
} from './final_anvil_core';
import {
  ANVIL_BODY_VERT,
  ANVIL_COLUMN_FRAG,
  ANVIL_FLOOR_VERT,
  ANVIL_RUNES_FRAG,
  ANVIL_SCAR_FRAG,
  ANVIL_SEAMS_FRAG,
} from './final_anvil_glsl';
import { FINAL_KIT_FLOOR as F } from './final_kit_fx_core';
import { ANVIL_SIZE, anvilCrystals, anvilStone, FINAL_ANVIL_PIECE } from './final_kit_shapes';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

const GOLD: readonly [number, number, number] = [1.0, 0.8, 0.38];
const EMBER: readonly [number, number, number] = [1.0, 0.3, 0.07];
const FIRE: readonly [number, number, number] = [1.0, 0.5, 0.14];
const WHITE: readonly [number, number, number] = [1.0, 0.92, 0.75];
const DUST: readonly [number, number, number] = [0.5, 0.44, 0.38];

// ---- the particles' options (aimed in place where they fly) ----
const _dir: [number, number, number] = [0, 1, 0];
const DRAWN_UP: SanctumPuffOptions = {
  speed: 0.6,
  up: 5,
  life: 1.4,
  size: [0.35, 0.08],
  color: FIRE,
  alpha: 1,
  pool: 'glow',
  drag: 0.4,
};
const FALL_GRIT: SanctumPuffOptions = {
  speed: 0.6,
  up: -3,
  life: 1.2,
  size: [0.3, 0.12],
  color: [1, 0.8, 0.45],
  alpha: 1,
  pool: 'glow',
};
const AIR_DUST: SanctumPuffOptions = {
  speed: 9,
  up: 0.6,
  life: 1,
  size: [1.2, 3.4],
  color: DUST,
  alpha: 0.4,
  drag: 2.2,
  dir: _dir,
  spread: 0.25,
};
const SPLASH: SanctumPuffOptions = {
  speed: 13,
  up: 9,
  life: 1.2,
  size: [1.0, 0.25],
  color: FIRE,
  alpha: 1,
  pool: 'pyre',
  gravity: 24,
  drag: 0.5,
  dir: _dir,
  spread: 0.55,
};
const SPARKS: SanctumPuffOptions = {
  speed: 24,
  up: 7,
  life: 0.9,
  size: [0.42, 0.05],
  color: WHITE,
  alpha: 1,
  pool: 'glow',
  gravity: 16,
  drag: 0.7,
};
const WALL: SanctumPuffOptions = {
  speed: 13,
  up: 1.4,
  life: 1.9,
  size: [2.4, 7],
  color: DUST,
  alpha: 0.5,
  drag: 2,
  dir: _dir,
  spread: 0.2,
};
const SCAR_EMBERS: SanctumPuffOptions = {
  speed: 0.8,
  up: 2.6,
  life: 1.6,
  size: [0.32, 0.06],
  color: FIRE,
  alpha: 1,
  pool: 'glow',
  drag: 0.6,
};
const SCAR_SMOKE: SanctumPuffOptions = {
  speed: 0.5,
  up: 2.2,
  life: 2.6,
  size: [1.6, 5],
  color: [0.3, 0.27, 0.25],
  alpha: 0.3,
  drag: 0.8,
};

export interface FinalAnvilHost {
  /** The floor's height under a world point. */
  groundY(x: number, z: number): number;
  /** The kit's particles (WORLD points). */
  particles: EngineParticles;
  /** The kit's tier density (1 full, under 1 the low tier). */
  density: number;
  /** The full look (false: the low tier). */
  detail: boolean;
  reducedMotion(): boolean;
  /** The local player's place (the thud's distance and the sounds), or null. */
  me(): { x: number; z: number } | null;
  /** The camera's thud (absent: none). */
  shakeSink?: (amount: number) => void;
  /** The painter's own seeded draw (0..1). */
  rand(): number;
  /** Build with the DOM (textures, the kit's model). */
  hasDom: boolean;
}

export class FinalAnvilFx {
  readonly group = new THREE.Group();
  private readonly anvil = new THREE.Group();
  private readonly stoneMat: THREE.MeshLambertMaterial;
  private readonly crystalMat: THREE.MeshBasicMaterial;
  private readonly seamsU: { uTime: { value: number }; uHeat: { value: number } };
  private readonly runes: THREE.Mesh;
  private readonly runesU: {
    uLit: { value: number[] };
    uHeat: { value: number };
    uClose: { value: number };
    uCloseA: { value: number };
    uAlpha: { value: number };
    uColor: { value: THREE.Color };
  };
  private readonly column: THREE.Mesh;
  private readonly columnU: { uAlpha: { value: number }; uHeat: { value: number } };
  private readonly streak: THREE.Mesh;
  private readonly streakU: { uAlpha: { value: number }; uHeat: { value: number } };
  private readonly scar: THREE.Mesh;
  private readonly scarU: { uScar: { value: number }; uSpread: { value: number } };
  private readonly flash: THREE.Sprite;
  private readonly flashMat: THREE.SpriteMaterial;
  private readonly chunks: THREE.InstancedMesh;
  private readonly chunkMat: THREE.MeshLambertMaterial;
  private readonly chunkCount: number;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly glowTex: THREE.Texture | null;
  private readonly look: AnvilHang = newAnvilHang();
  private readonly hit = newAnvilImpact();
  private readonly piece = newAnvilChunk();
  /** The mark being drawn (its object id; -1 none) and its last fill. */
  private markId = -1;
  private lastFill = 0;
  private shownThisFrame = false;
  private hitAt = -99;
  private hitX = 0;
  private hitY = 0;
  private hitZ = 0;
  private clock = 0;
  private dt = 0;
  private emberDebt = 0;
  private scarDebt = 0;
  /** The strike's timeline last seen (its beats fire once, forward only). */
  private afterSeen = Number.POSITIVE_INFINITY;

  constructor(
    private readonly host: FinalAnvilHost,
    uTime: { value: number },
  ) {
    this.group.name = 'smithHeartFinalAnvilFx';
    // ---- the great anvil: the kit's model or the carved fallback ----
    this.stoneMat = new THREE.MeshLambertMaterial({
      name: 'smithHeartFinalAnvilStone',
      vertexColors: true,
      // Darkened under the vertex tone: forged stone that its seams burn
      // through, never a pale block in the Heart's warm light.
      color: new THREE.Color(0.2, 0.17, 0.155),
      emissive: 0x120804,
    });
    this.crystalMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalAnvilCrystal',
      color: 0xffb030,
      vertexColors: true,
      toneMapped: false,
    });
    this.seamsU = { uTime, uHeat: { value: 0 } };
    const seamsMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalAnvilSeams',
      uniforms: { ...this.seamsU, uScale: { value: 1 } },
      vertexShader: ANVIL_BODY_VERT,
      fragmentShader: ANVIL_SEAMS_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(this.stoneMat, this.crystalMat, seamsMat);
    const overlay = (src: THREE.Mesh) => {
      const o = new THREE.Mesh(src.geometry, seamsMat);
      o.name = 'smithHeartFinalAnvilSeams';
      o.frustumCulled = false;
      o.renderOrder = 1;
      src.add(o);
    };
    const kitAnvil = host.hasDom
      ? heartKitMeshes(SMITH_HEART_HEART_KIT_URL, FINAL_ANVIL_PIECE)
      : null;
    if (kitAnvil) {
      for (const m of [...kitAnvil.children]) {
        if (!(m instanceof THREE.Mesh)) continue;
        const glow = m.name.endsWith(':glow');
        m.material = glow ? this.crystalMat : this.stoneMat;
        m.frustumCulled = false;
        if (!glow) overlay(m);
      }
      this.anvil.add(kitAnvil);
    } else {
      const stoneGeo = anvilStone();
      const crystalGeo = anvilCrystals();
      this.geometries.push(stoneGeo, crystalGeo);
      const stone = new THREE.Mesh(stoneGeo, this.stoneMat);
      stone.frustumCulled = false;
      overlay(stone);
      const crystals = new THREE.Mesh(crystalGeo, this.crystalMat);
      crystals.frustumCulled = false;
      this.anvil.add(stone, crystals);
    }
    this.anvil.name = 'smithHeartFinalAnvil';
    this.anvil.visible = false;
    this.group.add(this.anvil);

    // ---- the mark's runes, haze and closing ring (every tier) ----
    const runeGeo = new THREE.CircleGeometry(ANVIL_FX.closeFrom + 0.15, 120).rotateX(-Math.PI / 2);
    this.geometries.push(runeGeo);
    this.runesU = {
      uLit: { value: [0, 0, 0, 0, 0, 0] },
      uHeat: { value: 0 },
      uClose: { value: 0 },
      uCloseA: { value: 0 },
      uAlpha: { value: 1 },
      uColor: { value: new THREE.Color(...GOLD) },
    };
    const runeMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalAnvilRunes',
      uniforms: { uTime, ...this.runesU },
      vertexShader: ANVIL_FLOOR_VERT,
      fragmentShader: ANVIL_RUNES_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(runeMat);
    this.runes = this.floorMesh(runeGeo, runeMat, 'smithHeartFinalAnvilRunes', F.marks);

    // ---- the column of heat to the mark, and the fall's streak ----
    const tube = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true).translate(0, 0.5, 0);
    this.geometries.push(tube);
    const columnMat = (name: string, down: number) => {
      const u = { uAlpha: { value: 0 }, uHeat: { value: 0 } };
      const mat = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime, uDown: { value: down }, ...u },
        vertexShader: ANVIL_BODY_VERT,
        fragmentShader: ANVIL_COLUMN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(mat);
      return { mat, u };
    };
    const col = columnMat('smithHeartFinalAnvilColumn', 1);
    this.columnU = col.u;
    this.column = this.bodyMesh(tube, col.mat, 'smithHeartFinalAnvilColumn');
    const st = columnMat('smithHeartFinalAnvilStreak', 0);
    this.streakU = st.u;
    this.streak = this.bodyMesh(tube, st.mat, 'smithHeartFinalAnvilStreak');

    // ---- the strike's scar on the floor ----
    const scarGeo = new THREE.CircleGeometry(1, 120).rotateX(-Math.PI / 2);
    this.geometries.push(scarGeo);
    this.scarU = { uScar: { value: 0 }, uSpread: { value: 0 } };
    const scarMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalAnvilScar',
      uniforms: { uTime, ...this.scarU },
      vertexShader: ANVIL_FLOOR_VERT,
      fragmentShader: ANVIL_SCAR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(scarMat);
    this.scar = this.floorMesh(scarGeo, scarMat, 'smithHeartFinalAnvilScar', F.shock);

    // ---- the flash ----
    this.glowTex = host.hasDom ? radialGlowTexture() : null;
    this.flashMat = new THREE.SpriteMaterial({
      name: 'smithHeartFinalAnvilFlash',
      map: this.glowTex,
      color: 0xfff0d0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    this.materials.push(this.flashMat);
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.name = 'smithHeartFinalAnvilFlash';
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 2;
    this.group.add(this.flash);

    // ---- the fragments (fewer, larger on the low tier) ----
    this.chunkCount = host.detail ? ANVIL_FX.chunks : ANVIL_FX.chunksLow;
    const chunkGeo = new THREE.DodecahedronGeometry(1, 0);
    chunkGeo.scale(1, 0.72, 0.86);
    this.geometries.push(chunkGeo);
    this.chunkMat = new THREE.MeshLambertMaterial({
      name: 'smithHeartFinalAnvilShards',
      color: 0x1c1814,
      emissive: 0x000000,
      flatShading: true,
    });
    this.materials.push(this.chunkMat);
    this.chunks = new THREE.InstancedMesh(chunkGeo, this.chunkMat, this.chunkCount);
    this.chunks.name = 'smithHeartFinalAnvilShards';
    this.chunks.frustumCulled = false;
    this.chunks.visible = false;
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.chunkCount; i++) this.chunks.setMatrixAt(i, _zero);
    this.group.add(this.chunks);
  }

  private floorMesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    name: string,
    rung: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.visible = false;
    m.frustumCulled = false;
    m.renderOrder = floorVfxRenderOrder('encounter', rung);
    this.group.add(m);
    return m;
  }

  private bodyMesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.visible = false;
    m.frustumCulled = false;
    this.group.add(m);
    return m;
  }

  /** The hanging look's numbers this frame (tests read them). */
  get hangLook(): Readonly<AnvilHang> {
    return this.look;
  }

  /** When the last strike landed (the painter's clock; tests read it). */
  get struckAt(): number {
    return this.hitAt;
  }

  /** Frame start: nothing is shown until `hang` says so. */
  begin(clock: number, dt: number): void {
    this.clock = clock;
    this.dt = Math.min(0.1, Math.max(0, dt));
    this.shownThisFrame = false;
  }

  /** The mark `id` at (x, y, z), `fill` into its bar, `under` players under
   *  it, `radius` the sim's. */
  hang(
    id: number,
    x: number,
    y: number,
    z: number,
    fill: number,
    under: number,
    radius: number,
  ): void {
    const h = this.host;
    const L = anvilHang(fill, this.look);
    if (id !== this.markId) {
      this.markId = id;
      this.lastFill = fill;
    }
    const prev = this.lastFill;
    this.lastFill = fill;
    this.shownThisFrame = true;
    // The anvil, hot as it falls, shivering before it lets go.
    this.anvil.position.set(x, y + L.height, z);
    this.anvil.rotation.set(0, 0.9 + this.clock * 0.12, 0);
    if (L.shudder > 0 && !h.reducedMotion()) {
      this.anvil.rotation.z = Math.sin(this.clock * 43) * L.shudder;
      this.anvil.rotation.x = Math.sin(this.clock * 37 + 1.3) * L.shudder * 0.6;
    }
    this.anvil.visible = true;
    // The stone stays dark (its seams and runes carry the heat): only a
    // smoulder in it, never a flat glow over the carving.
    this.stoneMat.emissive.setRGB(
      0.04 + 0.16 * L.heat * L.heat,
      0.012 + 0.04 * L.heat * L.heat,
      0.005,
    );
    this.crystalMat.color.setRGB(
      0.9 + 0.6 * L.heat,
      0.5 + 0.45 * L.heat,
      0.12 + 0.4 * L.heat * L.heat,
    );
    this.seamsU.uHeat.value = L.heat;
    // The mark's countdown, its share's colour, its haze and closing ring.
    const lit = this.runesU.uLit.value;
    for (let i = 0; i < ANVIL_FX.runes; i++) lit[i] = anvilRuneLit(i, L.runes);
    const c = anvilSoakReady(under) ? GOLD : EMBER;
    this.runesU.uColor.value.setRGB(c[0], c[1], c[2]);
    this.runesU.uHeat.value = L.heat;
    this.runesU.uClose.value = L.close;
    this.runesU.uCloseA.value = L.closeAlpha;
    this.runes.position.set(x, y + 0.08, z);
    this.runes.scale.setScalar(radius);
    this.runes.visible = true;
    // The column of heat down to the mark.
    this.column.position.set(x, y, z);
    this.column.scale.set(radius * 0.42, Math.max(0.5, L.height), radius * 0.42);
    this.columnU.uAlpha.value = 0.75 * L.column;
    this.columnU.uHeat.value = L.heat;
    this.column.visible = true;
    // The fall's streak over it.
    this.streak.visible = L.streak > 0.01;
    if (this.streak.visible) {
      this.streak.position.set(x, y + L.height + ANVIL_SIZE.height * 0.6, z);
      this.streak.scale.set(ANVIL_SIZE.length * 0.32, 4 + 16 * L.streak, ANVIL_SIZE.length * 0.32);
      this.streakU.uAlpha.value = 0.9 * L.streak;
      this.streakU.uHeat.value = L.heat;
    }
    // Embers drawn up off the mark into it, thicker as it heats; grit off it.
    const d = h.density;
    this.emberDebt += (4 + 26 * L.heat) * d * this.dt;
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      const a = h.rand() * Math.PI * 2;
      const r = Math.sqrt(h.rand()) * radius * 0.9;
      DRAWN_UP.up = 4 + 8 * L.heat;
      DRAWN_UP.life = Math.min(2.2, (L.height * 0.8) / DRAWN_UP.up);
      DRAWN_UP.color = h.rand() < 0.3 ? WHITE : FIRE;
      h.particles.puff(x + Math.cos(a) * r, y + 0.3, z + Math.sin(a) * r, 1, DRAWN_UP);
    }
    if (h.rand() < 0.5 * d) {
      FALL_GRIT.radius = radius * 0.6;
      h.particles.puff(x, y + L.height + 0.5, z, 1, FALL_GRIT);
    }
    // The air thrown out of the circle as it drops.
    if (L.streak > 0) {
      const n = Math.round(3 * d) + 1;
      for (let i = 0; i < n; i++) {
        const a = h.rand() * Math.PI * 2;
        _dir[0] = Math.cos(a);
        _dir[1] = 0.05;
        _dir[2] = Math.sin(a);
        h.particles.puff(
          x + Math.cos(a) * radius * 0.85,
          y + 0.4,
          z + Math.sin(a) * radius * 0.85,
          1,
          AIR_DUST,
        );
      }
    }
    // Its beats on the bar.
    for (const s of ANVIL_SOUNDS)
      if (s.bar !== undefined && anvilCrossed(prev, fill, s.bar)) this.sound(s, x, y, z);
  }

  /** The strike at (x, z), `radius` the sim's. */
  land(x: number, z: number, radius: number): void {
    const h = this.host;
    const y = h.groundY(x, z);
    this.hitAt = this.clock;
    this.hitX = x;
    this.hitY = y;
    this.hitZ = z;
    this.afterSeen = -1e-6;
    this.markId = -1;
    this.hideHanging();
    const d = h.density;
    const P = h.particles;
    // The rings: the soak's gold racing wide, a white crest under it, and
    // (the full look) a slow heat wave past them.
    P.shockRing(x, z, 0xffc860, radius * 3.2, 0.95);
    P.shockRing(x, z, 0xffffff, radius * 1.5, 0.35);
    if (h.detail)
      P.shockRing(x, z, 0xff7a2a, radius * 4.2, 1.3, { wake: 0.12, crest: 0.05, strength: 0.4 });
    // The molten splash thrown up and out of the crater.
    const splash = Math.round(ANVIL_FX.splash * d) + 12;
    for (let i = 0; i < splash; i++) {
      const a = h.rand() * Math.PI * 2;
      _dir[0] = Math.cos(a) * 0.8;
      _dir[1] = 0.9 + h.rand() * 0.6;
      _dir[2] = Math.sin(a) * 0.8;
      SPLASH.color = h.rand() < 0.25 ? WHITE : FIRE;
      P.puff(x + Math.cos(a) * radius * 0.4, y + 0.6, z + Math.sin(a) * radius * 0.4, 1, SPLASH);
    }
    SPARKS.radius = radius * 0.5;
    P.puff(x, y + 1.2, z, Math.round(ANVIL_FX.sparks * d) + 10, SPARKS);
    // The dust wall rolling out over the floor.
    const wall = Math.round(ANVIL_FX.dustWall * d) + 10;
    for (let i = 0; i < wall; i++) {
      const a = (i / wall) * Math.PI * 2 + h.rand() * 0.2;
      _dir[0] = Math.cos(a);
      _dir[1] = 0.08;
      _dir[2] = Math.sin(a);
      P.puff(x + Math.cos(a) * radius * 0.9, y + 0.6, z + Math.sin(a) * radius * 0.9, 1, WALL);
    }
    // The camera's thud.
    const me = h.me();
    if (me && h.shakeSink) {
      const amount = anvilShake(Math.hypot(me.x - x, me.z - z), h.reducedMotion());
      if (amount > 0) h.shakeSink(amount);
    }
  }

  /** Frame end: the hanging pieces hidden when no mark showed, the strike's
   *  aftermath run on. */
  end(): void {
    if (!this.shownThisFrame) {
      this.hideHanging();
      this.markId = -1;
    }
    const h = this.host;
    const since = this.clock - this.hitAt;
    const I = anvilImpact(since, h.reducedMotion(), this.hit);
    for (const s of ANVIL_SOUNDS)
      if (s.after !== undefined && I.live && anvilCrossed(this.afterSeen, since, s.after))
        this.sound(s, this.hitX, this.hitY, this.hitZ);
    this.afterSeen = I.live ? since : Number.POSITIVE_INFINITY;
    // The flash.
    this.flash.visible = I.flash > 0.004;
    if (this.flash.visible) {
      this.flash.position.set(this.hitX, this.hitY + 3, this.hitZ);
      this.flash.scale.setScalar(24 + 26 * (1 - I.flash));
      this.flashMat.opacity = I.flash;
    }
    // The scar.
    this.scar.visible = I.live && I.scar > 0.003;
    if (this.scar.visible) {
      this.scar.position.set(this.hitX, this.hitY + 0.09, this.hitZ);
      this.scar.scale.setScalar(16);
      this.scarU.uScar.value = I.scar;
      this.scarU.uSpread.value = I.spread;
      // Embers and smoke off it while it is still hot.
      this.scarDebt += I.scar * 18 * h.density * this.dt;
      while (this.scarDebt >= 1) {
        this.scarDebt -= 1;
        SCAR_EMBERS.radius = 5;
        h.particles.puff(this.hitX, this.hitY + 0.2, this.hitZ, 1, SCAR_EMBERS);
        if (h.rand() < 0.3) {
          SCAR_SMOKE.radius = 4;
          h.particles.puff(this.hitX, this.hitY + 0.4, this.hitZ, 1, SCAR_SMOKE);
        }
      }
    }
    // The fragments.
    const was = this.chunks.visible;
    this.chunks.visible = I.chunks;
    if (I.chunks) {
      let heat = 0;
      for (let i = 0; i < this.chunkCount; i++) {
        const c = anvilChunkAt(i, this.chunkCount, since, this.piece);
        if (c.size <= 0) {
          this.chunks.setMatrixAt(i, _zero);
          continue;
        }
        heat = Math.max(heat, c.heat);
        _q.setFromAxisAngle(UP, c.yaw);
        _axis.set(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
        _q2.setFromAxisAngle(_axis, c.tumble);
        _q.multiply(_q2);
        const gy = h.groundY(this.hitX + c.x, this.hitZ + c.z);
        _p.set(this.hitX + c.x, gy + c.y + c.size * 0.4, this.hitZ + c.z);
        _s.setScalar(c.size);
        _m.compose(_p, _q, _s);
        this.chunks.setMatrixAt(i, _m);
      }
      this.chunkMat.emissive.setRGB(0.2 * heat, 0.07 * heat * heat, 0.015 * heat);
      this.chunks.instanceMatrix.needsUpdate = true;
    } else if (was) {
      for (let i = 0; i < this.chunkCount; i++) this.chunks.setMatrixAt(i, _zero);
      this.chunks.instanceMatrix.needsUpdate = true;
    }
  }

  private sound(s: (typeof ANVIL_SOUNDS)[number], x: number, y: number, z: number): void {
    sfx.playAt(s.key, x, y + 1, z, {
      gain: s.gain,
      rate: s.rate,
      cooldown: 0.2,
      jitter: false,
      priority: true,
    });
  }

  private hideHanging(): void {
    this.anvil.visible = false;
    this.runes.visible = false;
    this.column.visible = false;
    this.streak.visible = false;
  }

  /** Everything hidden (the player left the Heart). */
  hide(): void {
    this.hideHanging();
    this.markId = -1;
    this.hitAt = -99;
    this.afterSeen = Number.POSITIVE_INFINITY;
    this.flash.visible = false;
    this.scar.visible = false;
    this.chunks.visible = false;
  }

  dispose(): void {
    this.chunks.dispose();
    this.glowTex?.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
