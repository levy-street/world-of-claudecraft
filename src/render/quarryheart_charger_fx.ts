// The Quarryheart Charger's body rig (MountVisualSpec.fx 'quarryheart'): everything that makes the
// Smith's Heart raid's reward mount look alive beyond its authored clips.
//
//   - The PLATES float. Each stone plate drifts along its own outward direction on its own phase
//     (the GLB's _DIR/_CEN/_KIND attributes, scripts/assets/quarryheart_charger/), the heart swells
//     on every beat, and on arrival every plate flies in from where it was flung, tumbling, the
//     ones nearest the core first. All of it is vertex work spliced into the charger's own stone
//     material, so it costs no draw and no allocation.
//   - The HEART beats. The fire body, the gold veins and the core take their emissive from a beat
//     that ripples outward from the core (lub, dub, quiet), and on arrival the fire catches at the
//     core and spreads out through the gaps.
//   - The WIND moves. The mane, tail and fetlock ribbons are redrawn as translucent wind (normal
//     blending, so they read against a bright sky too, and they never cast a shadow): streaks racing down
//     them, a wave along them that grows toward the tips, and lightning crackling through them.
//   - A soft HALO of heart-light hangs at the core (one sprite on the spine bone), leaking through
//     every gap and both flank windows.
//   - PARTICLES ride the shared cloud (vfx.ts emitParticle: no draw of their own): lightning sparks
//     off the mane and tail, embers rising out of the gaps, frost falling from the horns, the
//     running trail, an ember or frost print where a hoof strikes, the arrival's burst and the
//     rear's ground strike.
//
// The rig is created when the charger's body is built (mount_lifecycle.ts, before the compile
// gate lists its pieces, so its programs link behind the gate) and on the boot prewarm rig
// (mount_prewarm.ts). Its per-rider materials are clones the rig owns; when a rig goes away they
// are PARKED in a small pool and handed to the next charger built from the same source, so a
// dismount never frees the programs a remount needs and a remount links nothing.
//
// Known and accepted: the shadow pass draws the shared stock depth material, so a charger's shadow
// is its assembled body even while its plates are still flying home (the 1.35 s arrival) and never
// shows the plates' small float. The wind ribbons cast no shadow at all.
//
// Decisions (beat, arrival, rates, strikes) are the pure core, quarryheart_charger_fx_core.ts.
// No lights: the heart's light is emissive, bloom and the halo. Reduced motion stills the float
// and the crackle, slows the wind and skips the arrival's flight; a low tier keeps the body and
// its glow and sheds the halo and the particle volume (the cloud's own quality scaling).
// Cosmetic only: nothing here is information a player acts on.

import * as THREE from 'three';
import { GFX } from './gfx';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  createQuarryheartHoofState,
  QUARRYHEART_BEAT_PERIOD,
  QUARRYHEART_CEN_SCALE,
  QUARRYHEART_CORE_BIND,
  QUARRYHEART_CORE_BONE,
  QUARRYHEART_HOOF_BONES,
  QUARRYHEART_HORN_BONE,
  QUARRYHEART_MANE_BONES,
  QUARRYHEART_REAR_STRIKE_SECONDS,
  QUARRYHEART_STONE_MATERIAL,
  QUARRYHEART_TAIL_BONE,
  QUARRYHEART_WIND_MATERIAL,
  type QuarryheartArrival,
  type QuarryheartBurstPolicy,
  type QuarryheartHoofState,
  type QuarryheartMotion,
  type QuarryheartRates,
  quarryheartArrival,
  quarryheartBeat,
  quarryheartBurstPolicy,
  quarryheartHoofStrike,
  quarryheartKeepsHalo,
  quarryheartMotion,
  quarryheartPlaysArrival,
  quarryheartPrintKind,
  quarryheartRates,
  quarryheartWhole,
} from './quarryheart_charger_fx_core';
import type { Vfx, VfxParticleSprite } from './vfx';

/** The slice of the particle cloud the rig draws into (vfx.ts implements it). */
export type QuarryheartParticleSink = Pick<
  Vfx,
  'emitParticle' | 'particleRate' | 'particleBurst' | 'particleHdr'
>;

/** The horn tips in the GLB's bind space (glTF axes): the build's horn paths, carried over. */
const HORN_TIPS_BIND = [
  [0.32, 4.7, 0.9],
  [-0.32, 4.7, 0.9],
] as const;

// ---------------------------------------------------------------------------
// shaders (spliced into the GLB's own materials; every authored number is a uniform)
// ---------------------------------------------------------------------------

/** The beat, in GLSL, the same curve as quarryheartBeat: exp() of a negative square only, so
 *  no pow() base can go negative (tests/shader_pow_domain.test.ts). */
const BEAT_GLSL = /* glsl */ `
float qhPulse(float x, float at, float w) {
  float d = (x - at) / w;
  return d < 0.0 ? exp(-d * d * 9.0) : exp(-d * d * 2.2);
}
float qhBeat(float t) {
  float p = fract(t / ${QUARRYHEART_BEAT_PERIOD.toFixed(3)});
  float calm = 0.5 + 0.5 * sin(p * 6.2831853);
  float beat = min(1.0, qhPulse(p, 0.06, 0.08) + 0.62 * qhPulse(p, 0.26, 0.08));
  return mix(beat, calm, uQhCalm);
}
`;

const STONE_VERT_HEAD = /* glsl */ `
attribute vec3 _dir;
attribute vec3 _cen;
attribute float _kind;
uniform float uQhTime;
uniform float uQhAssemble;
uniform float uQhIgnite;
uniform float uQhFloat;
uniform float uQhFlash;
uniform float uQhCalm;
uniform vec3 uQhCore;
uniform vec4 uQhDequant;
varying float vQhGlow;
${BEAT_GLSL}
`;

const STONE_VERT_BODY = /* glsl */ `
{
  // into the bind space the plate data is authored in (meshopt quantized the mesh's own space)
  vec3 qhP = transformed * uQhDequant.w + uQhDequant.xyz;
  vec3 qhCen = _cen * ${QUARRYHEART_CEN_SCALE.toFixed(1)};
  float qhPlate = step(0.5, _kind) * step(_kind, 1.5);
  float qhCore = step(1.5, _kind);
  float qhPhase = fract(dot(qhCen, vec3(12.9898, 78.233, 37.719)));
  // the plates' float: each drifts along its own outward direction, on its own phase
  qhP += _dir * qhPlate * uQhFloat * sin(mod(uQhTime, 512.0) * 1.6 + qhPhase * 6.2831853);
  // the heart swells on the beat
  float qhNow = mod(uQhTime, 512.0);
  qhP += _dir * qhCore * 0.06 * qhBeat(qhNow);
  // the arrival: every plate flies home from where it was flung, nearest the heart first
  float qhDist = qhPlate > 0.5 ? length(qhCen - uQhCore) : length(qhP - uQhCore);
  float qhStart = clamp(qhDist / 3.4, 0.0, 1.0) * 0.42;
  float qhK = clamp((uQhAssemble - qhStart) / 0.58, 0.0, 1.0);
  float qhE = 1.0 - qhK;
  qhE = qhE * qhE * qhE;
  if (qhPlate > 0.5 && qhE > 0.0) {
    vec3 qhAway = _dir * (2.0 + 2.6 * qhPhase) + vec3(0.0, 0.8 + 1.8 * fract(qhPhase * 7.13), 0.0);
    float qhAng = qhE * (2.5 + 5.0 * qhPhase);
    vec3 qhAxis = normalize(vec3(qhPhase - 0.5, 0.7, fract(qhPhase * 3.7) - 0.5));
    vec3 qhRel = qhP - qhCen;
    float qhC = cos(qhAng);
    float qhS = sin(qhAng);
    qhRel = qhRel * qhC + cross(qhAxis, qhRel) * qhS + qhAxis * dot(qhAxis, qhRel) * (1.0 - qhC);
    qhP = qhCen + qhRel * (1.0 - 0.35 * qhE) + qhAway * qhE;
  }
  transformed = (qhP - uQhDequant.xyz) / uQhDequant.w;
  // the fire: it catches at the heart and spreads outward; the beat ripples out the same way
  float qhReach = clamp(uQhIgnite * 1.3 - qhDist / 3.4 * 0.5, 0.0, 1.0);
  float qhRipple = qhBeat(qhNow - qhDist * 0.32) * (1.0 - 0.55 * clamp(qhDist / 3.0, 0.0, 1.0));
  vQhGlow = qhReach * (0.6 + 0.6 * qhRipple)
    + qhCore * qhReach * (0.7 + 1.1 * qhBeat(qhNow))
    + uQhFlash * (2.5 * qhCore + 0.6 * (1.0 - clamp(qhDist / 2.0, 0.0, 1.0)));
}
`;

const STONE_FRAG_HEAD = /* glsl */ `
varying float vQhGlow;
`;

// MeshStandard / MeshLambert / MeshPhong all fold the emissive map in here; a material with no
// emissive term (none ships today) simply keeps its look.
const EMISSIVE_ANCHOR = '#include <emissivemap_fragment>';

const WIND_VERT_HEAD = /* glsl */ `
uniform float uQhTime;
uniform float uQhWave;
uniform vec4 uQhDequant;
varying vec2 vQhUv;
varying float vQhSeed;
`;

const WIND_VERT_BODY = /* glsl */ `
{
  vQhUv = uv;
  // one seed per ribbon root region, steady along the ribbon (its bind position, coarsely)
  vQhSeed = fract(dot(floor((position * uQhDequant.w + uQhDequant.xyz) * 2.0), vec3(0.137, 0.271, 0.419)));
  float qhT = mod(uQhTime, 512.0);
  float qhTip = uv.x * uv.x;
  float qhW = sin(qhT * 3.1 + uv.x * 7.0 + vQhSeed * 6.2831853);
  float qhW2 = sin(qhT * 4.7 - uv.x * 11.0 + vQhSeed * 12.0);
  float qhInv = 1.0 / uQhDequant.w;
  transformed += normal * (qhW * 0.16 + qhW2 * 0.06) * qhTip * uQhWave * qhInv;
  transformed.y += sin(qhT * 2.3 + uv.x * 5.0 + vQhSeed * 4.0) * 0.07 * qhTip * uQhWave * qhInv;
}
`;

const WIND_FRAG_HEAD = /* glsl */ `
uniform float uQhTime;
uniform float uQhWind;
uniform float uQhCrackle;
uniform float uQhFlow;
uniform float uQhHdr;
varying vec2 vQhUv;
varying float vQhSeed;
float qhHash(float n) {
  return fract(sin(n) * 43758.5453);
}
`;

const WIND_FRAG_BODY = /* glsl */ `
  float qhU = vQhUv.x;
  float qhV = vQhUv.y;
  float qhT = mod(uQhTime, 512.0);
  float qhF = qhT * uQhFlow;
  float qhAcross = 1.0 - abs(qhV * 2.0 - 1.0);
  float qhEdge = smoothstep(0.0, 0.55, qhAcross);
  float qhRoot = smoothstep(0.0, 0.1, qhU);
  float qhTipFade = 1.0 - smoothstep(0.55, 1.0, qhU);
  // streaks racing root to tip
  float qhS1 = 0.5 + 0.5 * sin((qhU * 2.6 - qhF * 1.3 + vQhSeed * 3.0) * 6.2831853 + qhV * 1.5);
  float qhS2 = 0.5 + 0.5 * sin((qhU * 5.0 - qhF * 2.1 + vQhSeed * 5.0) * 6.2831853 - qhV * 2.0);
  float qhStreak = qhS1 * qhS1 * 0.65 + qhS2 * qhS2 * qhS2 * 0.35;
  // lightning: a jagged thread along the ribbon, flickering on in short bursts, segment by segment
  float qhSeg = floor(qhU * 5.0);
  float qhTick = floor(qhT * 13.0);
  float qhOn = step(0.78, qhHash(qhTick * 1.37 + qhSeg * 7.1 + vQhSeed * 91.0)) * uQhCrackle;
  float qhLine = 0.5 + 0.3 * sin(qhU * 37.0 + qhTick * 2.1 + vQhSeed * 9.0)
    + 0.12 * sin(qhU * 91.0 - qhTick * 3.3);
  float qhBolt = (1.0 - smoothstep(0.0, 0.07, abs(qhV - qhLine))) * qhOn * qhTipFade;
  float qhA = (0.46 + 0.5 * qhStreak) * qhEdge * qhRoot * qhTipFade * uQhWind;
  // a deep blue rim to a white heart, so the wind reads against a bright sky as well as a dark one
  vec3 qhCol = mix(vec3(0.12, 0.45, 0.9), vec3(0.88, 0.98, 1.0), qhStreak * qhAcross) * uQhHdr;
  qhCol += vec3(0.75, 0.9, 1.0) * qhBolt * 2.4 * uQhHdr;
  vec4 diffuseColor = vec4(qhCol, clamp(qhA + qhBolt * uQhWind, 0.0, 1.0));
`;

// ---------------------------------------------------------------------------
// the per-rider materials, parked and reused (never freed while a profile lives)
// ---------------------------------------------------------------------------

interface StoneUniforms {
  uQhTime: { value: number };
  uQhAssemble: { value: number };
  uQhIgnite: { value: number };
  uQhFloat: { value: number };
  uQhFlash: { value: number };
  uQhCalm: { value: number };
  uQhCore: { value: THREE.Vector3 };
  uQhDequant: { value: THREE.Vector4 };
}

interface WindUniforms {
  uQhTime: { value: number };
  uQhWave: { value: number };
  uQhWind: { value: number };
  uQhCrackle: { value: number };
  uQhFlow: { value: number };
  uQhHdr: { value: number };
  uQhDequant: { value: THREE.Vector4 };
}

// Every parked material belongs to one graphics profile: a clone of a retiring profile's GLB
// material, or one carrying its HDR gain, is disposed rather than parked once the profile resets.
let profileGeneration = 0;

interface StoneClone {
  gen: number;
  key: string;
  material: THREE.Material;
  uniforms: StoneUniforms;
}

interface WindClone {
  gen: number;
  material: THREE.MeshBasicMaterial;
  uniforms: WindUniforms;
}

interface HaloClone {
  gen: number;
  material: THREE.SpriteMaterial;
}

/** How many of each material each pool parks: a few chargers in view at once, never unbounded. */
const POOL_CAP = 4;
const stonePool: StoneClone[] = [];
const windPool: WindClone[] = [];
const haloPool: HaloClone[] = [];
let haloTexture: THREE.DataTexture | null = null;

/** Drop every parked material (a graphics-profile rebuild mints new sources and a new HDR gain;
 *  assets/graphics_profile.ts calls this with the other per-profile caches). */
export function resetQuarryheartProfileCaches(): void {
  profileGeneration += 1;
  for (const c of stonePool) c.material.dispose();
  for (const c of windPool) c.material.dispose();
  for (const c of haloPool) c.material.dispose();
  stonePool.length = 0;
  windPool.length = 0;
  haloPool.length = 0;
  haloTexture?.dispose();
  haloTexture = null;
}

function stoneKey(source: THREE.Material): string {
  const m = source as THREE.Material & {
    map?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
  };
  return `${source.type}|${m.map?.uuid ?? ''}|${m.emissiveMap?.uuid ?? ''}`;
}

function newStoneUniforms(): StoneUniforms {
  return {
    uQhTime: { value: 0 },
    uQhAssemble: { value: 1 },
    uQhIgnite: { value: 1 },
    uQhFloat: { value: 0 },
    uQhFlash: { value: 0 },
    uQhCalm: { value: 0 },
    uQhCore: {
      value: new THREE.Vector3(
        QUARRYHEART_CORE_BIND[0],
        QUARRYHEART_CORE_BIND[1],
        QUARRYHEART_CORE_BIND[2],
      ),
    },
    uQhDequant: { value: new THREE.Vector4(0, 0, 0, 1) },
  };
}

/** The GLB's dequantization (quantized mesh space to bind space: offset xyz, scale w), which the
 *  ship step writes into the charger materials' extras (ship_charger.mjs). An unquantized build
 *  carries none: identity. */
export function quarryheartDequant(material: THREE.Material, out: THREE.Vector4): THREE.Vector4 {
  const d = (material.userData as { quarryheartDequant?: unknown }).quarryheartDequant;
  if (Array.isArray(d) && d.length === 4 && d.every((x) => typeof x === 'number') && d[3] !== 0) {
    return out.set(d[0], d[1], d[2], d[3]);
  }
  return out.set(0, 0, 0, 1);
}

function takeStone(source: THREE.Material): StoneClone {
  const key = stoneKey(source);
  const i = stonePool.findIndex((c) => c.key === key);
  if (i >= 0) {
    const parked = stonePool.splice(i, 1)[0];
    quarryheartDequant(source, parked.uniforms.uQhDequant.value);
    return parked;
  }
  // the program-preserving clone: the rig's own layers (rim glow, the Gloamveil climb, surface
  // detail, sheen) stay, and the charger's splice runs after them, keyed on top of their key
  const material = cloneMaterialWithHooks(source);
  const uniforms = newStoneUniforms();
  quarryheartDequant(source, uniforms.uQhDequant.value);
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${STONE_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${STONE_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${STONE_FRAG_HEAD}`)
      .replace(EMISSIVE_ANCHOR, `${EMISSIVE_ANCHOR}\n  totalEmissiveRadiance *= vQhGlow;`);
  };
  material.customProgramCacheKey = () => `${prevKey()}|quarryheart-stone-v1`;
  return { gen: profileGeneration, key, material, uniforms };
}

function takeWind(source: THREE.Material): WindClone {
  const parked = windPool.pop();
  if (parked) {
    quarryheartDequant(source, parked.uniforms.uQhDequant.value);
    parked.uniforms.uQhHdr.value = GFX.composer ? 1.6 : 1;
    return parked;
  }
  const uniforms: WindUniforms = {
    uQhTime: { value: 0 },
    uQhWave: { value: 1 },
    uQhWind: { value: 1 },
    uQhCrackle: { value: 1 },
    uQhFlow: { value: 1 },
    uQhHdr: { value: GFX.composer ? 1.6 : 1 },
    uQhDequant: { value: quarryheartDequant(source, new THREE.Vector4()) },
  };
  const material = new THREE.MeshBasicMaterial({
    name: 'QuarryheartWindFx',
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
    // normal blending, not additive: pale wind over a bright sky would add up to nothing
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WIND_FRAG_HEAD}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', WIND_FRAG_BODY);
  };
  material.customProgramCacheKey = () => 'quarryheart-wind-v1';
  return { gen: profileGeneration, material, uniforms };
}

function haloMap(): THREE.DataTexture {
  if (haloTexture) return haloTexture;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - r);
      const v = Math.round(255 * a * a * (0.6 + 0.4 * a));
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = v;
    }
  }
  haloTexture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  haloTexture.needsUpdate = true;
  return haloTexture;
}

function takeHalo(): HaloClone {
  const parked = haloPool.pop();
  if (parked) return parked;
  const material = new THREE.SpriteMaterial({
    name: 'QuarryheartHalo',
    map: haloMap(),
    color: 0xffa040,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { gen: profileGeneration, material };
}

function park<T extends { gen: number }>(pool: T[], item: T, dispose: (item: T) => void): void {
  if (item.gen === profileGeneration && pool.length < POOL_CAP) pool.push(item);
  else dispose(item);
}

// ---------------------------------------------------------------------------
// the rig
// ---------------------------------------------------------------------------

/** One frame's facts for the rig. */
export interface QuarryheartFrame {
  dt: number;
  /** The renderer's scene clock (seconds). */
  time: number;
  moving: boolean;
  running: boolean;
  /** The entity's facing (yaw: forward is (sin, cos) in x/z). */
  facing: number;
  /** World height the mount stands on (its entity root). */
  groundY: number;
  reducedMotion: boolean;
  /** False for a far-LOD, offscreen or still-compiling body: the shaders keep time, nothing is
   *  emitted. */
  present: boolean;
  /** The particle cloud, or null when nothing should be emitted this frame. */
  vfx: QuarryheartParticleSink | null;
  /** When the current standing rear began (scene clock), or null when none is running. */
  rearStart: number | null;
  /** Seconds since this rider's last summon edge, or null when none was seen. */
  sinceSummon: number | null;
}

/** The character visual the rig's materials are adopted into (CharacterVisual.adoptMeshMaterial):
 *  an effect overlay or a material commit then restores the CHARGER's material, not the GLB's, and
 *  a mesh that must never cast leaves the visual's caster set (its shadow flag is the visual's to
 *  write). Null for a bare hierarchy (a test, a preview): the rig writes the mesh directly. */
export interface QuarryheartMaterialHost {
  adoptMeshMaterial(mesh: THREE.Mesh, material: THREE.Material, castsShadow: boolean): void;
}

interface SwappedMesh {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
}

const scratch = new THREE.Vector3();
const scratch2 = new THREE.Vector3();
const scaleScratch = new THREE.Vector3();
const color = new THREE.Color();

function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && o.name === name) found = o;
  });
  return found;
}

/** A point of the GLB's bind space, in a bone's own frame (so it rides the bone's animation). */
function bindToBone(
  skinned: THREE.SkinnedMesh | null,
  bone: THREE.Object3D,
  bind: readonly [number, number, number],
  dequant: THREE.Vector4,
): THREE.Vector3 {
  const p = new THREE.Vector3(bind[0], bind[1], bind[2]);
  if (!skinned) return p;
  const index = skinned.skeleton.bones.indexOf(bone as THREE.Bone);
  if (index < 0) return p;
  // bind space into the mesh's own (quantized) space, which the skeleton's inverses expect
  p.set(
    (p.x - dequant.x) / dequant.w,
    (p.y - dequant.y) / dequant.w,
    (p.z - dequant.z) / dequant.w,
  );
  p.applyMatrix4(skinned.bindMatrix);
  p.applyMatrix4(skinned.skeleton.boneInverses[index]);
  return p;
}

export class QuarryheartChargerFx {
  private readonly swapped: SwappedMesh[] = [];
  private readonly stones: StoneClone[] = [];
  private readonly winds: WindClone[] = [];
  private halo: HaloClone | null = null;
  private haloSprite: THREE.Sprite | null = null;
  private readonly hooves: THREE.Object3D[] = [];
  private readonly hoofStates: QuarryheartHoofState[] = [];
  private readonly mane: THREE.Object3D[] = [];
  private tail: THREE.Object3D | null = null;
  private horn: THREE.Object3D | null = null;
  private readonly hornTips: THREE.Vector3[] = [];
  private core: THREE.Object3D | null = null;
  private coreLocal = new THREE.Vector3();
  private arrivalAge: number | null;
  private decided = false;
  private burstPlayed = false;
  private lastRearStrike = Number.NEGATIVE_INFINITY;
  private readonly arrival: QuarryheartArrival = {
    assemble: 1,
    ignite: 1,
    wind: 1,
    flash: 0,
    done: true,
  };
  private readonly rates: QuarryheartRates = { sparks: 0, embers: 0, frost: 0, trail: 0 };
  private readonly motion: QuarryheartMotion = { float: 0, wave: 1, crackle: 1, flow: 1 };
  private readonly burst: QuarryheartBurstPolicy = { flash: true, spray: true };
  private disposed = false;

  /** `sinceSummon`: seconds since this rider's summon edge (null when none was seen), so a body
   *  that draws right after its summon plays the arrival and one first seen mounted does not. */
  static create(
    root: THREE.Object3D,
    sinceSummon: number | null,
    host: QuarryheartMaterialHost | null = null,
  ): QuarryheartChargerFx {
    return new QuarryheartChargerFx(root, sinceSummon, host);
  }

  private constructor(
    private readonly root: THREE.Object3D,
    sinceSummon: number | null,
    private readonly host: QuarryheartMaterialHost | null,
  ) {
    this.arrivalAge = quarryheartPlaysArrival(sinceSummon) ? 0 : null;
    if (this.arrivalAge === null) quarryheartWhole(this.arrival);
    let skinned: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const name = mesh.material.name;
      if (name === QUARRYHEART_STONE_MATERIAL) {
        const clone = takeStone(mesh.material);
        this.swapped.push({ mesh, original: mesh.material });
        this.stones.push(clone);
        this.adopt(mesh, clone.material, true);
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinned = mesh as THREE.SkinnedMesh;
      } else if (name === QUARRYHEART_WIND_MATERIAL) {
        const clone = takeWind(mesh.material);
        this.swapped.push({ mesh, original: mesh.material });
        this.winds.push(clone);
        // wind has no shadow (the depth pass would draw it as a solid sheet)
        mesh.userData.shadowCaster = false;
        mesh.receiveShadow = false;
        this.adopt(mesh, clone.material, false);
      }
    });
    const dequant = this.stones[0]?.uniforms.uQhDequant.value ?? new THREE.Vector4(0, 0, 0, 1);
    for (const name of QUARRYHEART_HOOF_BONES) {
      const bone = findBone(root, name);
      if (bone) {
        this.hooves.push(bone);
        this.hoofStates.push(createQuarryheartHoofState());
      }
    }
    for (const name of QUARRYHEART_MANE_BONES) {
      const bone = findBone(root, name);
      if (bone) this.mane.push(bone);
    }
    this.tail = findBone(root, QUARRYHEART_TAIL_BONE);
    this.horn = findBone(root, QUARRYHEART_HORN_BONE);
    if (this.horn) {
      for (const tip of HORN_TIPS_BIND)
        this.hornTips.push(bindToBone(skinned, this.horn, tip, dequant));
    }
    this.core = findBone(root, QUARRYHEART_CORE_BONE);
    if (this.core) {
      this.coreLocal.copy(bindToBone(skinned, this.core, QUARRYHEART_CORE_BIND, dequant));
      if (quarryheartKeepsHalo(GFX.effectsTier)) {
        this.halo = takeHalo();
        const sprite = new THREE.Sprite(this.halo.material);
        sprite.name = 'quarryheart-halo';
        sprite.position.copy(this.coreLocal);
        sprite.frustumCulled = false;
        // never a pick target (a recursive raycast without a camera would throw on a sprite)
        sprite.raycast = () => {};
        this.core.add(sprite);
        this.haloSprite = sprite;
      }
    }
    this.applyUniforms(0, false);
  }

  private adopt(mesh: THREE.Mesh, material: THREE.Material, castsShadow: boolean): void {
    if (this.host) this.host.adoptMeshMaterial(mesh, material, castsShadow);
    else {
      mesh.material = material;
      if (!castsShadow) mesh.castShadow = false;
    }
  }

  /** Every material the rig drew with, for a caller that gates a compile on them. */
  materials(): THREE.Material[] {
    const out: THREE.Material[] = [];
    for (const s of this.stones) out.push(s.material);
    for (const w of this.winds) out.push(w.material);
    if (this.halo) out.push(this.halo.material);
    return out;
  }

  private applyUniforms(time: number, reducedMotion: boolean): void {
    quarryheartMotion(reducedMotion, this.motion);
    const a = this.arrival;
    for (const s of this.stones) {
      const u = s.uniforms;
      u.uQhTime.value = time;
      u.uQhAssemble.value = a.assemble;
      u.uQhIgnite.value = a.ignite;
      u.uQhFloat.value = this.motion.float;
      u.uQhFlash.value = a.flash;
      u.uQhCalm.value = reducedMotion ? 1 : 0;
    }
    for (const w of this.winds) {
      const u = w.uniforms;
      u.uQhTime.value = time;
      u.uQhWave.value = this.motion.wave;
      u.uQhWind.value = a.wind;
      u.uQhCrackle.value = this.motion.crackle;
      u.uQhFlow.value = this.motion.flow;
    }
    if (this.halo && this.haloSprite) {
      const beat = quarryheartBeat(time, reducedMotion);
      const k = a.ignite * (0.55 + 0.45 * beat) + a.flash * 1.5;
      this.halo.material.opacity = Math.min(1, 0.5 * k);
      const size = 2.1 + 0.5 * beat * a.ignite + a.flash * 2.5;
      this.haloSprite.scale.set(size, size, 1);
      this.haloSprite.visible = k > 0.01;
    }
  }

  update(f: QuarryheartFrame): void {
    if (this.disposed) return;
    // The arrival is decided on the first frame the body is drawn, not when it is built: the
    // renderer can build a resident GLB the frame before it sees the summon edge, and the compile
    // gate can hold the body hidden for a while after. A summon edge still fresh by then plays it.
    if (!this.decided && f.present) {
      this.decided = true;
      if (quarryheartPlaysArrival(f.sinceSummon)) {
        this.arrivalAge = 0;
        this.burstPlayed = false;
      } else {
        this.arrivalAge = null;
        quarryheartWhole(this.arrival);
      }
    }
    if (this.arrivalAge !== null) {
      quarryheartArrival(this.arrivalAge, f.reducedMotion, this.arrival);
      if (f.present && f.vfx && !this.burstPlayed) {
        this.burstPlayed = true;
        this.playArrivalBurst(f.vfx, f.reducedMotion);
      }
      // the arrival runs only while the body is actually drawn, never behind the compile gate
      if (f.present) this.arrivalAge += f.dt;
      if (this.arrival.done) {
        this.arrivalAge = null;
        quarryheartWhole(this.arrival);
      }
    }
    this.applyUniforms(f.time, f.reducedMotion);
    if (!f.present || !f.vfx) return;
    const vfx = f.vfx;
    quarryheartRates(f.moving, f.running, f.reducedMotion, this.rates);
    const lit = this.arrival.ignite;
    this.emitSparks(vfx, f.dt, this.rates.sparks * this.arrival.wind);
    this.emitEmbers(vfx, f.dt, this.rates.embers * lit);
    this.emitFrost(vfx, f.dt, this.rates.frost * lit);
    if (this.rates.trail > 0) this.emitTrail(vfx, f, this.rates.trail * lit);
    this.strikeHooves(vfx, f);
    if (f.rearStart !== null && f.time >= f.rearStart + QUARRYHEART_REAR_STRIKE_SECONDS) {
      if (this.lastRearStrike !== f.rearStart) {
        this.lastRearStrike = f.rearStart;
        if (f.time < f.rearStart + QUARRYHEART_REAR_STRIKE_SECONDS + 0.25) {
          this.playRearStrike(vfx, f.reducedMotion);
        }
      }
    }
  }

  // -- particles ------------------------------------------------------------------------------

  private hdrColor(vfx: QuarryheartParticleSink, hex: number, k: number): THREE.Color {
    return color.setHex(hex).multiplyScalar(vfx.particleHdr(k));
  }

  private emit(
    vfx: QuarryheartParticleSink,
    p: THREE.Vector3,
    vx: number,
    vy: number,
    vz: number,
    hex: number,
    hdrK: number,
    size: number,
    life: number,
    gravity: number,
    sprite: VfxParticleSprite,
  ): void {
    vfx.emitParticle(
      p.x,
      p.y,
      p.z,
      vx,
      vy,
      vz,
      this.hdrColor(vfx, hex, hdrK),
      size,
      life,
      gravity,
      sprite,
    );
  }

  private emitSparks(vfx: QuarryheartParticleSink, dt: number, rate: number): void {
    if (rate <= 0 || this.mane.length === 0) return;
    const n = vfx.particleRate(rate, dt);
    for (let i = 0; i < n; i++) {
      const fromTail = this.tail !== null && Math.random() < 0.3;
      const bone = fromTail
        ? (this.tail as THREE.Object3D)
        : this.mane[(Math.random() * this.mane.length) | 0];
      bone.getWorldPosition(scratch);
      scratch.x += (Math.random() - 0.5) * 0.7;
      scratch.y += (fromTail ? -0.6 : 0.35) + Math.random() * 0.5;
      scratch.z += (Math.random() - 0.5) * 0.7;
      const a = Math.random() * Math.PI * 2;
      this.emit(
        vfx,
        scratch,
        Math.sin(a) * 1.6,
        0.6 + Math.random() * 1.4,
        Math.cos(a) * 1.6,
        Math.random() < 0.5 ? 0xcfefff : 0x7fd4ff,
        2.6,
        0.16 + Math.random() * 0.14,
        0.12 + Math.random() * 0.12,
        0,
        'sparkBurst',
      );
    }
  }

  private emitEmbers(vfx: QuarryheartParticleSink, dt: number, rate: number): void {
    if (rate <= 0 || !this.core) return;
    const n = vfx.particleRate(rate, dt);
    for (let i = 0; i < n; i++) {
      scratch.copy(this.coreLocal);
      this.core.localToWorld(scratch);
      scratch.x += (Math.random() - 0.5) * 1.3;
      scratch.y += (Math.random() - 0.3) * 0.9;
      scratch.z += (Math.random() - 0.5) * 2.2;
      this.emit(
        vfx,
        scratch,
        (Math.random() - 0.5) * 0.4,
        0.5 + Math.random() * 0.7,
        (Math.random() - 0.5) * 0.4,
        Math.random() < 0.6 ? 0xff9a30 : 0xffd070,
        2.2,
        0.1 + Math.random() * 0.09,
        0.9 + Math.random() * 0.8,
        -0.25,
        'sparkle',
      );
    }
  }

  private emitFrost(vfx: QuarryheartParticleSink, dt: number, rate: number): void {
    if (rate <= 0 || !this.horn || this.hornTips.length === 0) return;
    const n = vfx.particleRate(rate, dt);
    for (let i = 0; i < n; i++) {
      scratch.copy(this.hornTips[(Math.random() * this.hornTips.length) | 0]);
      // anywhere along the horn's outer half
      scratch.multiplyScalar(0.94 + Math.random() * 0.06);
      this.horn.localToWorld(scratch);
      this.emit(
        vfx,
        scratch,
        (Math.random() - 0.5) * 0.3,
        -0.15 - Math.random() * 0.3,
        (Math.random() - 0.5) * 0.3,
        Math.random() < 0.5 ? 0xbfe8ff : 0xffffff,
        1.8,
        0.08 + Math.random() * 0.07,
        0.9 + Math.random() * 0.6,
        0.35,
        'star',
      );
    }
  }

  private emitTrail(vfx: QuarryheartParticleSink, f: QuarryheartFrame, rate: number): void {
    const n = vfx.particleRate(rate, f.dt);
    if (n === 0) return;
    this.root.getWorldPosition(scratch2);
    const fx = Math.sin(f.facing);
    const fz = Math.cos(f.facing);
    const scale = this.root.getWorldScale(scaleScratch).y || 1;
    for (let i = 0; i < n; i++) {
      const back = (1.6 + Math.random() * 1.6) * scale;
      const side = (Math.random() - 0.5) * 1.2 * scale;
      scratch.set(
        scratch2.x - fx * back + fz * side,
        f.groundY + (0.6 + Math.random() * 2.6) * scale,
        scratch2.z - fz * back - fx * side,
      );
      const r = Math.random();
      if (r < 0.45) {
        // the wind tearing off the mane and tail: pale streaks left hanging behind
        this.emit(
          vfx,
          scratch,
          -fx * 1.5,
          0.2,
          -fz * 1.5,
          0x9fe6ff,
          1.5,
          0.5 + Math.random() * 0.4,
          0.32 + Math.random() * 0.2,
          0,
          Math.random() < 0.5 ? 'twirl' : 'magicWisp',
        );
      } else if (r < 0.8) {
        // embers shaken loose from the gaps, falling away
        this.emit(
          vfx,
          scratch,
          -fx * 0.6 + (Math.random() - 0.5),
          0.4 + Math.random() * 0.8,
          -fz * 0.6 + (Math.random() - 0.5),
          Math.random() < 0.5 ? 0xff7a1e : 0xffb040,
          2.2,
          0.12 + Math.random() * 0.1,
          0.5 + Math.random() * 0.4,
          3,
          'sparkle',
        );
      } else {
        // frost flecks off the horns
        this.emit(
          vfx,
          scratch,
          -fx * 0.4,
          0.1,
          -fz * 0.4,
          0xd6f3ff,
          1.8,
          0.09 + Math.random() * 0.06,
          0.6 + Math.random() * 0.4,
          0.6,
          'star',
        );
      }
    }
  }

  private strikeHooves(vfx: QuarryheartParticleSink, f: QuarryheartFrame): void {
    quarryheartBurstPolicy(f.reducedMotion, this.burst);
    if (!f.moving) {
      // standing: no prints, and no bone walk; re-seed so the first step after a halt never
      // strikes off a stale latch
      for (const s of this.hoofStates) s.seeded = false;
      return;
    }
    for (let i = 0; i < this.hooves.length; i++) {
      const hoof = this.hooves[i];
      hoof.getWorldPosition(scratch);
      const scale = hoof.getWorldScale(scaleScratch).y || 1;
      const strike = quarryheartHoofStrike(this.hoofStates[i], (scratch.y - f.groundY) / scale);
      if (!strike) continue;
      scratch.y = f.groundY + 0.06;
      if (quarryheartPrintKind(i) === 'ember') {
        // a print of embers, glowing where the hoof came down, sparks kicked off it
        this.emit(vfx, scratch, 0, 0.05, 0, 0xff6a14, 1.6, 0.95, 0.85, 0, 'glowSoft');
        const n = this.burst.spray ? vfx.particleBurst(f.running ? 6 : 3) : 0;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          this.emit(
            vfx,
            scratch,
            Math.sin(a) * 1.4,
            1.2 + Math.random() * 1.6,
            Math.cos(a) * 1.4,
            Math.random() < 0.5 ? 0xffc070 : 0xff7a1e,
            2.2,
            0.14 + Math.random() * 0.1,
            0.3 + Math.random() * 0.25,
            8,
            'sparkBurst',
          );
        }
      } else {
        // a print of frost, a cold bloom on the ground and ice flecks thrown up
        this.emit(vfx, scratch, 0, 0.04, 0, 0x7fd0ff, 1.5, 0.95, 0.9, 0, 'glowSoft');
        const n = this.burst.spray ? vfx.particleBurst(f.running ? 5 : 3) : 0;
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          this.emit(
            vfx,
            scratch,
            Math.sin(a) * 0.9,
            0.6 + Math.random() * 0.9,
            Math.cos(a) * 0.9,
            Math.random() < 0.5 ? 0xe6f8ff : 0xa8e2ff,
            1.9,
            0.1 + Math.random() * 0.07,
            0.45 + Math.random() * 0.3,
            2.5,
            'star',
          );
        }
      }
    }
  }

  private playArrivalBurst(vfx: QuarryheartParticleSink, reducedMotion: boolean): void {
    if (!this.core) return;
    scratch.copy(this.coreLocal);
    this.core.localToWorld(scratch);
    // the core igniting: a white-gold flash and a wide bloom
    quarryheartBurstPolicy(reducedMotion, this.burst);
    if (this.burst.flash) this.emit(vfx, scratch, 0, 0, 0, 0xfff0c8, 3, 4.2, 0.45, 0, 'flash');
    this.emit(vfx, scratch, 0, 0.2, 0, 0xffa040, 2.2, 7, 0.9, 0, 'glowSoft');
    if (reducedMotion) return;
    this.root.getWorldPosition(scratch2);
    const base = scratch2.y;
    // the four elements thrown off as the plates come home: quarry dust ringing the hooves,
    // fire climbing, frost shards bursting and the wind wheeling round the body
    let n = vfx.particleBurst(26);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      scratch.set(scratch2.x + Math.sin(a) * 1.2, base + 0.25, scratch2.z + Math.cos(a) * 1.2);
      this.emit(
        vfx,
        scratch,
        Math.sin(a) * 4.2,
        0.6 + Math.random() * 0.8,
        Math.cos(a) * 4.2,
        Math.random() < 0.5 ? 0xa89a86 : 0x7d7466,
        1,
        1 + Math.random() * 0.6,
        0.8 + Math.random() * 0.4,
        -0.3,
        'smoke',
      );
    }
    n = vfx.particleBurst(20);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      scratch.set(
        scratch2.x + Math.sin(a) * 0.7,
        base + 1.5 + Math.random() * 1.2,
        scratch2.z + Math.cos(a) * 0.7,
      );
      this.emit(
        vfx,
        scratch,
        Math.sin(a) * 0.8,
        2.4 + Math.random() * 2,
        Math.cos(a) * 0.8,
        Math.random() < 0.5 ? 0xff9a30 : 0xffc868,
        1.6,
        0.7 + Math.random() * 0.45,
        0.55 + Math.random() * 0.3,
        -0.6,
        'firePuff',
      );
    }
    n = vfx.particleBurst(18);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 2 - 0.4;
      scratch.set(scratch2.x, base + 2.4, scratch2.z);
      this.emit(
        vfx,
        scratch,
        Math.sin(a) * 5,
        up * 2.5,
        Math.cos(a) * 5,
        Math.random() < 0.5 ? 0xbfeaff : 0xffffff,
        2.2,
        0.22 + Math.random() * 0.14,
        0.55 + Math.random() * 0.3,
        4,
        'star',
      );
    }
    n = vfx.particleBurst(16);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      scratch.set(
        scratch2.x + Math.sin(a) * 2.2,
        base + 1 + (i % 4) * 0.7,
        scratch2.z + Math.cos(a) * 2.2,
      );
      this.emit(
        vfx,
        scratch,
        Math.cos(a) * 3.5,
        0.6,
        -Math.sin(a) * 3.5,
        0x9fe6ff,
        1.6,
        0.9,
        0.7,
        0,
        'twirl',
      );
    }
  }

  private playRearStrike(vfx: QuarryheartParticleSink, reducedMotion: boolean): void {
    if (this.hooves.length < 2) return;
    // between the forehooves, on the ground
    this.hooves[0].getWorldPosition(scratch);
    this.hooves[1].getWorldPosition(scratch2);
    scratch.add(scratch2).multiplyScalar(0.5);
    this.root.getWorldPosition(scratch2);
    scratch.y = scratch2.y + 0.1;
    quarryheartBurstPolicy(reducedMotion, this.burst);
    if (this.burst.flash) this.emit(vfx, scratch, 0, 0, 0, 0xffb060, 2.2, 5.5, 0.4, 0, 'ring');
    this.emit(vfx, scratch, 0, 0.1, 0, 0xff8030, 1.8, 4, 0.6, 0, 'glowSoft');
    if (reducedMotion) return;
    const n = vfx.particleBurst(30);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const fire = i % 3 === 0;
      const frost = i % 3 === 1;
      this.emit(
        vfx,
        scratch,
        Math.sin(a) * (4 + Math.random() * 2),
        1 + Math.random() * 2.2,
        Math.cos(a) * (4 + Math.random() * 2),
        fire ? 0xff7a1e : frost ? 0xbfeaff : 0x9a8c78,
        fire || frost ? 2.2 : 1,
        fire || frost ? 0.2 : 0.9,
        0.5 + Math.random() * 0.3,
        fire || frost ? 6 : -0.2,
        fire ? 'sparkBurst' : frost ? 'star' : 'smoke',
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { mesh, original } of this.swapped) {
      if (this.host && !Array.isArray(original)) {
        this.host.adoptMeshMaterial(mesh, original, mesh.userData.shadowCaster !== false);
      } else mesh.material = original;
    }
    this.swapped.length = 0;
    for (const s of this.stones) park(stonePool, s, (c) => c.material.dispose());
    for (const w of this.winds) park(windPool, w, (c) => c.material.dispose());
    this.stones.length = 0;
    this.winds.length = 0;
    if (this.haloSprite) {
      this.haloSprite.removeFromParent();
      this.haloSprite = null;
    }
    if (this.halo) {
      park(haloPool, this.halo, (c) => c.material.dispose());
      this.halo = null;
    }
  }
}
