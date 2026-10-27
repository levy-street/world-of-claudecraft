// The Guardian of the Heat's fight in the Hearth (plan: heat_fight_fx_core.ts;
// docs/design/raid/smith_heart.md section 7.4, "the well of the first
// flame"), hosted by ../rift_death_zone.ts beside HeatFx (Basalt Fist and its
// Molten Swells) and the body (heat_body.ts). Presentation only, read from
// IWorld (the fight's objects, the adds, the guardian's and the players'
// auras, the cues), so offline and online look the same. It owns one gated
// root, the particles and the floor telegraph kit, and lends them to its
// parts:
//  - heat_well_fx.ts: the first wellspring (calm, overflowing) and the
//    overflow's rivers;
//  - heat_cinder_fx.ts: a Rolling Cinder's fall and the cinder itself, the
//    hunted's marks, the adds' fire;
// and paints itself:
//  - the Hearthseeds: each seed's burning heart throbbing faster to its
//    burst, its near-lethal core and its whole reach on the floor (danger,
//    every tier), the burst's flash and ring;
//  - Wakefire: each band round the wellspring at its exact radii, building
//    (cracks of fire spreading through the basalt between its two rims, the
//    rims the danger colour, every tier), then erupting in a sheet of flame;
//  - the burning patches (a cinder's scorch, a Cinder Trail): molten ground
//    at the sim's exact radius, a danger rim, every tier;
//  - Hearth Flare's bolts to the far, a Kindling Mark's sigil over its
//    player, the Falling Cinders, every other cue's burst.
// Every footprint draws on every tier; sparks, embers, haze, smoke, flames
// and the shakes thin on the low tier and under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through `attachSceneGroupGated`; fixed
// pools, no per-frame allocation, no light. Feeds
// ../../game/smith_heart_heat_audio.ts.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HeatAudio } from '../../game/smith_heart_heat_audio';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_GUARDIAN,
  HEAT_MOBS,
  HEAT_OBJECTS,
  heatTimedOf,
  HEAT_TUNING as T,
} from '../../sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  type TelegraphPaint,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { heartKitProgramWarmers } from '../smith_heart/heart_kit';
import { heartVeinGlowMaterial } from '../smith_heart/heart_room_kit';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { HeatCinderFx } from './heat_cinder_fx';
import {
  HEAT_FIGHT_COLORS as C,
  HEARTH_CENTRE,
  HEAT_FIGHT_REACH,
  type HeatObjectKind,
  heatClaimOrigin,
  heatFightClaims,
  heatFightHash,
  heatObjectKind,
  heatTimedOfCached,
  HEAT_FIGHT_POOLS as P,
  patchLook,
  SEED_CORE_R,
  type SeedLook,
  seedLook,
  type ZoneLook,
  zoneLook,
  zoneOfCached,
  zoneRadii,
} from './heat_fight_fx_core';
import { HEAT_FLOOR, heatParticleSteps } from './heat_floor_ladder_core';
import type { HeatFxHost } from './heat_fx_host';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { moltenDecal } from './heat_molten_decal';
import { floorRingGeometry } from './heat_shapes';
import { HeatTelegraphs } from './heat_telegraph';
import { HeatWellFx } from './heat_well_fx';

const SCAN_SEC = 0.1;
/** The Hearth's floor's box (instance-local): a band never draws past it. */
const HEARTH_FLOOR_BOX = { x0: -256, x1: -174, z0: -46, z1: 46 } as const;
const DANGER = { color: TELEGRAPH_THREAT_COLORS.danger, accent: C.accent };
const PAINT: TelegraphPaint = { fill: 0, clock: 0, range: 0 };
const _seed: SeedLook = { fill: 0, beat: 0, glow: 0, size: 0 };
const _zone: ZoneLook = { build: 0, burn: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const KINDS: readonly HeatObjectKind[] = [
  'well',
  'river',
  'seed',
  'zone',
  'fall',
  'scorch',
  'trail',
];
const ADD_IDS: ReadonlySet<string> = new Set([
  HEAT_MOBS.spawn,
  HEAT_MOBS.keeper,
  HEAT_MOBS.seedflame,
]);
/** A flare's bolt holds this long. */
const BOLT_SECONDS = 0.45;

const SPARK = {
  speed: 7,
  up: 3,
  life: 0.6,
  size: [0.4, 0.08] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  gravity: 8,
  radius: 1,
};
const SMOKE = {
  speed: 1.2,
  up: 2.2,
  life: 2,
  size: [1.4, 3.8] as [number, number],
  color: C.smoke,
  alpha: 0.3,
  drag: 0.7,
  radius: 1.5,
};
const FLAME = {
  speed: 0.8,
  up: 4,
  life: 0.6,
  size: [1.6, 0.4] as [number, number],
  color: C.gold,
  alpha: 0.9,
  pool: 'glow' as const,
  radius: 1,
};
const SEED_DIR: [number, number, number] = [0, 1, 0];
const SEED_SPARK = {
  speed: 3,
  life: 0.5,
  size: [0.3, 0.06] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  dir: SEED_DIR,
  spread: 0.6,
  radius: 0.4,
};
const BOLT_DIR: [number, number, number] = [0, -1, 0];
const BOLT = {
  speed: 18,
  life: 0.3,
  size: [1.2, 0.3] as [number, number],
  color: C.gold,
  alpha: 1,
  pool: 'glow' as const,
  dir: BOLT_DIR,
  spread: 0.05,
  radius: 0.4,
};
// ---- shaders ---------------------------------------------------------------------------

const DISC_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vXY;
varying vec3 vP;
varying vec3 vW;
void main() {
  vXY = position.xz;
  vP = instanceColor;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** A burning patch (vP: burn, kind, seed): molten ground, its rim the danger
 *  colour (kind 0 a trail, 1 a cinder's scorch: a ragged burning edge). */
const PATCH_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uRim;
varying vec2 vXY;
varying vec3 vP;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  float r = length(vXY);
  float rag = vP.y * (vn(vec2(atan(vXY.y, vXY.x) * 3.0, uTime * 0.6)) - 0.5) * 0.12;
  if (r > 1.0 + rag) discard;
  float lvl = lavaLevel(vW.xz, vec2(0.0), uTime * 0.5, 1.0);
  float m = vP.x * (0.45 + 0.6 * lvl) * (1.0 - 0.4 * r);
  vec3 col = mix(vec3(0.05, 0.04, 0.035), molten(clamp(m, 0.0, 1.0)), smoothstep(0.03, 0.25, m));
  float rim = smoothstep(0.86, 0.95, r - rag) * (1.0 - smoothstep(0.97, 1.02, r - rag));
  col = mix(col, uRim * 1.4, rim);
  float a = (1.0 - smoothstep(0.92, 1.02, r - rag)) * (0.55 + 0.35 * vP.x) + rim * 0.9;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.97));
  #include <colorspace_fragment>
}
`;
const RING_VERT = /* glsl */ `
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
/** A Wakefire band between its two radii (uv.y inner 0 to outer 1): both rims
 *  the danger colour, cracks of fire spreading through the hexagonal basalt
 *  as it builds (uBuild), then a sheet of the first flame (uBurn). */
const ZONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBuild;
uniform float uBurn;
uniform vec3 uRim;
uniform vec4 uClip;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  // Only over the Hearth's floor (the back band reaches past its walls).
  if (vW.x < uClip.x || vW.x > uClip.y || vW.z < uClip.z || vW.z > uClip.w) discard;
  float y = vUv.y;
  float rims = (1.0 - smoothstep(0.0, 0.045, y)) + smoothstep(0.955, 1.0, y);
  // The basalt's joints lighting as the warning builds.
  float joint = 1.0 - smoothstep(0.0, 0.07, cellEdge(vW.xz * 0.45));
  float spread = step(vn(vW.xz * 0.12) * 0.8 + 0.1, uBuild);
  float crack = joint * spread * (0.5 + 0.5 * uBuild);
  float lvl = lavaLevel(vW.xz, vec2(0.0, 1.5), uTime, 1.2);
  float m = max(crack * 0.75, uBurn * (0.55 + 0.6 * lvl));
  vec3 col = molten(clamp(m, 0.0, 1.0));
  col = mix(col, uRim * 1.5, clamp(rims, 0.0, 1.0));
  float wash = 0.12 + 0.18 * uBuild;
  float a = max(max(rims * 0.95, crack * 0.85), max(wash, uBurn * 0.92));
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.96));
  #include <colorspace_fragment>
}
`;
/** A flare's bolt: a white-gold beam from the guardian to its target. */
const BEAM_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 nrm = normalize(mat3(modelMatrix) * normal);
  vFace = abs(dot(nrm, normalize(cameraPosition - wp.xyz)));
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying float vFace;
${HEAT_NOISE_GLSL}
void main() {
  float run = vn(vec2(vUv.y * 9.0 - uTime * 16.0, vUv.x * 6.0));
  float core = pow(vFace, 6.0);
  float sheath = pow(vFace, 1.4);
  vec3 col = mix(vec3(1.0, 0.7, 0.3), vec3(1.0, 0.97, 0.86), core * (0.75 + 0.25 * run));
  float a = (0.15 + 0.55 * sheath + 0.6 * core) * (0.8 + 0.2 * run) * uAlpha;
  gl_FragColor = vec4(col * a * 3.0, min(1.0, a));
  #include <colorspace_fragment>
}
`;

// ---- the slots ------------------------------------------------------------------------

interface SeedSlot {
  id: number;
  born: number;
  life: number;
  core: TelegraphFan;
  reach: TelegraphFan;
}

interface ZoneSlot {
  id: number;
  band: number;
  state: 'warn' | 'burn' | null;
  born: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface PatchSlot {
  id: number;
  born: number;
}

interface BoltSlot {
  from: number;
  to: number;
  at: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export class HeatFightFx implements HeatFxHost {
  readonly readyForEntry: Promise<void>;
  readonly root = new THREE.Group();
  readonly uTime = { value: 0 };
  readonly detail: boolean;
  readonly density: number;
  readonly particles: EngineParticles;
  readonly kit: TelegraphKit;
  readonly telegraphs: HeatTelegraphs;
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly glowTex: THREE.Texture | null;
  private readonly audio = new HeatAudio(sfx);
  /** The floor's height (bound: the parts pass it on to the kit). */
  readonly groundY = (x: number, z: number): number => this.groundFn(x, z);
  private readonly well: HeatWellFx;
  private readonly cinder: HeatCinderFx;
  private readonly seeds: SeedSlot[] = [];
  private readonly seedOrbs: THREE.InstancedMesh;
  private readonly seedGlows: THREE.Sprite[] = [];
  private readonly zones: ZoneSlot[] = [];
  private readonly patches: THREE.InstancedMesh;
  private readonly patchSlots: PatchSlot[] = [];
  private readonly bolts: BoltSlot[] = [];
  private readonly sigils: THREE.Sprite[] = [];
  // The scan's findings (ids, reused arrays).
  private readonly candidateIds: number[] = [];
  private readonly ids = new Map<HeatObjectKind, number[]>();
  private readonly cinderIds: number[] = [];
  private readonly addIds: number[] = [];
  private readonly huntedIds: number[] = [];
  private readonly kindledIds: number[] = [];
  private guardianId = -1;
  private rosterSeen = Number.NaN;
  private origin: { x: number; z: number } | null = null;
  private readonly lookup = (id: number): Entity | undefined => this.world?.entities.get(id);
  private readonly groundAt = (x: number, z: number): number => this.groundY(x, z);
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x6a21;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundFn: (x: number, z: number) => number,
    readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-heat-fight-fx';
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
      heatParticleSteps('heat_fight_fx'),
    );
    this.kit = new TelegraphKit(this.root, this.detail);
    // Every warning of the fight (the seeds, the rivers' lanes, the falls, a
    // cinder's reach, the hunted's rings) in the Hearth's molten paint, on
    // the fight's own rungs of the Heat's floor ladder.
    this.telegraphs = new HeatTelegraphs(
      this.kit,
      {
        char: HEAT_FLOOR.fightTelegraphChar.step,
        glow: HEAT_FLOOR.fightTelegraphGlow.step,
        curtain: HEAT_FLOOR.fightTelegraphCurtain.step,
      },
      this.materials,
    );
    this.glowTex = hasDom ? radialGlowTexture() : null;
    for (const k of KINDS) this.ids.set(k, []);

    this.well = new HeatWellFx(this);
    this.cinder = new HeatCinderFx(this);

    // ---- the seeds ----
    const crystal = new THREE.OctahedronGeometry(1, 0);
    const shade = new Float32Array(crystal.getAttribute('position').count * 3).fill(1);
    crystal.setAttribute('color', new THREE.BufferAttribute(shade, 3));
    this.geometries.push(crystal);
    const seedMat = heartVeinGlowMaterial(0xfff0c0, 'smithHeartHeatSeed');
    this.materials.push(seedMat);
    this.seedOrbs = new THREE.InstancedMesh(crystal, seedMat, P.seeds);
    this.seedOrbs.name = 'smithHeartHeatSeeds';
    this.seedOrbs.frustumCulled = false;
    this.seedOrbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.seeds; i++) this.seedOrbs.setMatrixAt(i, _zero);
    this.seedOrbs.visible = false;
    this.root.add(this.seedOrbs);
    const seedGlow = this.sprite(0xffd890, 'smithHeartHeatSeedGlow');
    for (let i = 0; i < P.seeds; i++) {
      const core = this.telegraphs.fan('seedCore');
      this.kit.layOutFan(core, 360, DANGER);
      core.group.visible = false;
      const reach = this.telegraphs.fan('seedReach');
      this.kit.layOutFan(reach, 360, DANGER);
      reach.group.visible = false;
      this.seeds.push({ id: -1, born: 0, life: T.seedLife, core, reach });
      const g = new THREE.Sprite(seedGlow);
      g.visible = false;
      this.root.add(g);
      this.seedGlows.push(g);
    }

    // ---- Wakefire's bands ----
    for (let i = 0; i < P.zones; i++) {
      const [inner, outer] = zoneRadii(i);
      const geo = floorRingGeometry(inner / outer, 128);
      this.geometries.push(geo);
      // Char and glow passes: two bands meet on their shared radius.
      const { mesh, mat } = moltenDecal(
        {
          name: 'smithHeartHeatWakefire',
          geometry: geo,
          vertexShader: RING_VERT,
          fragmentShader: ZONE_FRAG,
          uniforms: {
            uTime: this.uTime,
            uBuild: { value: 0 },
            uBurn: { value: 0 },
            uRim: { value: new THREE.Color(TELEGRAPH_THREAT_COLORS.danger) },
            uClip: { value: new THREE.Vector4(-1e9, 1e9, -1e9, 1e9) },
          },
          charStep: HEAT_FLOOR.zoneChar.step,
          glowStep: HEAT_FLOOR.zoneGlow.step,
        },
        this.materials,
      );
      this.root.add(mesh);
      this.zones.push({ id: -1, band: i, state: null, born: 0, mesh, mat });
    }

    // ---- the burning patches ----
    const disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    const patchMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatPatches',
      uniforms: {
        uTime: this.uTime,
        uRim: { value: new THREE.Color(TELEGRAPH_THREAT_COLORS.danger) },
      },
      vertexShader: DISC_VERT,
      fragmentShader: PATCH_FRAG,
      transparent: true,
      toneMapped: false,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials.push(patchMat);
    this.patches = new THREE.InstancedMesh(disc, patchMat, P.patches);
    this.patches.name = 'smithHeartHeatPatches';
    this.patches.frustumCulled = false;
    this.patches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.patches; i++) {
      this.patches.setMatrixAt(i, _zero);
      this.patches.setColorAt(i, _c.setRGB(0, 0, 0));
      this.patchSlots.push({ id: -1, born: 0 });
    }
    if (this.patches.instanceColor) this.patches.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.patches.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.patches.step);
    this.patches.visible = false;
    this.root.add(this.patches);

    // ---- Hearth Flare's bolts, the Kindling Mark's sigils ----
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    for (let i = 0; i < P.bodies; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatFlare',
        uniforms: { uTime: this.uTime, uAlpha: { value: 0 } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.name = 'smithHeartHeatFlare';
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.root.add(mesh);
      this.bolts.push({ from: -1, to: -1, at: -99, mesh, mat });
    }
    const sigilMat = this.sprite(0xff9a3a, 'smithHeartHeatKindling');
    for (let i = 0; i < P.bodies; i++) {
      const s = new THREE.Sprite(sigilMat);
      s.visible = false;
      this.root.add(s);
      this.sigils.push(s);
    }

    this.root.add(heartKitProgramWarmers());
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  // ---- the host's loans ------------------------------------------------------------------

  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  shakeNear(x: number, z: number, amount: number, reach = 45): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  sprite(color: number, name: string): THREE.SpriteMaterial {
    const m = new THREE.SpriteMaterial({
      map: this.glowTex,
      color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name,
    });
    this.materials.push(m);
    return m;
  }

  // ---- events ---------------------------------------------------------------------------

  /** Claims the fight's own cues (the renderer's generic draw is skipped). */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    this.audio.event(ev, this.lookup, this.groundAt);
    if (ev.type === 'spellfxAt') {
      if (!heatFightClaims(ev.ability)) return false;
      this.burstAt(ev.ability ?? '', ev.x, ev.z, ev.radius ?? 2);
      return true;
    }
    if (ev.type !== 'spellfx' || !heatFightClaims(ev.ability)) return false;
    const src = this.world.entities.get(ev.sourceId);
    const dst = this.world.entities.get(ev.targetId);
    switch (ev.ability) {
      case HEAT_CUES.flare:
        this.flareBolt(ev.sourceId, ev.targetId);
        break;
      case HEAT_CUES.bolt:
        if (dst) {
          this.particles.puff(dst.pos.x, dst.pos.y + 9, dst.pos.z, 8, BOLT);
          this.particles.puff(dst.pos.x, dst.pos.y + 0.5, dst.pos.z, 10, SPARK);
        }
        break;
      case HEAT_CUES.kindling:
        if (dst) this.particles.puff(dst.pos.x, dst.pos.y + 1.2, dst.pos.z, 12, SPARK);
        break;
      case HEAT_CUES.cinderKnock:
        if (dst) {
          this.particles.puff(dst.pos.x, dst.pos.y + 2, dst.pos.z, 20, { ...SPARK, speed: 10 });
          this.particles.shockRing(dst.pos.x, dst.pos.z, C.ring, 5, 0.5);
        }
        break;
      case HEAT_CUES.settle:
        if (src) this.particles.shockRing(src.pos.x, src.pos.z, C.ringGold, 30, 1.6);
        break;
      default:
        break;
    }
    return true;
  }

  /** A positioned cue's burst. */
  private burstAt(ability: string, x: number, z: number, r: number): void {
    const y = this.groundY(x, z);
    switch (ability) {
      case HEAT_CUES.river:
        this.particles.puff(x, y + 1, z, 16, { ...SPARK, radius: 3 });
        break;
      case HEAT_CUES.spawn:
      case HEAT_CUES.hatch:
        this.particles.puff(x, y + 0.5, z, 18, SPARK);
        this.particles.shockRing(x, z, C.ringGold, 4, 0.5);
        break;
      case HEAT_CUES.feed:
        this.particles.puff(x, y + 2, z, 40, { ...SPARK, speed: 14, up: 8, radius: 3 });
        this.particles.shockRing(x, z, C.white, 50, 1.3);
        this.shakeNear(x, z, 0.8, 90);
        break;
      case HEAT_CUES.seed:
        this.particles.puff(x, y + 0.4, z, 10, SPARK);
        break;
      case HEAT_CUES.seedBurst:
        this.particles.shockRing(x, z, C.ring, r, 0.8);
        this.particles.puff(x, y + 1, z, 30, { ...SPARK, speed: 11, up: 6, radius: 1.2 });
        this.particles.puff(x, y + 1, z, 8, SMOKE);
        this.shakeNear(x, z, 0.35, 30);
        break;
      case HEAT_CUES.ignite:
        // The band's sheet of flame: rings and fire rising round it.
        this.particles.shockRing(x, z, C.ringGold, r, 0.9);
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const rr = r * (0.75 + 0.2 * this.rand());
          this.particles.puff(x + Math.sin(a) * rr, y + 0.4, z + Math.cos(a) * rr, 2, FLAME);
        }
        this.shakeNear(x, z, 0.5, 70);
        break;
      case HEAT_CUES.cinderLand:
        this.particles.shockRing(x, z, C.white, r * 3, 0.8);
        this.particles.puff(x, y + 1, z, 40, { ...SPARK, speed: 12, up: 7, radius: r * 0.5 });
        this.particles.puff(x, y + 1.5, z, 10, SMOKE);
        this.shakeNear(x, z, 0.8, 60);
        break;
      case HEAT_CUES.cinderBurst:
        this.particles.shockRing(x, z, C.white, r * 4, 0.9);
        this.particles.puff(x, y + 1.5, z, 50, { ...SPARK, speed: 15, up: 6, radius: 1.5 });
        this.particles.puff(x, y + 1.5, z, 12, SMOKE);
        this.shakeNear(x, z, 1, 70);
        break;
      default:
        this.particles.puff(x, y + 0.5, z, 10, SPARK);
        break;
    }
  }

  private flareBolt(from: number, to: number): void {
    let slot = this.bolts[0];
    for (const b of this.bolts) if (b.at < slot.at) slot = b;
    slot.from = from;
    slot.to = to;
    slot.at = this.clock;
    const dst = this.world?.entities.get(to);
    if (dst) this.particles.puff(dst.pos.x, dst.pos.y + 1.2, dst.pos.z, 12, SPARK);
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
    if (!this.origin) {
      this.audio.update(null, null);
      this.particles.update(this.clock);
      return;
    }
    const guardian = this.guardianId >= 0 ? (world.entities.get(this.guardianId) ?? null) : null;
    const list = (k: HeatObjectKind) => this.ids.get(k) ?? [];
    const wellIds = list('well');
    this.well.update(wellIds.length > 0 ? wellIds[0] : -1, guardian, list('river'), this.clock, dt);
    this.cinder.update(list('fall'), this.cinderIds, this.addIds, this.huntedIds, this.clock, dt);
    this.paintSeeds(world, dt);
    this.paintZones(world);
    this.paintPatches(world, dt);
    this.paintBolts(world);
    this.paintSigils(world);
    this.particles.update(this.clock);
    this.audio.update(guardian, world.entities.get(world.playerId) ?? null);
  }

  // ---- the scan -------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    const origin = me ? heatClaimOrigin(me.pos.x, me.pos.z) : null;
    const near =
      origin !== null &&
      me !== undefined &&
      Math.hypot(me.pos.x - origin.x - HEARTH_CENTRE.x, me.pos.z - origin.z - HEARTH_CENTRE.z) <
        HEAT_FIGHT_REACH + 40;
    if (!near || !origin) {
      if (this.origin) this.leave();
      return;
    }
    if (!this.origin || this.origin.x !== origin.x || this.origin.z !== origin.z) {
      this.origin = origin;
      this.rosterSeen = Number.NaN;
    }
    if (world.entityRosterVersion !== this.rosterSeen) {
      this.rosterSeen = world.entityRosterVersion;
      const ids = this.candidateIds;
      ids.length = 0;
      for (const e of world.entities.values()) {
        if (e.kind === 'player') {
          ids.push(e.id);
          continue;
        }
        if (Math.abs(e.pos.x - origin.x) > 300 || Math.abs(e.pos.z - origin.z) > 260) continue;
        if (e.kind === 'object' && heatObjectKind(e.templateId)) ids.push(e.id);
        else if (
          e.kind === 'mob' &&
          (e.templateId === HEAT_GUARDIAN ||
            e.templateId === HEAT_MOBS.cinder ||
            ADD_IDS.has(e.templateId))
        )
          ids.push(e.id);
      }
    }
    for (const list of this.ids.values()) list.length = 0;
    this.cinderIds.length = 0;
    this.addIds.length = 0;
    this.huntedIds.length = 0;
    this.kindledIds.length = 0;
    this.guardianId = -1;
    for (const id of this.candidateIds) {
      const e = world.entities.get(id);
      if (!e) continue;
      if (e.kind === 'object') {
        const kind = heatObjectKind(e.templateId);
        if (kind) this.ids.get(kind)?.push(id);
      } else if (e.kind === 'mob') {
        if (e.templateId === HEAT_GUARDIAN) this.guardianId = id;
        else if (e.dead) continue;
        else if (e.templateId === HEAT_MOBS.cinder) this.cinderIds.push(id);
        else this.addIds.push(id);
      } else if (e.kind === 'player' && !e.dead) {
        // Once per player, however many of the marks it wears (a doubled id
        // would take a second slot and could crowd a real quarry out).
        let hunted = false;
        let kindled = false;
        for (const a of e.auras) {
          if (a.id === HEAT_AURAS.hunted) hunted = true;
          else if (a.id === HEAT_AURAS.kindling || a.id === HEAT_AURAS.trail) kindled = true;
        }
        if (hunted) this.huntedIds.push(id);
        if (kindled) this.kindledIds.push(id);
      }
    }
    this.assign(world);
  }

  /** Every seed, band and patch object to its slot (released when gone). */
  private assign(world: IWorld): void {
    const seeds = this.ids.get('seed') ?? [];
    for (const s of this.seeds)
      if (s.id >= 0 && !seeds.includes(s.id)) {
        s.id = -1;
        s.core.group.visible = false;
        s.reach.group.visible = false;
      }
    for (const id of seeds) {
      if (this.seeds.some((s) => s.id === id)) continue;
      const slot = this.seeds.find((s) => s.id < 0);
      const e = world.entities.get(id);
      if (!slot || !e) continue;
      slot.id = id;
      slot.born = this.clock;
      slot.life = heatTimedOf(HEAT_OBJECTS.seedPrefix, e.templateId) ?? T.seedLife;
      const y = this.groundY(e.pos.x, e.pos.z);
      this.kit.drapeFan(slot.core, this.groundY, e.pos.x, y, e.pos.z, 0, SEED_CORE_R);
      this.kit.drapeFan(slot.reach, this.groundY, e.pos.x, y, e.pos.z, 0, e.scale || T.seedReach);
      slot.core.group.visible = true;
      slot.reach.group.visible = true;
    }
    const zones = this.ids.get('zone') ?? [];
    for (const z of this.zones)
      if (z.id >= 0 && !zones.includes(z.id)) {
        z.id = -1;
        z.state = null;
        z.mesh.visible = false;
      }
    for (const s of this.patchSlots) {
      if (s.id < 0) continue;
      const live =
        (this.ids.get('scorch') ?? []).includes(s.id) ||
        (this.ids.get('trail') ?? []).includes(s.id);
      if (!live) s.id = -1;
    }
  }

  private leave(): void {
    this.origin = null;
    this.rosterSeen = Number.NaN;
    this.candidateIds.length = 0;
    this.well.hide();
    this.cinder.hide();
    for (const s of this.seeds) {
      s.id = -1;
      s.core.group.visible = false;
      s.reach.group.visible = false;
    }
    for (const g of this.seedGlows) g.visible = false;
    this.seedOrbs.visible = false;
    for (const z of this.zones) {
      z.id = -1;
      z.state = null;
      z.mesh.visible = false;
    }
    for (const s of this.patchSlots) s.id = -1;
    this.patches.visible = false;
    for (const b of this.bolts) {
      b.at = -99;
      b.mesh.visible = false;
    }
    for (const s of this.sigils) s.visible = false;
  }

  // ---- the seeds ----------------------------------------------------------------------------

  private paintSeeds(world: IWorld, dt: number): void {
    let n = 0;
    for (const s of this.seeds) {
      if (s.id < 0) continue;
      const e = world.entities.get(s.id);
      if (!e) continue;
      const look = seedLook(this.clock - s.born, s.life, _seed);
      PAINT.fill = look.fill;
      PAINT.clock = this.clock;
      PAINT.range = SEED_CORE_R;
      PAINT.front = undefined;
      PAINT.fade = undefined;
      this.kit.paintFan(s.core, PAINT);
      PAINT.fill = look.fill * 0.5;
      PAINT.range = e.scale || T.seedReach;
      PAINT.fade = 0.35 + 0.45 * look.fill;
      this.kit.paintFan(s.reach, PAINT);
      const y = this.groundY(e.pos.x, e.pos.z);
      const size = 0.55 + 0.75 * look.size;
      _v.set(e.pos.x, y + 1.1 + 0.15 * look.beat, e.pos.z);
      _q.setFromAxisAngle(_up, this.clock * (1 + 4 * look.fill));
      _s.set(size, size * 1.5, size);
      this.seedOrbs.setMatrixAt(n, _m.compose(_v, _q, _s));
      const glow = this.seedGlows[n];
      glow.position.copy(_v);
      const gs = 2.5 + 3.5 * look.glow;
      glow.scale.set(gs, gs, 1);
      glow.visible = true;
      n++;
      if (this.rand() < dt * (3 + 20 * look.fill) * this.density)
        this.particles.puff(e.pos.x, y + 1, e.pos.z, 1, SEED_SPARK);
    }
    for (let i = n; i < P.seeds; i++) {
      this.seedOrbs.setMatrixAt(i, _zero);
      this.seedGlows[i].visible = false;
    }
    this.seedOrbs.instanceMatrix.needsUpdate = true;
    this.seedOrbs.visible = n > 0;
  }

  // ---- Wakefire -----------------------------------------------------------------------------

  private paintZones(world: IWorld): void {
    for (const id of this.ids.get('zone') ?? []) {
      const e = world.entities.get(id);
      const of = e ? zoneOfCached(e.templateId) : null;
      if (!e || !of) continue;
      const slot = this.zones[of.band];
      if (!slot) continue;
      if (slot.id !== id) {
        this.audio.zoneBuild(e.pos.x, this.groundY(e.pos.x, e.pos.z), e.pos.z);
        slot.born = this.clock;
      } else if (slot.state !== of.state) slot.born = this.clock;
      slot.id = id;
      slot.state = of.state;
      const look = zoneLook(of.state, this.clock - slot.born, of.seconds, _zone);
      const [, outer] = zoneRadii(of.band);
      slot.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.1, e.pos.z);
      slot.mesh.scale.set(outer, 1, outer);
      if (this.origin) {
        const o = this.origin;
        (slot.mat.uniforms.uClip.value as THREE.Vector4).set(
          o.x + HEARTH_FLOOR_BOX.x0,
          o.x + HEARTH_FLOOR_BOX.x1,
          o.z + HEARTH_FLOOR_BOX.z0,
          o.z + HEARTH_FLOOR_BOX.z1,
        );
      }
      slot.mat.uniforms.uBuild.value = look.build;
      slot.mat.uniforms.uBurn.value = look.burn;
      slot.mesh.visible = true;
      if (look.burn > 0.1 && this.rand() < 0.9 * this.density) {
        const [inner] = zoneRadii(of.band);
        const a = this.rand() * Math.PI * 2;
        const rr = inner + this.rand() * (Math.min(outer, 45) - inner);
        this.particles.puff(
          e.pos.x + Math.sin(a) * rr,
          this.groundY(e.pos.x, e.pos.z) + 0.3,
          e.pos.z + Math.cos(a) * rr,
          1,
          FLAME,
        );
      }
    }
  }

  // ---- the burning patches ------------------------------------------------------------------

  private paintPatches(world: IWorld, dt: number): void {
    let n = 0;
    const paint = (kind: 'scorch' | 'trail') => {
      for (const id of this.ids.get(kind) ?? []) {
        if (n >= P.patches) return;
        const e = world.entities.get(id);
        if (!e) continue;
        let slot = this.patchSlots.find((s) => s.id === id);
        if (!slot) {
          slot = this.patchSlots.find((s) => s.id < 0);
          if (!slot) continue;
          slot.id = id;
          slot.born = this.clock;
        }
        const prefix = kind === 'scorch' ? HEAT_OBJECTS.scorchPrefix : HEAT_OBJECTS.trailPrefix;
        const life = heatTimedOfCached(prefix, e.templateId) ?? T.scorchLife;
        const burn = patchLook(this.clock - slot.born, life);
        const r = e.scale || (kind === 'scorch' ? T.cinderLandR : T.trailR);
        _v.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.05, e.pos.z);
        _s.set(r, 1, r);
        this.patches.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
        this.patches.setColorAt(
          n,
          _c.setRGB(Math.max(0.25, burn), kind === 'scorch' ? 1 : 0, heatFightHash(id, 5)),
        );
        n++;
        const rate = (kind === 'scorch' ? 6 : 4) * r * 0.4;
        if (this.rand() < dt * rate * burn * this.density) {
          const a = this.rand() * Math.PI * 2;
          const rr = Math.sqrt(this.rand()) * r * 0.85;
          this.particles.puff(
            _v.x + Math.sin(a) * rr,
            _v.y + 0.2,
            _v.z + Math.cos(a) * rr,
            1,
            FLAME,
          );
        }
      }
    };
    paint('scorch');
    paint('trail');
    for (let i = n; i < P.patches; i++) this.patches.setMatrixAt(i, _zero);
    this.patches.instanceMatrix.needsUpdate = true;
    if (this.patches.instanceColor) this.patches.instanceColor.needsUpdate = true;
    this.patches.visible = n > 0;
  }

  // ---- Hearth Flare's bolts and the Kindling Mark --------------------------------------------

  private paintBolts(world: IWorld): void {
    for (const b of this.bolts) {
      const since = this.clock - b.at;
      if (since > BOLT_SECONDS) {
        b.mesh.visible = false;
        continue;
      }
      const src = world.entities.get(b.from);
      const dst = world.entities.get(b.to);
      if (!src || !dst) {
        b.mesh.visible = false;
        continue;
      }
      // Out of the guardian's chest (it stands sunk to its waist).
      _v.set(src.pos.x, src.pos.y + 9, src.pos.z);
      _w.set(dst.pos.x, dst.pos.y + 1.2, dst.pos.z);
      _s.subVectors(_w, _v);
      const len = _s.length();
      if (len < 0.1) {
        b.mesh.visible = false;
        continue;
      }
      _q.setFromUnitVectors(_up, _s.divideScalar(len));
      const k = since / BOLT_SECONDS;
      b.mesh.position.copy(_v);
      b.mesh.quaternion.copy(_q);
      const w = 0.6 * (1 - k * 0.6);
      b.mesh.scale.set(w, len, w);
      b.mat.uniforms.uAlpha.value = 1 - k;
      b.mesh.visible = true;
    }
  }

  private paintSigils(world: IWorld): void {
    let n = 0;
    for (const id of this.kindledIds) {
      if (n >= this.sigils.length) break;
      const p = world.entities.get(id);
      if (!p) continue;
      let marked = false;
      for (const a of p.auras) if (a.id === HEAT_AURAS.kindling) marked = true;
      const s = this.sigils[n++];
      s.position.set(p.pos.x, p.pos.y + (marked ? 3.2 : 1.2), p.pos.z);
      const size = marked ? 2.2 + 0.4 * Math.sin(this.clock * 10) : 2.6;
      s.scale.set(size, size, 1);
      s.visible = true;
    }
    for (let i = n; i < this.sigils.length; i++) this.sigils[i].visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    this.well.dispose();
    this.cinder.dispose();
    this.seedOrbs.dispose();
    this.patches.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.glowTex?.dispose();
  }
}
