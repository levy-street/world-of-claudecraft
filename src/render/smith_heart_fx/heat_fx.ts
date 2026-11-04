// The Guardian of the Heat's Basalt Fist and its Molten Swells (plan:
// heat_fx_core.ts; docs/design/raid/smith_heart.md section 7.4), hosted by
// ../rift_death_zone.ts beside the fight's other painters. Read from IWorld
// (the fist's spot, the swells' lanes and waves, the cues), so offline and
// online look the same:
//  - the spot: the fist's lethal disc at its exact radius filling with the
//    guardian's bar (the shared floor telegraph, lethal, every tier), cracks
//    of molten light racing through the basalt under it;
//  - the lanes: the three swells' lanes at their exact length and width,
//    filling with the bar (danger, every tier), held and fading while their
//    waves roll;
//  - the fist: a giant fist of hexagonal basalt with knuckles of white-gold
//    crystal, hanging high in the smoke over the spot and plunging onto it
//    through the bar's last part, a trail of fire behind it; the hit: a white
//    flash, a ring, basalt flung up, molten cracks round the crater cooling
//    over seconds, a shake;
//  - the swells: each a rolling wall of molten rock cresting down its lane at
//    the wave's own speed (the wall drawn where the sim strikes), spray and
//    drops off its crest, a molten wake behind it crusting as it cools.
// The spot, the lanes and the walls draw on every tier; the fist's trail,
// the sparks, spray, smoke and the shakes thin on the low tier and under
// reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through `attachSceneGroupGated`; fixed
// pools, no per-frame allocation, no light.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { SMITH_HEART_FINAL_BOSS } from '../../sim/content/smith_heart';
import { laneReach } from '../../sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_CUES,
  HEAT_OBJECTS,
  heatTimedOf,
  swellLaneOf,
  HEAT_TUNING as T,
} from '../../sim/encounters/smith_heart/heat_ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { wrapAngle } from '../facing_smooth';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
  type TelegraphPaint,
} from '../floor_telegraph';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitMeshes,
  heartKitProgramWarmers,
  heartKitSlotMaterial,
  SMITH_HEART_HEART_KIT_URL,
} from '../smith_heart/heart_kit';
import { heartVeinGlowMaterial } from '../smith_heart/heart_room_kit';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { inSmithHeartClaim } from './council_fx_core';
import { HEAT_BODY_COLORS } from './heat_body_core';
import { heatClaimOrigin } from './heat_fight_fx_core';
import { HEAT_FLOOR, heatParticleSteps } from './heat_floor_ladder_core';
import {
  HEAT_FX_COLORS as C,
  craterLook,
  type FistLook,
  fistLook,
  HEAT_FIST_SCULPT,
  heatFxHash,
  HEAT_FX_POOLS as P,
  SWELL_HEIGHT,
  swellFront,
  swellHeight,
} from './heat_fx_core';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { moltenDecal } from './heat_molten_decal';
import { basaltColumn, basaltRepaint, crystalPrism, swellWallGeometry } from './heat_shapes';
import { HeatTelegraphs } from './heat_telegraph';

const SCAN_SEC = 0.1;

/** The nearer of two bodies to (x, z) (either may be missing). */
function nearerOf(
  a: { pos: { x: number; z: number } } | undefined,
  b: { pos: { x: number; z: number } } | undefined,
  x: number,
  z: number,
): { pos: { x: number; z: number } } | undefined {
  if (!a) return b;
  if (!b) return a;
  const da = Math.hypot(a.pos.x - x, a.pos.z - z);
  const db = Math.hypot(b.pos.x - x, b.pos.z - z);
  return db < da ? b : a;
}
/** The spot is lethal, the lanes danger (the floor telegraph's threat
 *  colours; the vein's white-gold the accent). */
const LANE_STYLE = { color: TELEGRAPH_THREAT_COLORS.danger, accent: C.accent };
const FAN_STYLE = { color: TELEGRAPH_THREAT_COLORS.lethal, accent: C.accent };

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _fist: FistLook = { fill: 0, height: 0, shown: false, crack: 0 };
const _crater = { flash: 0, glow: 0 };
const PAINT: TelegraphPaint = { fill: 0, clock: 0, range: 0 };

const TRAIL_PUFF = {
  speed: 1.5,
  up: 3,
  life: 0.7,
  size: [2.4, 0.6] as [number, number],
  color: C.fire,
  alpha: 0.9,
  pool: 'glow' as const,
  radius: 2.2,
};
const SPRAY_DIR: [number, number, number] = [0, 1, 0];
const SPRAY_PUFF = {
  speed: 5,
  life: 0.7,
  size: [0.55, 0.14] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  dir: SPRAY_DIR,
  spread: 0.45,
  gravity: 12,
  radius: 1.2,
};
/** Sparks rising out of the cracks under the spot. */
const CRACK_PUFF = { ...SPRAY_PUFF, speed: 2, gravity: 4 };
const SMOKE_PUFF = {
  speed: 1,
  up: 2.4,
  life: 2.2,
  size: [1.4, 4] as [number, number],
  color: C.smoke,
  alpha: 0.3,
  drag: 0.6,
  radius: 1.5,
};

// ---- shaders ---------------------------------------------------------------------------

const UV_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** A rolling wall of molten rock (audit point 18: the whole wall glowed, a
 *  smooth gold egg): plates of dark crust riding its back with their seams
 *  alight, the curl's face open and boiling, a hot lip that tears into
 *  spatter, its foot sunk in its own wake. */
const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  // Along the profile: 0 the back's foot, ~0.62 the crest, 1 the curl's lip.
  float y = vUv.y;
  float along = vW.x + vW.z;
  float lvl = lavaLevel(vec2(along, y * 7.0), vec2(0.0, -1.3), uTime, 1.0);
  // The back crusts over; the curl's face runs open.
  float face = smoothstep(0.55, 0.82, y);
  float lip = 1.0 - smoothstep(0.0, 0.06, abs(y - 0.66));
  float m = lvl * mix(0.62, 1.05, face) + lip * 0.3 * (0.5 + 0.5 * lvl);
  m *= uHeat;
  // The lip tears into spatter; the foot sinks into the wake.
  float tear = vn(vec2(along * 1.4, uTime * 1.7)) * 0.6 + vn(vec2(along * 4.0, uTime * 3.1)) * 0.4;
  if (y > 0.86 + 0.14 * tear) discard;
  float foot = smoothstep(0.0, 0.07, y);
  float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x);
  vec3 col = molten(clamp(m, 0.0, 1.0)) * 0.82;
  gl_FragColor = vec4(col, (0.94 * edge + 0.06) * foot);
  #include <colorspace_fragment>
}
`;
/** The molten wake down the lane behind a wave (uFront yards down it): hot at
 *  the wall, crusting dark over its cooling run, its edges ragged. */
const WAKE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFront;
uniform float uLen;
uniform float uCool;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  float along = vUv.y * uLen;
  float across = abs(vUv.x - 0.5) * 2.0;
  float rag = vn(vec2(along * 0.6, vUv.x * 5.0)) * 0.25;
  if (along > uFront || across > 1.0 - rag) discard;
  float behind = uFront - along;
  float heat = pow(1.0 - clamp(behind / uCool, 0.0, 1.0), 1.4);
  float lvl = lavaLevel(vW.xz, vec2(0.0), uTime * 0.3, 1.0);
  float m = clamp(heat * (0.55 + 0.55 * lvl), 0.0, 1.0);
  vec3 col = molten(m);
  float a = (0.55 + 0.4 * heat) * (1.0 - smoothstep(0.8, 1.0, across + rag));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;
/** The crater: a scorched bowl, molten cracks running out of it (uGlow their
 *  heat), a white flash at the hit (uFlash). */
const CRATER_FRAG = /* glsl */ `
uniform float uGlow;
uniform float uFlash;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float k = a / 6.2831853 * 9.0 + uSeed;
  float id = floor(k);
  float wob = (hh2(vec2(id, floor(r * 6.0))) - 0.5) * 0.35;
  float line = abs(fract(k) - 0.5 + wob * 0.4);
  float crack = 1.0 - smoothstep(0.0, 0.06 + 0.04 * (1.0 - r), line * (0.35 + r));
  crack *= step(r, 0.6 + 0.4 * hh2(vec2(id, 3.0)));
  float bowl = 1.0 - smoothstep(0.0, 0.55, r);
  float m = max(crack * 0.95, bowl * 0.75) * uGlow + uFlash * (1.0 - r);
  vec3 col = mix(vec3(0.05, 0.04, 0.035), molten(clamp(m, 0.0, 1.0)), smoothstep(0.02, 0.2, m));
  float alpha = (1.0 - smoothstep(0.75, 1.0, r)) * (0.75 + 0.25 * uGlow);
  gl_FragColor = vec4(col, alpha * max(uGlow, uFlash) + (1.0 - r) * 0.25 * uGlow);
  #include <colorspace_fragment>
}
`;

// ---- the slots ------------------------------------------------------------------------

interface FistSlot {
  id: number;
  born: number;
  seconds: number;
  x: number;
  z: number;
  /** The facing from the guardian toward the spot (the fist comes from it). */
  yaw: number;
  fan: TelegraphFan;
  fist: THREE.Group;
}

interface LaneSlot {
  id: number;
  born: number;
  /** When its wave began to roll (the lane's template flipped to roll). */
  rollAt: number;
  x: number;
  z: number;
  y: number;
  facing: number;
  /** Its drawn length (to the floor's edge). */
  length: number;
  /** Its warning's seconds (read once off the template, never per frame). */
  warn: number;
  /** The sim's wave object rolling down it (-1 until found): the wall is
   *  drawn where that object is, so it never trails the hit. */
  waveId: number;
  lane: TelegraphLane;
  wall: THREE.Mesh;
  wallMat: THREE.ShaderMaterial;
  wake: THREE.Mesh;
  wakeMat: THREE.ShaderMaterial;
}

interface CraterSlot {
  at: number;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  flash: THREE.Sprite;
  flashMat: THREE.SpriteMaterial;
}

export class HeatFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly detail: boolean;
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly glowTex: THREE.Texture | null;
  private readonly fists: FistSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly craters: CraterSlot[] = [];
  private readonly objectIds: number[] = [];
  private readonly candidateIds: number[] = [];
  private rosterSeen = Number.NaN;
  private guardianId = -1;
  private finalId = -1;
  private active = false;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x5a17;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-heat-fx';
    setRenderCategory(this.root, 'ui3d');
    this.detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = this.detail ? 1 : 0.35;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
      heatParticleSteps('heat_fx'),
    );
    this.kit = new TelegraphKit(this.root, this.detail);
    // The spot and the lanes in the Hearth's molten paint, on this module's
    // own rungs of the Heat's floor ladder.
    const telegraphs = new HeatTelegraphs(
      this.kit,
      {
        char: HEAT_FLOOR.fistTelegraphChar.step,
        glow: HEAT_FLOOR.fistTelegraphGlow.step,
        curtain: HEAT_FLOOR.fistTelegraphCurtain.step,
      },
      this.materials,
    );
    this.glowTex = hasDom ? radialGlowTexture() : null;

    // ---- the fists ----
    const stone = heartKitSlotMaterial('stone');
    const glow = heartVeinGlowMaterial(0xffd27a, 'smithHeartHeatFistCrystal');
    this.materials.push(glow);
    const column = basaltColumn(0.5, 1);
    const prism = crystalPrism(0.35, 1.6);
    this.geometries.push(column, prism);
    const haloMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      color: 0xffd27a,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: 'smithHeartHeatFistHalo',
    });
    this.materials.push(haloMat);
    for (let i = 0; i < P.fists; i++) {
      const fan = telegraphs.fan('fist');
      this.kit.layOutFan(fan, 360, FAN_STYLE);
      fan.group.visible = false;
      const fist = this.buildFist(column, prism, stone, glow, haloMat, i);
      this.root.add(fist);
      this.fists.push({ id: -1, born: 0, seconds: T.fistCast, x: 0, z: 0, yaw: 0, fan, fist });
    }
    // The fist's sculpted rock (the Heart kit's colossus fist and forearm,
    // repainted basalt) takes the column bundle's place once the kit is in;
    // the columns stand in until then (the same stone material: no link).
    if (hasDom && heartKitLoaded(SMITH_HEART_HEART_KIT_URL)) this.sculptFists(stone, glow);
    else if (hasDom)
      void ensureHeartKit(SMITH_HEART_HEART_KIT_URL)
        .then(() => {
          if (!this.disposed) this.sculptFists(stone, glow);
        })
        .catch(() => {});

    // ---- the lanes, their walls and wakes ----
    const wallGeo = swellWallGeometry();
    const wakeGeo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    // uv.y 0 at the lane's start (z 0), 1 at its end (z 1).
    const wuv = wakeGeo.getAttribute('uv') as THREE.BufferAttribute;
    const wpos = wakeGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < wuv.count; i++) wuv.setY(i, wpos.getZ(i));
    this.geometries.push(wallGeo, wakeGeo);
    for (let i = 0; i < P.lanes; i++) {
      const lane = telegraphs.lane('swell');
      lane.group.visible = false;
      const wallMat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatSwellWall',
        uniforms: { uTime: this.uTime, uHeat: { value: 1 } },
        vertexShader: UV_VERT,
        fragmentShader: WALL_FRAG,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.name = 'smithHeartHeatSwellWall';
      wall.frustumCulled = false;
      wall.visible = false;
      this.root.add(wall);
      // The wake: char and glow passes (crossing wakes out of one crater
      // compose the same from every angle).
      const { mesh: wake, mat: wakeMat } = moltenDecal(
        {
          name: 'smithHeartHeatSwellWake',
          geometry: wakeGeo,
          vertexShader: UV_VERT,
          fragmentShader: WAKE_FRAG,
          uniforms: {
            uTime: this.uTime,
            uFront: { value: 0 },
            uLen: { value: T.laneLength },
            uCool: { value: T.waveSpeed * 2.5 },
          },
          charStep: HEAT_FLOOR.wakeChar.step,
          glowStep: HEAT_FLOOR.wakeGlow.step,
        },
        this.materials,
      );
      this.root.add(wake);
      this.materials.push(wallMat);
      this.lanes.push({
        id: -1,
        born: 0,
        rollAt: -1,
        warn: T.fistCast + T.waveDelay,
        waveId: -1,
        x: 0,
        z: 0,
        y: 0,
        facing: 0,
        length: T.laneLength,
        lane,
        wall,
        wallMat,
        wake,
        wakeMat,
      });
    }

    // ---- the craters ----
    const craterGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.geometries.push(craterGeo);
    for (let i = 0; i < P.craters; i++) {
      const { mesh, mat } = moltenDecal(
        {
          name: 'smithHeartHeatCrater',
          geometry: craterGeo,
          vertexShader: UV_VERT,
          fragmentShader: CRATER_FRAG,
          uniforms: {
            uGlow: { value: 0 },
            uFlash: { value: 0 },
            uSeed: { value: heatFxHash(i, 3) * 9 },
          },
          charStep: HEAT_FLOOR.craterChar.step,
          glowStep: HEAT_FLOOR.craterGlow.step,
        },
        this.materials,
      );
      this.root.add(mesh);
      const flashMat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0xfff4dc,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name: 'smithHeartHeatCraterFlash',
      });
      this.materials.push(flashMat);
      const flash = new THREE.Sprite(flashMat);
      flash.visible = false;
      this.root.add(flash);
      this.craters.push({ at: -99, x: 0, z: 0, mesh, mat, flash, flashMat });
    }

    this.root.add(heartKitProgramWarmers());
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  /** Swap every fist's column bundle for the sculpted fist and forearm
   *  (HEAT_FIST_SCULPT), keeping its crystal knuckles and halo. Once. */
  private sculptFists(stone: THREE.Material, glow: THREE.Material): void {
    const S = HEAT_FIST_SCULPT;
    const fistKit = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, S.fist.node);
    const armKit = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, S.arm.node);
    if (!fistKit || !armKit) return;
    const paint = (kit: THREE.Group): void => {
      for (const m of kit.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        if (m.name.endsWith(':glow')) {
          m.material = glow;
          m.castShadow = false;
        } else {
          m.geometry = basaltRepaint(
            m.geometry,
            HEAT_BODY_COLORS.basalt,
            HEAT_BODY_COLORS.basaltShade,
          );
          this.geometries.push(m.geometry);
          m.material = stone;
          m.castShadow = true;
        }
      }
    };
    paint(fistKit);
    paint(armKit);
    for (const slot of this.fists) {
      const g = slot.fist;
      for (const c of [...g.children])
        if (c instanceof THREE.Mesh && c.userData.heatFistColumn) g.remove(c);
      const f = fistKit.clone();
      f.position.set(S.fist.at[0], S.fist.at[1], S.fist.at[2]);
      f.rotation.set(S.fist.rot[0], S.fist.rot[1], S.fist.rot[2]);
      f.scale.setScalar(S.fist.scale);
      const a = armKit.clone();
      a.position.set(S.arm.at[0], S.arm.at[1], S.arm.at[2]);
      a.rotation.set(S.arm.rot[0], S.arm.rot[1], S.arm.rot[2]);
      a.scale.set(S.arm.scale[0], S.arm.scale[1], S.arm.scale[2]);
      g.add(f, a);
    }
  }

  /** A giant fist of hexagonal basalt, its knuckles white-gold crystal, an
   *  arm of bundled columns rising off it (built once per slot; the sculpted
   *  fist takes the columns' place once the Heart kit is in). */
  private buildFist(
    column: THREE.BufferGeometry,
    prism: THREE.BufferGeometry,
    stone: THREE.Material,
    glow: THREE.Material,
    haloMat: THREE.SpriteMaterial,
    salt: number,
  ): THREE.Group {
    const g = new THREE.Group();
    g.name = 'smithHeartHeatFist';
    g.visible = false;
    // The fist's block: a bundle of short fat columns, knuckles down.
    for (let k = 0; k < 7; k++) {
      const a = (k / 6) * Math.PI * 2;
      const r = k === 6 ? 0 : 1.6;
      const m = new THREE.Mesh(column, stone);
      m.position.set(Math.sin(a) * r, 0.4, Math.cos(a) * r);
      m.scale.set(2.2, 3.4 + heatFxHash(salt, k) * 0.8, 2.2);
      m.castShadow = true;
      m.userData.heatFistColumn = true;
      g.add(m);
    }
    // The arm above it, rising toward the guardian.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const m = new THREE.Mesh(column, stone);
      m.position.set(Math.sin(a) * 1.1, 3.4, Math.cos(a) * 1.1);
      m.scale.set(1.7, 9, 1.7);
      m.userData.heatFistColumn = true;
      g.add(m);
    }
    // The knuckles: crystal breaking out of its face, pointing down.
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(prism, glow);
      const x = -2 + k;
      m.position.set(x, 0.6, 1.9);
      m.rotation.set(Math.PI * 0.85, 0, (heatFxHash(salt, k + 9) - 0.5) * 0.4);
      m.scale.set(1.2, 1.5 + heatFxHash(salt, k + 3) * 0.7, 1.2);
      g.add(m);
    }
    const halo = new THREE.Sprite(haloMat);
    halo.position.set(0, 1, 0);
    halo.scale.set(10, 10, 1);
    g.add(halo);
    return g;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 50): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  // ---- events ---------------------------------------------------------------------------

  /** The fist's hit and a swell's start (the fight's host claims the cues). */
  handleEvent(ev: SimEvent): void {
    if (!this.world || this.disposed || ev.type !== 'spellfxAt') return;
    if (ev.ability === HEAT_CUES.fist) this.impact(ev.x, ev.z, ev.radius ?? T.fistR);
    else if (ev.ability === HEAT_CUES.swell) {
      const y = this.groundY(ev.x, ev.z);
      this.particles.puff(ev.x, y + 0.5, ev.z, 14, SPRAY_PUFF);
    }
  }

  private impact(x: number, z: number, r: number): void {
    let slot = this.craters[0];
    for (const c of this.craters) if (c.at < slot.at) slot = c;
    slot.at = this.clock;
    slot.x = x;
    slot.z = z;
    const y = this.groundY(x, z);
    slot.mesh.position.set(x, y + 0.06, z);
    slot.mesh.scale.set(r * 1.5, 1, r * 1.5);
    slot.mesh.visible = true;
    slot.flash.position.set(x, y + 2, z);
    slot.flash.visible = true;
    this.particles.shockRing(x, z, C.ring, r * 3.2, 0.9);
    this.particles.shockRing(x, z, C.ringGold, r * 1.8, 0.6);
    // Basalt flung up and molten drops, a column of smoke.
    this.particles.puff(x, y + 1, z, 46, {
      speed: 12,
      up: 8,
      life: 1.1,
      size: [0.7, 0.16],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
      gravity: 16,
      radius: r * 0.6,
    });
    this.particles.puff(x, y + 0.6, z, 18, {
      speed: 7,
      up: 6,
      life: 1.4,
      size: [0.9, 0.5],
      color: C.crust,
      alpha: 0.9,
      gravity: 18,
      radius: r * 0.5,
    });
    this.particles.puff(x, y + 1.5, z, 16, { ...SMOKE_PUFF, radius: r * 0.7 });
    this.shakeNear(x, z, 1.0, 70);
  }

  // ---- the frame ------------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    if (this.active) {
      this.paintFists(world, dt);
      this.paintLanes(world, dt);
    }
    this.paintCraters();
    this.particles.update(this.clock);
  }

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.active) this.leave();
      return;
    }
    this.active = true;
    if (world.entityRosterVersion !== this.rosterSeen) {
      this.rosterSeen = world.entityRosterVersion;
      const ids = this.candidateIds;
      ids.length = 0;
      this.guardianId = -1;
      this.finalId = -1;
      for (const e of world.entities.values()) {
        if (e.kind === 'mob' && e.templateId === 'heart_heat_guardian') this.guardianId = e.id;
        if (e.kind === 'mob' && e.templateId === SMITH_HEART_FINAL_BOSS) this.finalId = e.id;
        if (e.kind !== 'object') continue;
        const t = e.templateId;
        if (
          t.startsWith(HEAT_OBJECTS.fistPrefix) ||
          t.startsWith(HEAT_OBJECTS.lanePrefix) ||
          t === HEAT_OBJECTS.wave
        )
          ids.push(e.id);
      }
    }
    this.objectIds.length = 0;
    for (const id of this.candidateIds) if (world.entities.has(id)) this.objectIds.push(id);
    this.assign(world);
  }

  private assign(world: IWorld): void {
    const live = this.objectIds;
    for (const s of this.fists)
      if (s.id >= 0 && !live.includes(s.id)) {
        s.id = -1;
        s.fan.group.visible = false;
        s.fist.visible = false;
      }
    for (const s of this.lanes)
      if (s.id >= 0 && !live.includes(s.id)) {
        s.id = -1;
        s.waveId = -1;
        s.lane.group.visible = false;
        s.wall.visible = false;
        s.wake.visible = false;
      }
    const heatGuardian = this.guardianId >= 0 ? world.entities.get(this.guardianId) : undefined;
    const finalBoss = this.finalId >= 0 ? world.entities.get(this.finalId) : undefined;
    for (const id of live) {
      const e = world.entities.get(id);
      if (!e) continue;
      if (e.templateId.startsWith(HEAT_OBJECTS.fistPrefix)) {
        if (this.fists.some((s) => s.id === id)) continue;
        const slot = this.fists.find((s) => s.id < 0);
        if (!slot) continue;
        slot.id = id;
        slot.born = this.clock;
        slot.seconds = heatTimedOf(HEAT_OBJECTS.fistPrefix, e.templateId) ?? T.fistCast;
        slot.x = e.pos.x;
        slot.z = e.pos.z;
        // It leans in from whichever fist-bearer is nearer: the Heat guardian
        // in the Hearth, the Masterless Strength on the Anvil.
        const guardian = nearerOf(heatGuardian, finalBoss, e.pos.x, e.pos.z);
        slot.yaw = guardian ? Math.atan2(e.pos.x - guardian.pos.x, e.pos.z - guardian.pos.z) : 0;
        const y = this.groundY(e.pos.x, e.pos.z);
        this.kit.drapeFan(slot.fan, this.groundY, e.pos.x, y, e.pos.z, 0, e.scale || T.fistR);
        slot.fan.group.visible = true;
        continue;
      }
      const of = swellLaneOf(e.templateId);
      if (!of) continue;
      let slot = this.lanes.find((s) => s.id === id);
      if (!slot) {
        slot = this.lanes.find((s) => s.id < 0);
        if (!slot) continue;
        slot.id = id;
        slot.born = this.clock;
        slot.rollAt = -1;
        slot.waveId = -1;
        slot.warn = of.seconds;
        slot.x = e.pos.x;
        slot.z = e.pos.z;
        slot.y = this.groundY(e.pos.x, e.pos.z);
        slot.facing = e.facing;
        const half = e.scale || T.laneHalf;
        const o = heatClaimOrigin(e.pos.x, e.pos.z);
        // On the Hearth's floor to its edge; on the Anvil of the World (the
        // Masterless Strength's Heat quarter reuses the fist) to its rim.
        slot.length = o
          ? laneReach(e.pos.x - o.x, e.pos.z - o.z, e.facing, T.laneLength)
          : T.laneLength;
        this.kit.drapeLane(
          slot.lane,
          this.groundY,
          e.pos.x,
          slot.y,
          e.pos.z,
          e.facing,
          slot.length,
          half,
          LANE_STYLE,
        );
        slot.lane.group.visible = true;
        slot.wake.position.set(e.pos.x, slot.y + 0.05, e.pos.z);
        slot.wake.rotation.y = e.facing;
        slot.wake.scale.set(half * 2.2, 1, slot.length);
        slot.wakeMat.uniforms.uLen.value = slot.length;
      }
      if (of.state === 'roll' && slot.rollAt < 0) slot.rollAt = this.clock;
    }
    // Each wave to the lane it rolls down (its facing, on the lane's line).
    for (const id of live) {
      const e = world.entities.get(id);
      if (!e || e.templateId !== HEAT_OBJECTS.wave) continue;
      if (this.lanes.some((s) => s.waveId === id)) continue;
      for (const s of this.lanes) {
        if (s.id < 0 || s.waveId >= 0) continue;
        if (Math.abs(wrapAngle(e.facing - s.facing)) > 0.01) continue;
        const dx = e.pos.x - s.x;
        const dz = e.pos.z - s.z;
        if (Math.abs(dx * Math.cos(s.facing) - dz * Math.sin(s.facing)) > 0.75) continue;
        s.waveId = id;
        break;
      }
    }
  }

  private leave(): void {
    this.active = false;
    this.rosterSeen = Number.NaN;
    this.candidateIds.length = 0;
    for (const s of this.fists) {
      s.id = -1;
      s.fan.group.visible = false;
      s.fist.visible = false;
    }
    for (const s of this.lanes) {
      s.id = -1;
      s.waveId = -1;
      s.lane.group.visible = false;
      s.wall.visible = false;
      s.wake.visible = false;
    }
    for (const c of this.craters) {
      c.at = -99;
      c.mesh.visible = false;
      c.flash.visible = false;
    }
  }

  // ---- the spot and the fist ------------------------------------------------------------

  private paintFists(world: IWorld, dt: number): void {
    for (const s of this.fists) {
      if (s.id < 0) continue;
      const look = fistLook(this.clock - s.born, s.seconds, _fist);
      const e = world.entities.get(s.id);
      PAINT.fill = look.fill;
      PAINT.clock = this.clock;
      PAINT.range = e?.scale || T.fistR;
      PAINT.front = undefined;
      PAINT.fade = undefined;
      this.kit.paintFan(s.fan, PAINT);
      const y = this.groundY(s.x, s.z);
      s.fist.visible = look.shown;
      if (!look.shown) continue;
      // It comes in from the guardian's side, leaning back toward it.
      s.fist.position.set(
        s.x - Math.sin(s.yaw) * look.height * 0.25,
        y + look.height,
        s.z - Math.cos(s.yaw) * look.height * 0.25,
      );
      _q.setFromAxisAngle(_v.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw)), -0.35);
      s.fist.quaternion.copy(_q);
      s.fist.rotateY(s.yaw);
      if (this.rand() < dt * 40 * this.density)
        this.particles.puff(
          s.fist.position.x,
          s.fist.position.y + 2,
          s.fist.position.z,
          1,
          TRAIL_PUFF,
        );
      // The cracks of light under the spot (cosmetic over the telegraph).
      if (this.rand() < dt * 10 * look.crack * this.density)
        this.particles.puff(
          s.x + (this.rand() - 0.5) * T.fistR,
          y + 0.2,
          s.z + (this.rand() - 0.5) * T.fistR,
          1,
          CRACK_PUFF,
        );
    }
  }

  // ---- the lanes and their swells ---------------------------------------------------------

  private paintLanes(world: IWorld, dt: number): void {
    for (const s of this.lanes) {
      if (s.id < 0) continue;
      const e = world.entities.get(s.id);
      const half = e?.scale || T.laneHalf;
      if (s.rollAt < 0) {
        PAINT.fill = Math.min(1, (this.clock - s.born) / Math.max(0.1, s.warn));
        PAINT.clock = this.clock;
        PAINT.range = s.length;
        PAINT.front = undefined;
        PAINT.fade = undefined;
        this.kit.paintLane(s.lane, PAINT);
        s.wall.visible = false;
        s.wake.visible = false;
        continue;
      }
      // The sim's wave object places the crest while it rolls (re-anchoring
      // the clock), the clock carries it past the lane's end as it sinks.
      const wave = s.waveId >= 0 ? world.entities.get(s.waveId) : undefined;
      if (wave) {
        const along =
          (wave.pos.x - s.x) * Math.sin(s.facing) + (wave.pos.z - s.z) * Math.cos(s.facing);
        if (along < T.laneLength - 0.05) s.rollAt = this.clock - Math.max(0, along) / T.waveSpeed;
      }
      const front = swellFront(this.clock - s.rollAt);
      // The lane fades as its wave leaves it behind (still on every tier).
      PAINT.fill = 1;
      PAINT.clock = this.clock;
      PAINT.range = s.length;
      PAINT.front = 0;
      PAINT.fade = Math.max(0.25, 1 - front / (s.length + T.waveDepth));
      this.kit.paintLane(s.lane, PAINT);
      const h = swellHeight(front, s.length);
      const ahead = Math.min(front, s.length);
      const wx = s.x + Math.sin(s.facing) * ahead;
      const wz = s.z + Math.cos(s.facing) * ahead;
      s.wall.visible = h > 0.05;
      s.wall.position.set(wx, this.groundY(wx, wz), wz);
      s.wall.rotation.y = s.facing;
      s.wall.scale.set(half + 0.4, h, T.waveDepth + 1.2);
      s.wallMat.uniforms.uHeat.value = 0.85 + 0.25 * (h / SWELL_HEIGHT);
      s.wakeMat.uniforms.uFront.value = ahead;
      s.wake.visible = true;
      if (s.wall.visible && this.rand() < dt * 30 * this.density) {
        const off = (this.rand() - 0.5) * 2 * half;
        this.particles.puff(
          wx + Math.cos(s.facing) * off,
          s.wall.position.y + h * 0.95,
          wz - Math.sin(s.facing) * off,
          1,
          SPRAY_PUFF,
        );
      }
    }
  }

  private paintCraters(): void {
    for (const c of this.craters) {
      if (c.at < -50) continue;
      const look = craterLook(this.clock - c.at, _crater);
      if (look.glow <= 0.005 && look.flash <= 0.005) {
        c.at = -99;
        c.mesh.visible = false;
        c.flash.visible = false;
        continue;
      }
      c.mat.uniforms.uGlow.value = look.glow;
      c.mat.uniforms.uFlash.value = look.flash;
      c.flashMat.opacity = look.flash;
      const fs = 6 + 18 * (1 - look.flash);
      c.flash.scale.set(fs, fs, 1);
      c.flash.visible = look.flash > 0.01;
      if (look.glow > 0.2 && this.rand() < 0.15 * this.density)
        this.particles.puff(c.x, this.groundY(c.x, c.z) + 0.5, c.z, 1, SMOKE_PUFF);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.glowTex?.dispose();
  }
}
