// The Jaguar Maw, the Wildheart Basin's world entrance (door (-237, 1093), the
// Palmreach): the three Blender GLBs (the idol, the court before it, the
// render-only growth) seated on the door's terrain height, plus its cosmetic
// layer, all on ONE clock, the idol's breath
// (wildheart_basin_entrance_core.ts):
//   - the FLOODED THROAT behind the fangs: one flat window in the maw whose
//     shader traces a virtual rock-cut throat standing in its own black
//     water, a curtain of the fig's roots hanging in it and the basin's light
//     at its far end, with the water reflecting it. This is the door's portal
//     look; the door body itself is only the invisible click box
//     (door_portal.ts doorArchAuthoredElsewhere), and it draws on every tier;
//   - the point lights (fire-light sink sources): the jade in the maw, whose
//     base follows the breath, and the two fire bowls;
//   - the mist, ONE instanced draw of soft noise-broken puffs: the breath out
//     of the maw and down the causeway, and the banks lying on the lagoon;
//   - the sprites, ONE instanced additive draw: the jade in the eyes, the
//     flames that lick out of them on the breath, the fire bowls' flames, the
//     shafts out of the maw, the drips off the fangs and their rings, the
//     fireflies, the glow on the wet steps.
// Pure placement and motion math lives in wildheart_basin_entrance_core.ts;
// what collides is src/sim/wildheart_basin_entrance.ts.
//
// Built once at boot as a static zone feature (static_world_features.ts), so it
// attaches through the renderer's gated attach (its programs link before its
// first visible frame), freezes its matrices and culls with the fog sweep.
// Everything moves on the shared uTime clock in its vertex or fragment shader;
// the only per-frame CPU is the mist's onBeforeRender: two uniform writes (the
// time of day and the reduced-motion switch) and the maw light's base.
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { activeDungeonDoorPos, DUNGEONS } from '../sim/data';
import {
  WILDHEART_BASIN_ENTRANCE_COLLIDERS,
  WILDHEART_BASIN_ENTRANCE_DUNGEON_ID,
  wildheartBasinEntranceColliders,
} from '../sim/wildheart_basin_entrance';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { currentDayNightPhase } from './day_night_clock';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { GFX, sharedUniforms, surfaceMat } from './gfx';
import { mistNoiseTexture } from './ignivar_mist_gate';
import { ghostDitherDiscardGlsl } from './occluder_dither_fade';
import { registerSetPieceOccluders, type SetPieceOccluderHandle } from './set_piece_occluders';
import type { SetPieceSolid } from './set_piece_occluders_core';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import {
  WILDHEART_BRAZIER_LIGHT,
  WILDHEART_BRAZIERS,
  WILDHEART_BREATH,
  WILDHEART_DRIP_GRAVITY,
  WILDHEART_LEAN,
  WILDHEART_MAW_LIGHT,
  WILDHEART_MIST_FIELDS,
  WILDHEART_MIST_NEAR,
  WILDHEART_OVERHANG_SOLIDS,
  WILDHEART_THROAT,
  type WildheartEffectsTier,
  type WildheartMistPose,
  wildheartBreathPulse,
  wildheartMawLightIntensity,
  wildheartMistPose,
  wildheartMistPuff,
  wildheartMistPuffCount,
  wildheartNightAmount,
  wildheartOccluderSet,
  wildheartOccluderTop,
  wildheartSprites,
  wildheartThroatGhostFade,
} from './wildheart_basin_entrance_core';

const MAIN_URL = '/models/props/wildheart_basin_entrance.glb';
const COURT_URL = '/models/props/wildheart_basin_entrance_court.glb';
const GROWTH_URL = '/models/props/wildheart_basin_entrance_growth.glb';
const URLS = [MAIN_URL, COURT_URL, GROWTH_URL] as const;
const sources = new Map<string, THREE.Group>();
if (typeof window !== 'undefined') {
  for (const url of URLS) {
    registerDeferredPreload(() =>
      loadGltf(url).then((gltf) => {
        sources.set(url, gltf.scene);
      }),
    );
  }
}
export const wildheartBasinEntrancePreloadInternalsForTest = { urls: [...URLS] };

export const WILDHEART_THROAT_PROGRAM_CACHE_KEY = 'wildheart-basin-flooded-throat-v1';
export const WILDHEART_MIST_PROGRAM_CACHE_KEY = 'wildheart-basin-maw-mist-v1';
export const WILDHEART_SPRITE_PROGRAM_CACHE_KEY = 'wildheart-basin-maw-sprites-v3';

export interface WildheartBasinEntranceView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  cullGroups: THREE.Group[];
}

/** x: the night amount (0 day, 1 night); y: motion (1, or 0 under reduced
 *  motion). One object shared by the three effect programs. uWildGhost is how
 *  much of the throat, and of the lights, flames and drips that hang on the
 *  idol, shows while the idol is the camera's ghost (wildheartThroatGhostFade). */
const wildheartUniforms = {
  uWildheart: { value: new THREE.Vector2(0, 1) },
  uWildGhost: { value: 1 },
};

const fx = (v: number) => v.toFixed(4);

// Mirrors wildheartBreathPulse (wildheart_basin_entrance_core.ts): spliced into
// all three effect programs, so the water, the eyes, the mist and the fire
// bowls crest on the same frame.
const PULSE_GLSL = `
uniform float uTime;
uniform vec2 uWildheart;
float wildPulse() {
  float tm = uTime * uWildheart.y;
  float ph = fract(tm / ${fx(WILDHEART_BREATH.period)}) * ${fx(WILDHEART_BREATH.period)};
  float shape = ph < ${fx(WILDHEART_BREATH.crest)}
    ? smoothstep(${fx(WILDHEART_BREATH.crest - WILDHEART_BREATH.attack)}, ${fx(WILDHEART_BREATH.crest)}, ph)
    : exp(-(ph - ${fx(WILDHEART_BREATH.crest)}) / ${fx(WILDHEART_BREATH.decay)});
  float rest = ${fx(WILDHEART_BREATH.rest)} + ${fx(WILDHEART_BREATH.smoulder)} * sin(tm * 0.7);
  float live = rest + (1.0 - rest) * shape;
  return ${fx(WILDHEART_BREATH.still)} + (live - ${fx(WILDHEART_BREATH.still)}) * uWildheart.y;
}`;

// ---- materials (module-lifetime, shared) ------------------------------------------

let coalMat: THREE.MeshBasicMaterial | null = null;

/** The lit slots go through surfaceMat every time (it caches per graphics
 *  tier, so a live profile switch gets the new tier's material); the coals in
 *  the fire bowls hold their own light on every tier. */
function kitMaterial(name: string): THREE.Material {
  if (name === 'KitGlow') {
    if (!coalMat) {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.5, 1.25, 1.0),
        vertexColors: true,
      });
      m.name = 'WildheartBasinCoals';
      coalMat = markSharedMaterial(m);
    }
    return coalMat;
  }
  if (name === 'KitLeaf') {
    return surfaceMat({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
  }
  if (name === 'KitWet') {
    return surfaceMat({ vertexColors: true, roughness: 0.14 });
  }
  return surfaceMat({ vertexColors: true, roughness: 0.92 });
}

function seat(source: THREE.Group, castShadow: boolean): THREE.Group {
  const model = source.clone(true);
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    markSharedGeometry(node.geometry);
    const swap = (m: THREE.Material) => kitMaterial(m.name);
    node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
    node.castShadow = castShadow;
    node.receiveShadow = true;
  });
  return model;
}

/** Pre-load and headless stand-in: the head and the muzzle's two halves as
 *  plain blocks, so the colliders are never invisible walls if a GLB is
 *  missing. */
function fallbackIdol(): THREE.Group {
  const root = new THREE.Group();
  const stone = surfaceMat({ color: 0x8c8266, roughness: 0.92 });
  const box = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
  for (const [x, y, z, w, h, d] of [
    [0, 6, 8.8, 11.4, 15, 11.4],
    [3.7, 3.5, 0.6, 4.6, 9.5, 2.8],
    [-3.7, 3.5, 0.6, 4.6, 9.5, 2.8],
    [0, 7.2, 0.6, 2.8, 2.1, 2.8],
  ] as const) {
    const mesh = new THREE.Mesh(box, stone);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    root.add(mesh);
  }
  return root;
}

// ---- the flooded throat behind the fangs -------------------------------------------

const th = WILDHEART_THROAT;

// Mirrors wildheartThroatTrace, wildheartRootSolid and wildheartThroatGlow.
const THROAT_COMMON = `
${PULSE_GLSL}
varying vec3 vWildP;
varying vec3 vWildC;
const float B_HW = ${fx(th.half)};
const float B_Z0 = ${fx(th.z)};
const float B_KERB = ${fx(th.kerb)};
const float B_WATER = ${fx(th.water)};
const float B_SPRING = ${fx(th.spring)};
const float B_FAR = ${fx(th.far)};
const float B_ROOTS = ${fx(th.roots)};
const vec3 W_JADE = vec3(0.16, 1.0, 0.52);
const vec3 W_DAY = vec3(1.0, 0.92, 0.55);
float wildHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wildNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wildHash(i), wildHash(i + vec2(1.0, 0.0)), f.x),
             mix(wildHash(i + vec2(0.0, 1.0)), wildHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
bool wildRoots(vec2 q) {
  float i = floor(q.x / ${fx(th.rootPitch)} + 0.5);
  float h = fract(sin(i * 12.9898) * 43758.5453);
  float vault = B_SPRING + sqrt(max(B_HW * B_HW - q.x * q.x, 0.0));
  if (q.y < vault - (${fx(th.rootMin)} + ${fx(th.rootVar)} * h)) return false;
  float centre = (i + (h - 0.5) * 0.5) * ${fx(th.rootPitch)} + 0.06 * sin(q.y * 1.7 + i);
  return abs(q.x - centre) < ${fx(th.rootHalf)} * (0.6 + 0.8 * h);
}
// kind: 1 water, 2 wall, 3 vault, 4 the far light, 5 the hanging roots
float wildTrace(vec3 o, vec3 d, float water, out float kind) {
  float best = 1.0e5;
  kind = 4.0;
  if (d.z > 1.0e-4) best = (B_FAR - o.z) / d.z;
  if (abs(d.x) > 1.0e-4) {
    float t = ((d.x > 0.0 ? B_HW : -B_HW) - o.x) / d.x;
    if (t > 0.0 && t < best && o.y + d.y * t <= B_SPRING) { best = t; kind = 2.0; }
  }
  float a = d.x * d.x + d.y * d.y;
  if (a > 1.0e-6) {
    float b = o.x * d.x + (o.y - B_SPRING) * d.y;
    float c = o.x * o.x + (o.y - B_SPRING) * (o.y - B_SPRING) - B_HW * B_HW;
    float disc = b * b - a * c;
    if (disc > 0.0) {
      float t = (-b + sqrt(disc)) / a;
      if (t > 0.0 && t < best && o.y + d.y * t >= B_SPRING) { best = t; kind = 3.0; }
    }
  }
  if (water > 0.5 && d.y < -1.0e-4) {
    float t = (B_WATER - o.y) / d.y;
    if (t > 0.0 && t < best) { best = t; kind = 1.0; }
  }
  if (d.z > 1.0e-4) {
    float t = (B_ROOTS - o.z) / d.z;
    if (t > 0.0 && t < best && wildRoots(o.xy + d.xy * t)) { best = t; kind = 5.0; }
  }
  return best;
}
// What a surface of the throat looks like under the far light L: the day
// falling in at the maw and dying a few yards down, the basin's light and the
// breath's jade rising from the far end.
vec3 wildShade(vec3 p, float kind, vec3 L) {
  float night = uWildheart.x;
  float into = max(0.0, p.z - B_Z0);
  float day = exp(-into * 0.6) * (1.0 - 0.88 * night);
  float dfar = B_FAR - p.z;
  vec3 glow = L * (1.6 / (1.0 + 0.006 * dfar * dfar));
  if (kind > 4.5) {
    // a root is a shape against the light, rimmed by it
    return vec3(0.004, 0.007, 0.005) + glow * 0.03;
  }
  if (kind > 3.5) {
    float r = length(vec2(p.x * 0.7, p.y - 2.2));
    return L * (1.5 * exp(-r * r * 0.32) + 0.15);
  }
  // living rock, wet, mossed toward the water
  float n1 = wildNoise(vec2(p.z * 1.3 + p.x * 0.4, p.y * 1.6));
  float n2 = wildNoise(vec2(p.z * 4.1, p.y * 4.7 + p.x * 3.0));
  float rough = 0.55 + 0.45 * n1 + 0.25 * (n2 - 0.5);
  float moss = smoothstep(1.8, 0.0, p.y - B_WATER) * (0.4 + 0.6 * n1);
  vec3 base = mix(vec3(0.085, 0.09, 0.07), vec3(0.05, 0.11, 0.045), moss * 0.7) * rough;
  float rib = kind > 2.5 ? 1.0 - smoothstep(0.0, 0.14, abs(fract(p.z / 3.6) - 0.5) - 0.38) : 0.0;
  return base * (day * 1.3 + 0.012) * (1.0 - 0.4 * rib) + glow * (0.14 + 0.22 * (0.25 + 0.75 * n2)) * (1.0 - 0.3 * rib);
}
vec3 wildThroat(vec3 o, vec3 d) {
  float pulse = wildPulse();
  float tm = uTime * uWildheart.y;
  float night = uWildheart.x;
  // the basin's own light never goes out (wildheartThroatRest); the breath is jade
  vec3 L = W_DAY * mix(${fx(th.restDay)}, ${fx(th.restNight)}, night) + W_JADE * pulse * 1.25;
  float kind;
  float t = wildTrace(o, d, 1.0, kind);
  float tt = min(t, 60.0);
  vec3 p = o + d * tt;
  vec3 col;
  if (kind < 1.5) {
    // black water running out toward the maw: slow swell, the rings of three
    // drips, and what it mirrors
    vec2 w = p.xz;
    vec2 g = vec2(
      0.06 * sin(w.x * 3.1 + tm * 0.9 + sin(w.y * 1.3)) + 0.034 * sin(w.x * 7.3 - w.y * 2.1 + tm * 1.3),
      0.06 * sin(w.y * 2.3 + tm * 1.1 + sin(w.x * 1.7)) + 0.034 * sin(w.y * 5.9 + w.x * 3.3 + tm * 1.6));
    float crest = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 c = vec2(0.9 - fi * 0.8, B_Z0 + 0.9 + fi * 1.6);
      float period = 3.1 + fi * 1.3;
      float age = fract(tm / period + fi * 0.37) * period;
      vec2 dv = w - c;
      float r = length(dv) + 1.0e-4;
      float front = r - age * 0.85;
      float ring = sin(front * 15.0) * exp(-abs(front) * 3.2) * exp(-age * 0.8);
      g += dv / r * ring * 0.34;
      crest += max(ring, 0.0);
    }
    vec3 n = normalize(vec3(g.x, 1.0, g.y));
    vec3 r = reflect(d, n);
    r.y = abs(r.y) + 0.02;
    r = normalize(r);
    float k2;
    float t2 = wildTrace(p, r, 0.0, k2);
    vec3 mirror = wildShade(p + r * min(t2, 60.0), k2, L);
    float fres = 0.05 + 0.95 * pow(clamp(1.0 - dot(-d, n), 0.0, 1.0), 4.0);
    float into = max(0.0, p.z - B_Z0);
    float day = exp(-into * 0.6) * (1.0 - 0.88 * night);
    vec3 murk = vec3(0.006, 0.026, 0.016) * (0.3 + day * 2.2) + L * 0.012;
    // by day the water at the maw mirrors the bright mouth it lies under
    col = mix(murk, mirror + vec3(0.12, 0.14, 0.1) * day, fres);
    // the far light lies down the middle of the water in one soft streak...
    vec3 toLight = normalize(vec3(0.0, 2.2, B_FAR) - p);
    float lane = exp(-p.x * p.x * 1.1) * pow(max(dot(reflect(d, n), toLight), 0.0), 10.0);
    col += L * lane * 0.4;
    // ...and every ring's crest catches it
    col += (L * 0.6 + vec3(0.16, 0.18, 0.14) * day) * crest;
    // the far light lying on the water as a broken path toward the eye
    vec2 g2 = g * 3.2 + 0.1 * vec2(wildNoise(w * 6.0 + tm * 0.3) - 0.5, wildNoise(w * 6.0 - tm * 0.25 + 7.0) - 0.5);
    vec3 n2 = normalize(vec3(g2.x, 1.0, g2.y));
    float spec = pow(max(dot(reflect(d, n2), toLight), 0.0), 60.0);
    col += (L + vec3(0.25, 0.1, 0.2)) * spec * 3.0;
  } else {
    col = wildShade(p, kind, L);
  }
  // the haze standing in the throat takes the light along the whole ray, and
  // the breath fills it with jade
  float ahead = 0.3 + 0.7 * pow(max(d.z, 0.0), 3.0);
  col += (L * 0.05 + W_JADE * pulse * pulse) * (1.0 - exp(-tt * 0.032)) * 0.3 * ahead;
  return col;
}`;

// The screen-door every dithered ghost in the game drops fragments on, here
// on the throat's own fade: the material stays opaque (one program, no
// sorting) on every tier.
const THROAT_GHOST = ghostDitherDiscardGlsl('uWildGhost');

let throatMat: THREE.MeshBasicMaterial | null = null;

function throatMaterial(): THREE.MeshBasicMaterial {
  if (throatMat) return throatMat;
  // (the window's triangles face north: the BACK side is the causeway's side, so a
  // camera turned to look out from behind the maw never sees a lit panel)
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWildheart = wildheartUniforms.uWildheart;
    shader.uniforms.uWildGhost = wildheartUniforms.uWildGhost;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWildP;\nvarying vec3 vWildC;')
      .replace(
        '#include <begin_vertex>',
        // the window leans with the idol: the eye is brought into its own frame
        '#include <begin_vertex>\nvWildP = position;\nvWildC = (cameraPosition - modelMatrix[3].xyz) * mat3(modelMatrix);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uWildGhost;\n${THROAT_COMMON}`,
      )
      .replace(
        '#include <map_fragment>',
        `// the window goes with the idol when that is the camera's ghost${THROAT_GHOST}
vec3 wEye = vWildC;
// the eye never stands under the last step (wildheartThroatEye)
wEye.y = max(wEye.y, B_KERB + ${fx(th.eye)});
diffuseColor.rgb = wildThroat(vWildP, normalize(vWildP - wEye));
{
  // the opening's own shadow: the dark meets the stone with no hard edge
  float ex = B_HW - abs(vWildP.x);
  float ea = vWildP.y > B_SPRING ? B_HW - length(vec2(vWildP.x, vWildP.y - B_SPRING)) : ex;
  diffuseColor.rgb *= smoothstep(-0.02, 0.4, min(ex, ea)) * smoothstep(-0.02, 0.22, vWildP.y - B_KERB);
}`,
      );
  };
  material.customProgramCacheKey = () => WILDHEART_THROAT_PROGRAM_CACHE_KEY;
  material.name = 'WildheartBasinFloodedThroat';
  throatMat = markSharedMaterial(material);
  return throatMat;
}

/** The window the throat is seen through: the maw's own opening (a little
 *  wider, into the masonry) in one flat piece, one draw. */
function throatWindow(): THREE.Mesh {
  const w = th.half + th.margin;
  const y0 = th.kerb - 0.6;
  const positions: number[] = [-w, y0, th.z, w, y0, th.z, w, th.spring, th.z, -w, th.spring, th.z];
  const index: number[] = [0, 1, 2, 0, 2, 3];
  const steps = 12;
  positions.push(0, th.spring, th.z);
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * i) / steps;
    positions.push(Math.cos(a) * w, th.spring + Math.sin(a) * w, th.z);
  }
  for (let i = 0; i < steps; i++) index.push(4, 5 + i, 6 + i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, throatMaterial());
  mesh.name = 'wildheartBasinFloodedThroat';
  return mesh;
}

// ---- the mist (one instanced draw) -------------------------------------------------

let puffTex: THREE.CanvasTexture | null = null;
let mistMat: THREE.MeshBasicMaterial | null = null;

function puffTexture(): THREE.CanvasTexture | null {
  if (puffTex) return puffTex;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(canvas);
  return puffTex;
}

// The vertex stage mirrors wildheartMistPose: the puff's centre drifts along
// its own lane and widens, rides the ground (or the lagoon) between its birth
// and its end, faces the camera and lies low and wide.
const MIST_VERTEX = `float wT = fract(aA.z + uTime * aA.w * uWildheart.y);
vec3 wCenter = vec3(
  aA.x + aB.x * wT + sin(uTime * 0.21 * uWildheart.y + aA.z * 6.2831853) * 0.35,
  mix(aC.x, aC.y, wT) + aB.w + 0.2 * wT,
  aA.y + aB.y * wT);
float wScale = aB.z * (0.7 + 1.0 * wT);
vec4 mvPosition = modelViewMatrix * vec4(wCenter, 1.0);
// a puff the camera stands in is stacked full-screen overdraw, not mist: it
// thins with view depth (wildheartMistNearFade) and its quad collapses once it
// shows nothing
float wNear = smoothstep(${fx(WILDHEART_MIST_NEAR.start)}, ${fx(WILDHEART_MIST_NEAR.full)}, -mvPosition.z);
mvPosition.xy += position.xy * vec2(wScale, wScale * 0.46) * step(0.004, wNear);
vWildPuff = vec3(smoothstep(0.0, 0.16, wT) * (1.0 - smoothstep(0.55, 1.0, wT)) * wNear, aA.z, aC.z * wildPulse());
gl_Position = projectionMatrix * mvPosition;`;

const MIST_FRAGMENT = `#include <map_fragment>
#ifdef USE_MAP
vec2 wUv = vMapUv * vec2(1.5, 0.66) + vec2(vWildPuff.y * 7.0 + uTime * 0.016 * uWildheart.y, vWildPuff.y * 3.0);
float wWisp = texture2D(uWildNoise, wUv).r;
float wHole = texture2D(uWildNoise, wUv * 2.3 + vec2(0.37, uTime * 0.011 * uWildheart.y)).r;
diffuseColor.a *= smoothstep(0.04, 0.3, wWisp) * (0.45 + 1.4 * wHole);
#endif
diffuseColor.rgb = mix(vec3(0.66, 0.72, 0.62), vec3(0.16, 0.25, 0.22), uWildheart.x) + vec3(0.1, 0.68, 0.34) * vWildPuff.z * vWildPuff.z * (0.6 + 0.4 * uWildheart.x);
diffuseColor.a *= vWildPuff.x * (0.5 + 0.5 * uWildheart.x) * (1.0 + 0.6 * vWildPuff.z);`;

function mistMaterial(): THREE.MeshBasicMaterial {
  if (mistMat) return mistMat;
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: puffTexture() ?? undefined,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWildheart = wildheartUniforms.uWildheart;
    shader.uniforms.uWildNoise = { value: mistNoiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute vec4 aA;\nattribute vec4 aB;\nattribute vec4 aC;\nvarying vec3 vWildPuff;\n${PULSE_GLSL}`,
      )
      .replace('#include <project_vertex>', MIST_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform vec2 uWildheart;\nuniform sampler2D uWildNoise;\nvarying vec3 vWildPuff;',
      )
      .replace('#include <map_fragment>', MIST_FRAGMENT);
  };
  material.customProgramCacheKey = () => WILDHEART_MIST_PROGRAM_CACHE_KEY;
  material.name = 'WildheartBasinMawMist';
  mistMat = markSharedMaterial(material);
  return mistMat;
}

let motionMql: MediaQueryList | null | undefined;
let lastMotionCheck = -10;

/** Reduced motion, the game's own two sources: the OS query and the in-game
 *  switch's body class (main.ts keeps it). Read at most once a second. */
function motionNow(time: number): void {
  if (time - lastMotionCheck < 1 && time >= lastMotionCheck) return;
  lastMotionCheck = time;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (motionMql === undefined) {
    motionMql = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  const reduced =
    (motionMql?.matches ?? false) || document.body.classList.contains('reduce-motion');
  wildheartUniforms.uWildheart.value.y = reduced ? 0 : 1;
}

function mawMist(
  tier: WildheartEffectsTier,
  ground: (lx: number, lz: number) => number,
  light: THREE.PointLight,
): THREE.InstancedMesh {
  const count = wildheartMistPuffCount(tier);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 4);
  const c = new Float32Array(count * 4);
  const mesh = new THREE.InstancedMesh(geometry, mistMaterial(), count);
  // The shader ignores these matrices; they are seeded across each puff's own
  // drift so the fog sweep's footprint measurement at attach sees the spread.
  const m = new THREE.Matrix4();
  const pose: WildheartMistPose = { x: 0, t: 0, z: 0, scale: 0, alpha: 0 };
  for (let i = 0; i < count; i++) {
    const p = wildheartMistPuff(i, count);
    // Each puff rides the ground from its birth to the end of its drift.
    const g0 = ground(p.ox, p.oz);
    const g1 = ground(p.ox + p.dx, p.oz + p.dz);
    a.set([p.ox, p.oz, p.phase, p.speed], i * 4);
    b.set([p.dx, p.dz, p.size, p.y], i * 4);
    c.set([g0, g1, p.lit, 0], i * 4);
    wildheartMistPose(p, (i / count) * 4, 0, pose);
    m.makeTranslation(pose.x, g0 + (g1 - g0) * pose.t + p.y, pose.z);
    mesh.setMatrixAt(i, m);
  }
  geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4));
  geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4));
  geometry.setAttribute('aC', new THREE.InstancedBufferAttribute(c, 4));
  // Every puff travels its whole lane in the shader, away from its seeded
  // matrix: frustum culling would drop puffs still on screen. The idol's cull
  // group (the fog sweep) still sheds it with the rest of the set piece.
  mesh.frustumCulled = false;
  mesh.renderOrder = floorVfxRenderOrder('ground', 1);
  mesh.name = 'wildheartBasinMawMist';
  mesh.onBeforeRender = () => {
    const u = wildheartUniforms.uWildheart.value;
    u.x = wildheartNightAmount(currentDayNightPhase());
    const time = sharedUniforms.uTime.value;
    motionNow(time);
    // The fire-light budget flickers a source about its own base: the breath
    // moves the base, the budget's shimmer rides on it.
    light.userData.baseIntensity = wildheartMawLightIntensity(wildheartBreathPulse(time, u.y));
  };
  return mesh;
}

// ---- the sprites (one instanced additive draw) -------------------------------------

let spriteMat: THREE.MeshBasicMaterial | null = null;

// Mirrors wildheartSpritePose. Kinds: 0 eye glow, 1 eye shaft, 2 maw shaft,
// 3 flame, 4 drip, 5 ring, 6 firefly, 7 pool, 8 glow.
const SPRITE_VERTEX = `float wK = aK.z;
float wTm = uTime * uWildheart.y;
float wN = uWildheart.x;
float wPulse = wildPulse();
vec3 wC = aS.xyz;
vec2 wQ = position.xy;
float wA = 1.0;
vec4 mvPosition;
vWildU = vec3(wQ.x, wQ.y + 0.5, 0.0);
if (wK > 0.5 && wK < 2.5) {
  // a shaft: a quad along its own axis, turned about it to face the eye
  vec3 dir = aD.xyz;
  float u = wQ.y + 0.5;
  vec3 foot = (modelMatrix * vec4(wC, 1.0)).xyz;
  vec3 toEye = normalize(cameraPosition - (foot + dir * aK.w * 0.5));
  vec3 side = cross(dir, toEye);
  float sl = length(side);
  side = sl > 1.0e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  // the foot goes through modelViewMatrix and the offset turns as a direction:
  // the point viewMatrix * world names, with no world point built first
  mvPosition = modelViewMatrix * vec4(wC, 1.0);
  mvPosition.xyz += mat3(viewMatrix) * (dir * (aK.w * u) + side * (wQ.x * mix(aS.w, aD.w, u)));
  if (wK < 1.5) wA = wPulse * wPulse * (0.35 + 0.65 * wN);
  else wA = wPulse * wPulse * wPulse * (0.55 + 0.45 * wN);
  // seen end on a shaft has no side to show: it fades instead of folding;
  // and a shaft is for the eye outside it, so it stands down at its own foot
  wA *= smoothstep(0.06, 0.45, sl) * smoothstep(3.0, 11.0, distance(cameraPosition, foot));
} else if (wK > 2.5 && wK < 3.5) {
  // a flame: an upright quad standing on its own base, licking
  float power = aD.x + (1.0 - aD.x) * wPulse * wPulse;
  float lick = sin(wTm * (5.0 + aK.x * 3.0) + aK.x * 40.0);
  float h = aK.w * (0.82 + 0.18 * lick) * (0.4 + 0.6 * power);
  float v = wQ.y + 0.5;
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  mvPosition = modelViewMatrix * vec4(wC, 1.0);
  mvPosition.xyz += upV * (v * h);
  mvPosition.x += (wQ.x + 0.22 * sin(wTm * 3.1 + v * 4.0 + aK.x * 9.0) * v * v) * aS.w;
  // a fire bowl always burns; the fire in an eye is only an ember between breaths
  wA = aD.y > 0.5 ? power : 0.35 + 0.65 * power;
  // fire in a bowl turns jade on the breath; the fire in an eye is always jade
  vWildU.z = mix(wPulse * wPulse, 1.0, aD.w);
} else if ((wK > 4.5 && wK < 5.5) || (wK > 6.5 && wK < 7.5)) {
  // a ring or the pool: it lies on the ground's own slope
  float sz = aS.w;
  if (wK < 5.5) {
    float cycle = fract(aK.x + wTm * aK.y) / aK.y;
    float age = cycle - sqrt(2.0 * max(0.05, aK.w) / ${fx(WILDHEART_DRIP_GRAVITY)});
    wA = age > 0.0 ? exp(-age * 1.6) * (1.0 - smoothstep(1.2, 2.2, age)) : 0.0;
    sz *= 0.2 + 0.8 * clamp(age / 1.7, 0.0, 1.0);
  } else {
    wA = wPulse * (0.5 + 0.5 * wN);
  }
  vec3 gx = normalize(vec3(1.0, aD.x, 0.0));
  vec3 gz = normalize(vec3(0.0, aD.z, 1.0));
  mvPosition = modelViewMatrix * vec4(wC + gx * (wQ.x * sz) + gz * (wQ.y * sz), 1.0);
} else {
  vec2 sz = vec2(aS.w);
  if (wK < 0.5) {
    wA = (0.1 + 0.16 * wN) * (0.86 + 0.14 * sin(wTm * 0.8 + aK.x * 6.2831853)) + 0.9 * wPulse * wPulse;
  } else if (wK < 4.5) {
    float cycle = fract(aK.x + wTm * aK.y) / aK.y;
    float fall = sqrt(2.0 * max(0.05, aK.w) / ${fx(WILDHEART_DRIP_GRAVITY)});
    float t = min(cycle, fall);
    wC.y -= ${fx(WILDHEART_DRIP_GRAVITY * 0.5)} * t * t;
    wA = cycle < fall ? 0.85 : 0.0;
    // a falling drop draws out as it gathers speed
    sz = vec2(aS.w * 0.55, aS.w * (1.3 + 5.0 * t));
  } else if (wK < 6.5) {
    float a = wTm * aK.y + aK.x * 6.2831853;
    wC.x += sin(a) * aK.w;
    wC.y += sin(a * 1.7 + aK.x * 9.0) * 0.35;
    wC.z += cos(a * 0.8 + aK.x * 4.0) * aK.w;
    wA = wN * (0.55 + 0.45 * sin(wTm * 2.3 + aK.x * 11.0));
  } else {
    wA = (aD.x + (1.0 - aD.x) * wPulse * wPulse) * mix(1.0, wN, aK.w);
  }
  mvPosition = modelViewMatrix * vec4(wC, 1.0);
  if (wK > 7.5) wA *= smoothstep(4.0, 15.0, -mvPosition.z);
  mvPosition.xy += wQ * sz;
}
// what hangs on the idol (the eyes' light and fire, the shafts out of the
// maw, the drips off the fangs) goes with it when it is the camera's ghost
if (wK < 2.5 || (wK > 3.5 && wK < 4.5) || (wK > 2.5 && wK < 3.5 && aD.y > 0.5)) wA *= uWildGhost;
vWildQ = wQ;
vWildS = vec3(wK, wA, wTm);
gl_Position = projectionMatrix * mvPosition;`;

const SPRITE_FRAGMENT = `vec2 wQ = vWildQ;
float wKind = vWildS.x;
vec3 wCol;
float wAl;
float wR = clamp(1.0 - length(wQ) * 2.0, 0.0, 1.0);
if (wKind > 0.5 && wKind < 2.5) {
  // a shaft in the haze: no edge, thick at its heart, uneven down its length
  float across = max(1.0 - 4.0 * vWildU.x * vWildU.x, 0.0);
  float v = vWildU.y;
  float haze = 0.7 + 0.3 * sin(v * 9.0 + vWildS.z * 0.8 + vWildU.x * 3.0);
  wCol = vec3(0.2, 1.0, 0.55) * (wKind < 1.5 ? 0.16 : 0.7);
  wAl = across * across * across * haze * smoothstep(0.0, 0.2, v) * pow(max(1.0 - v, 0.0), 2.0);
} else if (wKind > 2.5 && wKind < 3.5) {
  // a tongue of flame: wide at the foot, drawn to a point, its edge alive
  float v = vWildU.y;
  float x = vWildU.x * 2.0;
  float width = pow(max(1.0 - v, 0.0), 0.75) * (0.45 + 0.55 * sin(min(v * 2.6, 1.5708)));
  float flick = 0.5 + 0.5 * sin(v * 11.0 - vWildS.z * 7.0 + x * 3.0);
  float body = smoothstep(width, width * 0.05, abs(x) + 0.16 * flick * v);
  float heart = body * (1.0 - v);
  vec3 fire = mix(vec3(1.0, 0.3, 0.04), vec3(1.0, 0.72, 0.22), heart * heart);
  vec3 jade = mix(vec3(0.06, 0.85, 0.4), vec3(0.7, 1.0, 0.82), heart);
  wCol = mix(fire, jade, vWildU.z);
  wAl = body * body * smoothstep(0.0, 0.12, v) * (1.0 - 0.75 * v) * 0.7;
} else if (wKind < 0.5) {
  float heart = clamp(1.0 - length(wQ) * 5.0, 0.0, 1.0);
  wCol = vec3(0.2, 1.0, 0.55) * (0.35 + 0.9 * heart * heart);
  wAl = wR * wR;
} else if (wKind < 4.5) {
  wCol = vec3(0.7, 0.9, 0.8) * 0.6;
  wAl = clamp(1.0 - abs(wQ.x) * 2.0, 0.0, 1.0) * clamp(1.0 - abs(wQ.y) * 2.0, 0.0, 1.0);
} else if (wKind < 5.5) {
  float rr = length(wQ) * 2.0;
  wCol = vec3(0.5, 0.7, 0.58) * 0.22;
  float r1 = (rr - 0.82) * 11.0;
  float r2 = (rr - 0.45) * 13.0;
  wAl = exp(-r1 * r1) + 0.35 * exp(-r2 * r2);
} else if (wKind < 6.5) {
  float heart = clamp(1.0 - length(wQ) * 5.5, 0.0, 1.0);
  wCol = vec3(0.8, 1.0, 0.3) * (0.35 + 2.4 * heart * heart);
  wAl = wR * wR * wR;
} else if (wKind < 7.5) {
  wCol = vec3(0.14, 1.0, 0.48) * 0.5;
  wAl = wR * wR;
} else {
  // the breath's light seen down its own length: a soft glow with no edge
  wCol = vec3(0.16, 1.0, 0.5) * 0.36;
  wAl = wR * wR * wR;
}
diffuseColor = vec4(wCol, wAl * vWildS.y);`;

function spriteMaterial(): THREE.MeshBasicMaterial {
  if (spriteMat) return spriteMat;
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    // additive light may only fade toward black: no fog-coloured glow
    fog: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWildheart = wildheartUniforms.uWildheart;
    shader.uniforms.uWildGhost = wildheartUniforms.uWildGhost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uWildGhost;\nattribute vec4 aS;\nattribute vec4 aK;\nattribute vec4 aD;\nvarying vec2 vWildQ;\nvarying vec3 vWildS;\nvarying vec3 vWildU;\n${PULSE_GLSL}`,
      )
      .replace('#include <project_vertex>', SPRITE_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vWildQ;\nvarying vec3 vWildS;\nvarying vec3 vWildU;',
      )
      .replace('#include <map_fragment>', SPRITE_FRAGMENT);
  };
  material.customProgramCacheKey = () => WILDHEART_SPRITE_PROGRAM_CACHE_KEY;
  material.name = 'WildheartBasinMawSprites';
  spriteMat = markSharedMaterial(material);
  return spriteMat;
}

function mawSprites(
  tier: WildheartEffectsTier,
  ground: (lx: number, lz: number) => number,
): THREE.InstancedMesh {
  const sprites = wildheartSprites(tier, ground);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const s = new Float32Array(sprites.length * 4);
  const k = new Float32Array(sprites.length * 4);
  const d = new Float32Array(sprites.length * 4);
  const mesh = new THREE.InstancedMesh(geometry, spriteMaterial(), sprites.length);
  const m = new THREE.Matrix4();
  sprites.forEach((sp, i) => {
    s.set([sp.x, sp.y, sp.z, sp.size], i * 4);
    k.set([sp.phase, sp.speed, sp.kind, sp.range], i * 4);
    d.set([sp.dx, sp.dy, sp.dz, sp.spread], i * 4);
    m.makeTranslation(sp.x, sp.y, sp.z);
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
  geometry.setAttribute('aK', new THREE.InstancedBufferAttribute(k, 4));
  geometry.setAttribute('aD', new THREE.InstancedBufferAttribute(d, 4));
  // Drops fall, fireflies wander and shafts reach away from their seeded matrices.
  mesh.frustumCulled = false;
  mesh.renderOrder = floorVfxRenderOrder('ground', 2);
  mesh.name = 'wildheartBasinMawSprites';
  return mesh;
}

/** Build the Jaguar Maw (world coordinates). */
export function buildWildheartBasinEntrance(seed: number): WildheartBasinEntranceView {
  const door = activeDungeonDoorPos(DUNGEONS[WILDHEART_BASIN_ENTRANCE_DUNGEON_ID]);
  const base = terrainHeight(door.x, door.z, seed);
  const ground = (lx: number, lz: number) => terrainHeight(door.x + lx, door.z + lz, seed) - base;
  // the mist lies, and the fireflies fly, on the lagoon where the ground is under it
  const surface = (lx: number, lz: number) => Math.max(ground(lx, lz), WATER_LEVEL - base);
  const group = new THREE.Group();
  group.name = 'wildheartBasinEntrance';
  const maw = new THREE.Group();
  maw.name = 'wildheartBasinEntranceBody';
  maw.position.set(door.x, base, door.z);
  const main = sources.get(MAIN_URL);
  const idol = main ? seat(main, true) : fallbackIdol();
  maw.add(idol);
  const courtSource = sources.get(COURT_URL);
  const court = courtSource ? seat(courtSource, true) : null;
  if (court) maw.add(court);
  const growthSource = sources.get(GROWTH_URL);
  const growth = growthSource ? seat(growthSource, false) : null;
  if (growth) maw.add(growth);
  // the throat's window leans with the idol, about the door
  const lean = new THREE.Group();
  lean.name = 'wildheartBasinEntranceLean';
  lean.rotation.set(-WILDHEART_LEAN.pitch, 0, -WILDHEART_LEAN.roll, 'ZXY');
  const throat = throatWindow();
  lean.add(throat);
  maw.add(lean);
  // Camera occlusion: every collider row is an occluder. The idol and the
  // growth on it ghost together; the court before it on its own.
  const solids = { idol: [] as SetPieceSolid[], court: [] as SetPieceSolid[] };
  wildheartBasinEntranceColliders(seed, door).forEach((collider, i) => {
    // the set piece's rows are circles and boxes; a prism has no occluder box
    if (collider.type === 'prism') return;
    const { cameraTopY, ...shape } = collider;
    const row = WILDHEART_BASIN_ENTRANCE_COLLIDERS[i].name;
    solids[wildheartOccluderSet(row)].push({
      ...shape,
      // the head's box reaches its ears (the collider's own top is under them)
      topY: base + wildheartOccluderTop(row, (cameraTopY ?? base) - base),
    });
  });
  // the stone over head height that no row stands under ghosts with the idol
  for (const o of WILDHEART_OVERHANG_SOLIDS) {
    solids.idol.push({
      type: 'obb',
      x: door.x + o.lx,
      z: door.z + o.lz,
      hw: o.hw,
      hd: o.hd,
      rot: 0,
      topY: base + o.topY,
      baseY: base + o.baseY,
    });
  }
  // One entrance per world: a rebuild in the same page retires the last one's.
  for (const handle of occluderHandles) handle.dispose();
  wildheartUniforms.uWildGhost.value = 1;
  occluderHandles = [
    registerSetPieceOccluders(solids.idol, growth ? [idol, growth] : [idol], {
      // the flooded throat is a shader window, not a model: it follows its wall
      onFade: (alpha) => {
        const shown = wildheartThroatGhostFade(alpha);
        wildheartUniforms.uWildGhost.value = shown;
        throat.visible = shown > 0;
      },
    }),
    registerSetPieceOccluders(solids.court, court ? [court] : []),
  ];
  // The player's static effects tier (the preset, lowered by the Advanced
  // Effects dial), never the frame governor: cosmetic richness only.
  const tier = resolveUiEffectsProfile({
    presetLabel: GFX.effectsTier,
    effectsQuality: GFX.effectsTier === 'low' ? 0 : 1,
    reduceMotion: false,
  }).tier;
  // The jade in the maw (its base follows the breath) and the two fire bowls.
  const lights = [
    {
      color: WILDHEART_MAW_LIGHT.color,
      intensity: wildheartMawLightIntensity(WILDHEART_BREATH.still),
      distance: WILDHEART_MAW_LIGHT.distance,
      at: [WILDHEART_MAW_LIGHT.lx, WILDHEART_MAW_LIGHT.y, WILDHEART_MAW_LIGHT.lz],
    },
    ...WILDHEART_BRAZIERS.map(([x, y, z]) => ({
      color: WILDHEART_BRAZIER_LIGHT.color,
      intensity: WILDHEART_BRAZIER_LIGHT.intensity,
      distance: WILDHEART_BRAZIER_LIGHT.distance,
      at: [x, y + WILDHEART_BRAZIER_LIGHT.rise, z],
    })),
  ].map((spec) => {
    const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance, 2);
    light.userData.baseIntensity = light.intensity;
    light.position.set(door.x + spec.at[0], base + spec.at[1], door.z + spec.at[2]);
    return light;
  });
  maw.add(mawMist(tier, surface, lights[0]));
  maw.add(mawSprites(tier, surface));
  group.add(maw);
  for (const light of lights) group.add(light);
  return { group, glowLights: lights, cullGroups: [maw] };
}

/** The camera occluder sets of the entrance last built (idol, court). */
let occluderHandles: SetPieceOccluderHandle[] = [];

export const wildheartBasinEntranceInternalsForTest = {
  kitMaterial,
  throatMaterial,
  mistMaterial,
  spriteMaterial,
  throatCommon: THROAT_COMMON,
  pulseGlsl: PULSE_GLSL,
  mistVertex: MIST_VERTEX,
  mistFragment: MIST_FRAGMENT,
  spriteVertex: SPRITE_VERTEX,
  spriteFragment: SPRITE_FRAGMENT,
  throatGhost: THROAT_GHOST,
  occluderHandles: (): readonly SetPieceOccluderHandle[] => occluderHandles,
  mistFieldCount: WILDHEART_MIST_FIELDS.length,
  uniforms: wildheartUniforms,
  resetCaches(): void {
    coalMat = throatMat = mistMat = spriteMat = null;
    puffTex = null;
    lastMotionCheck = -10;
    wildheartUniforms.uWildGhost.value = 1;
  },
};
