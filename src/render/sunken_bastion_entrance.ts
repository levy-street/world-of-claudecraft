// The Drowned Gate Tower, the Sunken Bastion's world entrance (door (45, 515),
// Mirefen Marsh): the three Blender GLBs (the gatehouse, the ruins round it,
// the render-only growth) seated on the door's terrain height, plus its
// cosmetic layer, all on ONE clock, the Fogbeacon's turn
// (sunken_bastion_entrance_core.ts):
//   - the FLOODED PASSAGE behind the door: one flat window in the inner arch
//     whose shader traces a virtual barrel-vaulted passage standing in black
//     water, a second drowned portcullis down it and the beacon's green at
//     its far end, with the water reflecting it. This is the door's portal
//     look; the door body itself is only the invisible click box
//     (door_portal.ts doorArchAuthoredElsewhere), and it draws on every tier;
//   - the pulse light, the one point light (a fire-light sink source);
//   - the marsh fog, ONE instanced draw of soft noise-broken puffs pouring out
//     of the court, down the causeway and lying in the hollows;
//   - the gate sprites, ONE instanced additive draw: the rosette's pale core
//     and its shafts, the beacon's shaft through the portcullis bars, the beam
//     over the towers, the drips and their rings, the marsh lights, the glow
//     on the wet threshold.
// Pure placement and motion math lives in sunken_bastion_entrance_core.ts;
// what collides is src/sim/sunken_bastion_entrance.ts.
//
// Built once at boot as a static zone feature (static_world_features.ts), so it
// attaches through the renderer's gated attach (its programs link before its
// first visible frame), freezes its matrices and culls with the fog sweep.
// Everything moves on the shared uTime clock in its vertex or fragment shader;
// the only per-frame CPU is the fog's onBeforeRender: two uniform writes (the
// time of day and the reduced-motion switch) and the pulse light's base.
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { activeDungeonDoorPos, DUNGEONS } from '../sim/data';
import {
  SUNKEN_BASTION_ENTRANCE_COLLIDERS,
  SUNKEN_BASTION_ENTRANCE_DUNGEON_ID,
  sunkenBastionEntranceColliders,
} from '../sim/sunken_bastion_entrance';
import { terrainHeight } from '../sim/world';
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
  BASTION_BEACON,
  BASTION_DRIP_GRAVITY,
  BASTION_FOG_FIELDS,
  BASTION_FOG_NEAR,
  BASTION_PASSAGE,
  BASTION_PULSE_LIGHT,
  type BastionEffectsTier,
  type BastionFogPose,
  bastionFogPose,
  bastionFogPuff,
  bastionFogPuffCount,
  bastionGatePulse,
  bastionNightAmount,
  bastionOccluderSet,
  bastionPassageGhostFade,
  bastionPulseLightIntensity,
  bastionSprites,
} from './sunken_bastion_entrance_core';

const MAIN_URL = '/models/props/sunken_bastion_entrance.glb';
const RUINS_URL = '/models/props/sunken_bastion_entrance_ruins.glb';
const GROWTH_URL = '/models/props/sunken_bastion_entrance_growth.glb';
const URLS = [MAIN_URL, RUINS_URL, GROWTH_URL] as const;
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
export const sunkenBastionEntrancePreloadInternalsForTest = { urls: [...URLS] };

export const BASTION_PASSAGE_PROGRAM_CACHE_KEY = 'sunken-bastion-flooded-passage-v2';
export const BASTION_FOG_PROGRAM_CACHE_KEY = 'sunken-bastion-marsh-fog-v2';
export const BASTION_SPRITE_PROGRAM_CACHE_KEY = 'sunken-bastion-gate-sprites-v4';

export interface SunkenBastionEntranceView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  cullGroups: THREE.Group[];
}

/** x: the night amount (0 day, 1 night); y: motion (1, or 0 under reduced
 *  motion). One object shared by the three effect programs. uBastGhost is how
 *  much of the passage, and of the lights and drips that hang on the gatehouse,
 *  shows while the gatehouse is the camera's ghost (bastionPassageGhostFade). */
const bastionUniforms = {
  uBastion: { value: new THREE.Vector2(0, 1) },
  uBastGhost: { value: 1 },
};

const fx = (v: number) => v.toFixed(4);

// Mirrors bastionGatePulse (sunken_bastion_entrance_core.ts): spliced into all
// three effect programs, so the water, the shaft, the fog and the pool crest
// on the same frame.
const PULSE_GLSL = `
uniform float uTime;
uniform vec2 uBastion;
float bastPulse() {
  float tm = uTime * uBastion.y;
  float turn = fract(tm / ${fx(BASTION_BEACON.period)});
  float d = min(turn, 1.0 - turn) * 6.2831853;
  float sweep = exp(-d * d / ${fx(2 * BASTION_BEACON.gateWidth * BASTION_BEACON.gateWidth)});
  float rest = ${fx(BASTION_BEACON.rest)} + ${fx(BASTION_BEACON.breath)} * sin(tm * 0.7);
  float live = rest + (1.0 - rest) * sweep;
  return ${fx(BASTION_BEACON.still)} + (live - ${fx(BASTION_BEACON.still)}) * uBastion.y;
}`;

// ---- materials (module-lifetime, shared) ------------------------------------------

let glassMat: THREE.MeshBasicMaterial | null = null;

/** The lit slots go through surfaceMat every time (it caches per graphics
 *  tier, so a live profile switch gets the new tier's material); the star
 *  glass holds its own light on every tier. */
function kitMaterial(name: string): THREE.Material {
  if (name === 'KitGlow') {
    if (!glassMat) {
      const m = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.15, 1.3, 1.5),
        vertexColors: true,
      });
      m.name = 'SunkenBastionStarGlass';
      glassMat = markSharedMaterial(m);
    }
    return glassMat;
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

/** Pre-load and headless stand-in: the towers, the gate front and the door
 *  piers as plain blocks, so the colliders are never invisible walls if a GLB
 *  is missing. */
function fallbackGate(): THREE.Group {
  const root = new THREE.Group();
  const stone = surfaceMat({ color: 0x6f7880, roughness: 0.92 });
  const box = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
  for (const [x, y, z, w, h, d] of [
    [7.2, 3.5, -1.2, 5.6, 19, 5.6],
    [-7.2, 3, -1.2, 5.6, 10, 5.6],
    [3.4, 3, -3, 2.4, 12, 1.3],
    [-3.4, 3, -3, 2.4, 12, 1.3],
    [0, 7, -3, 4.4, 4, 1.3],
    [2.175, 2.4, 0, 1.85, 6.4, 1.1],
    [-2.175, 2.4, 0, 1.85, 6.4, 1.1],
  ] as const) {
    const mesh = new THREE.Mesh(box, stone);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    root.add(mesh);
  }
  return root;
}

// ---- the flooded passage behind the door -------------------------------------------

const ps = BASTION_PASSAGE;

// Mirrors bastionPassageTrace, bastionGrilleSolid and bastionPassageGlow.
const PASSAGE_COMMON = `
${PULSE_GLSL}
varying vec3 vBastP;
varying vec3 vBastC;
const float B_HW = ${fx(ps.half)};
const float B_Z0 = ${fx(ps.z)};
const float B_KERB = ${fx(ps.kerb)};
const float B_WATER = ${fx(ps.water)};
const float B_SPRING = ${fx(ps.spring)};
const float B_FAR = ${fx(ps.far)};
const float B_GRILLE = ${fx(ps.grille)};
const vec3 B_GREEN = vec3(0.12, 1.0, 0.4);
float bastHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bastNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bastHash(i), bastHash(i + vec2(1.0, 0.0)), f.x),
             mix(bastHash(i + vec2(0.0, 1.0)), bastHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
bool bastGrille(vec2 q) {
  float top = B_WATER + ${fx(ps.grilleRise)} + ${fx(ps.grilleTilt)} * q.x;
  if (q.y >= top) return false;
  bool bar = abs(fract(q.x / ${fx(ps.barPitch)} + 0.5) - 0.5) * ${fx(ps.barPitch)} < ${fx(ps.barHalf)};
  bool rail = abs(q.y - (top - 0.22)) < 0.08 || abs(q.y - (top - 1.05)) < 0.06;
  return bar || rail;
}
// kind: 1 water, 2 wall, 3 vault, 4 the far light, 5 the drowned grille
float bastTrace(vec3 o, vec3 d, float water, out float kind) {
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
    float t = (B_GRILLE - o.z) / d.z;
    if (t > 0.0 && t < best && bastGrille(o.xy + d.xy * t)) { best = t; kind = 5.0; }
  }
  return best;
}
// What a surface of the passage looks like: the day falling in at the door
// and dying a few yards down, the beacon's green rising from the far end.
vec3 bastShade(vec3 p, float kind, float pulse) {
  float night = uBastion.x;
  float into = max(0.0, p.z - B_Z0);
  float day = exp(-into * 0.95) * (1.0 - 0.9 * night);
  float dfar = B_FAR - p.z;
  float glow = pulse * 1.6 / (1.0 + 0.0045 * dfar * dfar);
  vec3 stone = vec3(0.07, 0.082, 0.08);
  if (kind > 4.5) {
    // the grille is a shape against the light, rimmed by it
    return vec3(0.003, 0.006, 0.005) + B_GREEN * glow * 0.035;
  }
  if (kind > 3.5) {
    float r = length(vec2(p.x * 0.85, p.y - 1.55));
    return B_GREEN * pulse * (2.4 * exp(-r * r * 0.5) + 0.25) + vec3(0.6, 1.0, 0.8) * pulse * pulse * 2.2 * exp(-r * r * 2.6);
  }
  if (kind > 2.5) {
    float rib = 1.0 - smoothstep(0.0, 0.12, abs(fract(p.z / 3.2) - 0.5) - 0.4);
    float wet = 0.75 + 0.25 * bastNoise(p.xz * vec2(3.0, 1.2));
    return stone * wet * (day * 0.7 + 0.008) * (1.0 - 0.45 * rib) + B_GREEN * glow * (0.12 + 0.2 * rib) * wet;
  }
  // a side wall: coursed, wet to the old tide line, a pale crust on it
  float row = floor(p.y / 0.46);
  float cy = fract(p.y / 0.46);
  float cz = fract(p.z / 0.98 + row * 0.37);
  float joint = 1.0 - min(smoothstep(0.0, 0.08, min(cy, 1.0 - cy)), smoothstep(0.0, 0.04, min(cz, 1.0 - cz)));
  float tone = 0.72 + 0.4 * bastHash(vec2(row, floor(p.z / 0.98 + row * 0.37)));
  float line = B_WATER + 1.2 + 0.12 * bastNoise(vec2(p.z * 0.7, 3.0));
  float under = 1.0 - smoothstep(line - 0.1, line + 0.15, p.y);
  float cband = (p.y - line + 0.15) * 4.5;
  float crust = exp(-cband * cband) * (0.4 + 0.6 * bastNoise(p.zy * 5.0));
  vec3 base = stone * tone * (1.0 - 0.55 * joint) * mix(1.0, 0.55, under);
  base = mix(base, vec3(0.13, 0.13, 0.11), crust * 0.45);
  // the wet stone shines where the light skims it
  float sheen = under * (0.35 + 0.65 * bastNoise(vec2(p.z * 2.3, p.y * 6.0))) * 0.5;
  return base * (day * 1.25 + 0.012) + B_GREEN * glow * (0.2 + sheen) * (1.0 - 0.4 * joint);
}
vec3 bastPassage(vec3 o, vec3 d) {
  float pulse = bastPulse();
  // the far light never goes out (bastionPassageLight)
  float lit = ${fx(ps.restGlow)} + ${fx(1 - ps.restGlow)} * pulse;
  float tm = uTime * uBastion.y;
  float night = uBastion.x;
  float kind;
  float t = bastTrace(o, d, 1.0, kind);
  float tt = min(t, 60.0);
  vec3 p = o + d * tt;
  vec3 col;
  if (kind < 1.5) {
    // black water: slow swell, the rings of three drips, and what it mirrors
    vec2 w = p.xz;
    vec2 g = vec2(
      0.06 * sin(w.x * 3.1 + tm * 0.9 + sin(w.y * 1.3)) + 0.034 * sin(w.x * 7.3 - w.y * 2.1 + tm * 1.3),
      0.06 * sin(w.y * 2.3 - tm * 0.7 + sin(w.x * 1.7)) + 0.034 * sin(w.y * 5.9 + w.x * 3.3 - tm * 1.1));
    float crest = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec2 c = vec2(0.55 - fi * 0.5, B_Z0 + 0.8 + fi * 1.5);
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
    float t2 = bastTrace(p, r, 0.0, k2);
    vec3 mirror = bastShade(p + r * min(t2, 60.0), k2, lit);
    float fres = 0.05 + 0.95 * pow(clamp(1.0 - dot(-d, n), 0.0, 1.0), 4.0);
    float into = max(0.0, p.z - B_Z0);
    float day = exp(-into * 0.95) * (1.0 - 0.9 * night);
    vec3 murk = vec3(0.004, 0.02, 0.015) * (0.3 + day * 2.2) + B_GREEN * lit * 0.014;
    // by day the water at the door mirrors the bright arch it lies under
    col = mix(murk, mirror + vec3(0.1, 0.13, 0.12) * day, fres);
    // the far light lies down the middle of the water in one soft streak...
    float lane = exp(-p.x * p.x * 2.6) * pow(max(dot(reflect(d, n), normalize(vec3(0.0, 1.6, B_FAR) - p)), 0.0), 10.0);
    col += B_GREEN * lit * lane * 0.4;
    // ...and every ring's crest catches it
    col += (B_GREEN * lit * 0.6 + vec3(0.14, 0.18, 0.17) * day) * crest;
    // the far light lying on the water as a broken path toward the eye
    vec2 g2 = g * 3.2 + 0.1 * vec2(bastNoise(w * 6.0 + tm * 0.3) - 0.5, bastNoise(w * 6.0 - tm * 0.25 + 7.0) - 0.5);
    vec3 n2 = normalize(vec3(g2.x, 1.0, g2.y));
    vec3 toLight = normalize(vec3(0.0, 1.6, B_FAR) - p);
    float spec = pow(max(dot(reflect(d, n2), toLight), 0.0), 60.0);
    col += (B_GREEN + vec3(0.3, 0.0, 0.25)) * lit * spec * 3.4;
  } else {
    col = bastShade(p, kind, lit);
  }
  // the fog standing in the passage takes the light along the whole ray
  float ahead = 0.3 + 0.7 * pow(max(d.z, 0.0), 3.0);
  col += B_GREEN * (0.05 + pulse * pulse) * (1.0 - exp(-tt * 0.032)) * 0.3 * ahead;
  return col;
}`;

// The screen-door every dithered ghost in the game drops fragments on, here
// on the passage's own fade: the material stays opaque (one program, no
// sorting) on every tier.
const PASSAGE_GHOST = ghostDitherDiscardGlsl('uBastGhost');

let passageMat: THREE.MeshBasicMaterial | null = null;

function passageMaterial(): THREE.MeshBasicMaterial {
  if (passageMat) return passageMat;
  // (the window's triangles face north: the BACK side is the road's side, so a
  // camera turned to look out from behind the door never sees a lit panel)
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uBastion = bastionUniforms.uBastion;
    shader.uniforms.uBastGhost = bastionUniforms.uBastGhost;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBastP;\nvarying vec3 vBastC;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvBastP = position;\nvBastC = cameraPosition - modelMatrix[3].xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uBastGhost;\n${PASSAGE_COMMON}`,
      )
      .replace(
        '#include <map_fragment>',
        `// the window goes with the gatehouse when that is the camera's ghost${PASSAGE_GHOST}
vec3 bEye = vBastC;
// the eye never stands under the sill (bastionPassageEye)
bEye.y = max(bEye.y, B_KERB + ${fx(ps.eye)});
diffuseColor.rgb = bastPassage(vBastP, normalize(vBastP - bEye));
{
  // the opening's own shadow: the dark meets the stone with no hard edge
  float ex = B_HW - abs(vBastP.x);
  float ea = vBastP.y > B_SPRING ? B_HW - length(vec2(vBastP.x, vBastP.y - B_SPRING)) : ex;
  diffuseColor.rgb *= smoothstep(-0.02, 0.34, min(ex, ea)) * smoothstep(-0.02, 0.2, vBastP.y - B_KERB);
}`,
      );
  };
  material.customProgramCacheKey = () => BASTION_PASSAGE_PROGRAM_CACHE_KEY;
  material.name = 'SunkenBastionFloodedPassage';
  passageMat = markSharedMaterial(material);
  return passageMat;
}

/** The window the passage is seen through: the inner arch's own opening (a
 *  little wider, into the masonry) in one flat piece, one draw. */
function passageWindow(): THREE.Mesh {
  const w = ps.half + ps.margin;
  const y0 = ps.kerb - 0.45;
  const positions: number[] = [-w, y0, ps.z, w, y0, ps.z, w, ps.spring, ps.z, -w, ps.spring, ps.z];
  const index: number[] = [0, 1, 2, 0, 2, 3];
  const steps = 12;
  positions.push(0, ps.spring, ps.z);
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * i) / steps;
    positions.push(Math.cos(a) * w, ps.spring + Math.sin(a) * w, ps.z);
  }
  for (let i = 0; i < steps; i++) index.push(4, 5 + i, 6 + i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, passageMaterial());
  mesh.name = 'sunkenBastionFloodedPassage';
  return mesh;
}

// ---- the marsh fog (one instanced draw) --------------------------------------------

let puffTex: THREE.CanvasTexture | null = null;
let fogMat: THREE.MeshBasicMaterial | null = null;

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

// The vertex stage mirrors bastionFogPose: the puff's centre drifts along its
// own lane and widens, rides the ground between its birth and its end (the
// knoll is steep), faces the camera and lies low and wide.
const FOG_VERTEX = `float bT = fract(aA.z + uTime * aA.w * uBastion.y);
vec3 bCenter = vec3(
  aA.x + aB.x * bT + sin(uTime * 0.21 * uBastion.y + aA.z * 6.2831853) * 0.35,
  mix(aC.x, aC.y, bT) + aB.w + 0.2 * bT,
  aA.y + aB.y * bT);
float bScale = aB.z * (0.7 + 1.0 * bT);
vec4 mvPosition = modelViewMatrix * vec4(bCenter, 1.0);
// a puff the camera stands in is stacked full-screen overdraw, not fog: it
// thins with view depth (bastionFogNearFade) and its quad collapses once it
// shows nothing
float bNear = smoothstep(${fx(BASTION_FOG_NEAR.start)}, ${fx(BASTION_FOG_NEAR.full)}, -mvPosition.z);
mvPosition.xy += position.xy * vec2(bScale, bScale * 0.46) * step(0.004, bNear);
vBastPuff = vec3(smoothstep(0.0, 0.16, bT) * (1.0 - smoothstep(0.55, 1.0, bT)) * bNear, aA.z, aC.z * bastPulse());
gl_Position = projectionMatrix * mvPosition;`;

const FOG_FRAGMENT = `#include <map_fragment>
#ifdef USE_MAP
vec2 bUv = vMapUv * vec2(1.5, 0.66) + vec2(vBastPuff.y * 7.0 + uTime * 0.016 * uBastion.y, vBastPuff.y * 3.0);
float bWisp = texture2D(uBastNoise, bUv).r;
float bHole = texture2D(uBastNoise, bUv * 2.3 + vec2(0.37, uTime * 0.011 * uBastion.y)).r;
diffuseColor.a *= smoothstep(0.04, 0.3, bWisp) * (0.45 + 1.4 * bHole);
#endif
diffuseColor.rgb = mix(vec3(0.5, 0.57, 0.54), vec3(0.16, 0.24, 0.24), uBastion.x) + vec3(0.08, 0.62, 0.27) * vBastPuff.z * vBastPuff.z * (0.55 + 0.45 * uBastion.x);
diffuseColor.a *= vBastPuff.x * (0.62 + 0.38 * uBastion.x) * (1.0 + 0.35 * vBastPuff.z);`;

function marshFogMaterial(): THREE.MeshBasicMaterial {
  if (fogMat) return fogMat;
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: puffTexture() ?? undefined,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uBastion = bastionUniforms.uBastion;
    shader.uniforms.uBastNoise = { value: mistNoiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute vec4 aA;\nattribute vec4 aB;\nattribute vec4 aC;\nvarying vec3 vBastPuff;\n${PULSE_GLSL}`,
      )
      .replace('#include <project_vertex>', FOG_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform vec2 uBastion;\nuniform sampler2D uBastNoise;\nvarying vec3 vBastPuff;',
      )
      .replace('#include <map_fragment>', FOG_FRAGMENT);
  };
  material.customProgramCacheKey = () => BASTION_FOG_PROGRAM_CACHE_KEY;
  material.name = 'SunkenBastionMarshFog';
  fogMat = markSharedMaterial(material);
  return fogMat;
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
  bastionUniforms.uBastion.value.y = reduced ? 0 : 1;
}

function marshFog(
  tier: BastionEffectsTier,
  ground: (lx: number, lz: number) => number,
  light: THREE.PointLight,
): THREE.InstancedMesh {
  const count = bastionFogPuffCount(tier);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 4);
  const c = new Float32Array(count * 4);
  const mesh = new THREE.InstancedMesh(geometry, marshFogMaterial(), count);
  // The shader ignores these matrices; they are seeded across each puff's own
  // drift so the fog sweep's footprint measurement at attach sees the spread.
  const m = new THREE.Matrix4();
  const pose: BastionFogPose = { x: 0, t: 0, z: 0, scale: 0, alpha: 0 };
  for (let i = 0; i < count; i++) {
    const p = bastionFogPuff(i, count);
    // Each puff rides the ground from its birth to the end of its drift.
    const g0 = ground(p.ox, p.oz);
    const g1 = ground(p.ox + p.dx, p.oz + p.dz);
    a.set([p.ox, p.oz, p.phase, p.speed], i * 4);
    b.set([p.dx, p.dz, p.size, p.y], i * 4);
    c.set([g0, g1, p.lit, 0], i * 4);
    bastionFogPose(p, (i / count) * 4, 0, pose);
    m.makeTranslation(pose.x, g0 + (g1 - g0) * pose.t + p.y, pose.z);
    mesh.setMatrixAt(i, m);
  }
  geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4));
  geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4));
  geometry.setAttribute('aC', new THREE.InstancedBufferAttribute(c, 4));
  // Every puff travels its whole lane in the shader, away from its seeded
  // matrix: frustum culling would drop puffs still on screen. The gatehouse's
  // cull group (the fog sweep) still sheds it with the rest of the set piece.
  mesh.frustumCulled = false;
  mesh.renderOrder = floorVfxRenderOrder('ground', 1);
  mesh.name = 'sunkenBastionMarshFog';
  mesh.onBeforeRender = () => {
    const u = bastionUniforms.uBastion.value;
    u.x = bastionNightAmount(currentDayNightPhase());
    const time = sharedUniforms.uTime.value;
    motionNow(time);
    // The fire-light budget flickers a source about its own base: the pulse
    // moves the base, the budget's shimmer rides on it like light off water.
    light.userData.baseIntensity = bastionPulseLightIntensity(bastionGatePulse(time, u.y));
  };
  return mesh;
}

// ---- the gate sprites (one instanced additive draw) --------------------------------

let spriteMat: THREE.MeshBasicMaterial | null = null;

// Mirrors bastionSpritePose and bastionBeaconDirection. Kinds: 0 rosette
// core, 1 rosette shaft, 2 gate shaft, 3 sky beam, 4 drip, 5 ring, 6 marsh
// light, 7 threshold pool, 8 mouth glow.
const SPRITE_VERTEX = `float bK = aK.z;
float bTm = uTime * uBastion.y;
float bN = uBastion.x;
float bPulse = bastPulse();
vec3 bC = aS.xyz;
vec2 bQ = position.xy;
float bA = 1.0;
vec4 mvPosition;
vBastU = vec2(bQ.x, bQ.y + 0.5);
if (bK > 0.5 && bK < 3.5) {
  // a shaft: a quad along its own axis, turned about it to face the eye
  vec3 dir = aD.xyz;
  if (bK > 2.5) {
    float bearing = mix(2.3, 6.2831853 * fract(bTm / ${fx(BASTION_BEACON.period)}), uBastion.y);
    dir = vec3(sin(bearing) * ${fx(Math.cos(BASTION_BEACON.pitch))}, ${fx(Math.sin(BASTION_BEACON.pitch))}, -cos(bearing) * ${fx(Math.cos(BASTION_BEACON.pitch))});
  }
  float u = bQ.y + 0.5;
  vec3 foot = (modelMatrix * vec4(bC, 1.0)).xyz;
  vec3 toEye = normalize(cameraPosition - (foot + dir * aK.w * 0.5));
  vec3 side = cross(dir, toEye);
  float sl = length(side);
  side = sl > 1.0e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  // the foot goes through modelViewMatrix and the offset turns as a direction:
  // the point viewMatrix * world names, with no world point built first
  mvPosition = modelViewMatrix * vec4(bC, 1.0);
  mvPosition.xyz += mat3(viewMatrix) * (dir * (aK.w * u) + side * (bQ.x * mix(aS.w, aD.w, u)));
  if (bK < 1.5) bA = bN * (0.7 + 0.3 * sin(bTm * 0.5 + aK.x * 6.2831853));
  else if (bK < 2.5) bA = bPulse * bPulse * bPulse * (0.55 + 0.45 * bN);
  else bA = 0.3 + 0.7 * bN;
  // seen end on a shaft has no side to show: it fades instead of folding;
  // and a shaft is for the eye outside it, so it stands down at its own foot
  bA *= smoothstep(0.06, 0.45, sl) * smoothstep(3.0, 11.0, distance(cameraPosition, foot));
} else if ((bK > 4.5 && bK < 5.5) || (bK > 6.5 && bK < 7.5)) {
  // a ring or the pool: it lies on the ground's own slope
  float sz = aS.w;
  if (bK < 5.5) {
    float cycle = fract(aK.x + bTm * aK.y) / aK.y;
    float age = cycle - sqrt(2.0 * max(0.05, aK.w) / ${fx(BASTION_DRIP_GRAVITY)});
    bA = age > 0.0 ? exp(-age * 1.6) * (1.0 - smoothstep(1.2, 2.2, age)) : 0.0;
    sz *= 0.2 + 0.8 * clamp(age / 1.7, 0.0, 1.0);
  } else {
    bA = bPulse * (0.5 + 0.5 * bN);
  }
  vec3 gx = normalize(vec3(1.0, aD.x, 0.0));
  vec3 gz = normalize(vec3(0.0, aD.z, 1.0));
  mvPosition = modelViewMatrix * vec4(bC + gx * (bQ.x * sz) + gz * (bQ.y * sz), 1.0);
} else {
  vec2 sz = vec2(aS.w);
  if (bK < 0.5) {
    bA = (0.14 + 0.2 * bN) * (0.86 + 0.14 * sin(bTm * 0.8 + aK.x * 6.2831853)) + 0.2 * bPulse * bPulse;
  } else if (bK < 4.5) {
    float cycle = fract(aK.x + bTm * aK.y) / aK.y;
    float fall = sqrt(2.0 * max(0.05, aK.w) / ${fx(BASTION_DRIP_GRAVITY)});
    float t = min(cycle, fall);
    bC.y -= ${fx(BASTION_DRIP_GRAVITY * 0.5)} * t * t;
    bA = cycle < fall ? 0.85 : 0.0;
    // a falling drop draws out as it gathers speed
    sz = vec2(aS.w * 0.55, aS.w * (1.3 + 5.0 * t));
  } else if (bK < 6.5) {
    float a = bTm * aK.y + aK.x * 6.2831853;
    bC.x += sin(a) * aK.w;
    bC.y += sin(a * 1.7 + aK.x * 9.0) * 0.35;
    bC.z += cos(a * 0.8 + aK.x * 4.0) * aK.w;
    bA = bN * (0.55 + 0.45 * sin(bTm * 0.6 + aK.x * 11.0));
  } else {
    bA = (aD.x + (1.0 - aD.x) * bPulse * bPulse) * mix(1.0, bN, aK.w);
  }
  mvPosition = modelViewMatrix * vec4(bC, 1.0);
  if (bK > 7.5) bA *= smoothstep(4.0, 15.0, -mvPosition.z);
  mvPosition.xy += bQ * sz;
}
// what hangs on the gatehouse (the rosette's light, the shafts in the arch,
// the drips off the spikes) goes with it when it is the camera's ghost
if (bK < 2.5 || (bK > 3.5 && bK < 4.5)) bA *= uBastGhost;
vBastQ = bQ;
vBastS = vec3(bK, bA, bTm);
gl_Position = projectionMatrix * mvPosition;`;

const SPRITE_FRAGMENT = `vec2 bQ = vBastQ;
float bKind = vBastS.x;
vec3 bCol;
float bAl;
float bR = clamp(1.0 - length(bQ) * 2.0, 0.0, 1.0);
if (bKind > 0.5 && bKind < 3.5) {
  float across = max(1.0 - 4.0 * vBastU.x * vBastU.x, 0.0);
  float v = vBastU.y;
  if (bKind < 1.5) {
    bCol = vec3(0.32, 0.58, 1.0) * 0.2;
    bAl = across * across * smoothstep(0.0, 0.1, v) * pow(max(1.0 - v, 0.0), 1.6);
  } else if (bKind < 2.5) {
    // the portcullis bars stand in the light: their shadows ride the shaft
    // a shaft in the haze: no edge, thick at its heart, uneven down its
    // length, gone well before its tip (the real bars in front of it cut it)
    float haze = 0.7 + 0.3 * sin(v * 9.0 + vBastS.z * 0.8 + vBastU.x * 3.0);
    bCol = vec3(0.2, 1.0, 0.5) * 0.7;
    bAl = across * across * across * haze * smoothstep(0.0, 0.2, v) * pow(max(1.0 - v, 0.0), 2.0);
  } else {
    // a lighthouse beam through marsh haze: no edge, thinning to nothing,
    // the dust in it drifting down its length
    float dust = 0.72 + 0.28 * sin(v * 34.0 - vBastS.z * 0.7 + vBastU.x * 5.0) * sin(v * 9.0 + vBastS.z * 0.23);
    bCol = vec3(0.16, 1.0, 0.5) * 0.42;
    bAl = across * across * across * dust * smoothstep(0.0, 0.1, v) * pow(max(1.0 - v, 0.0), 2.2);
  }
} else if (bKind < 0.5) {
  float heart = clamp(1.0 - length(bQ) * 6.0, 0.0, 1.0);
  bCol = vec3(0.36, 0.62, 1.0) * (0.4 + 1.0 * heart * heart);
  bAl = bR * bR;
} else if (bKind < 4.5) {
  bCol = vec3(0.6, 0.85, 0.8) * 0.6;
  bAl = clamp(1.0 - abs(bQ.x) * 2.0, 0.0, 1.0) * clamp(1.0 - abs(bQ.y) * 2.0, 0.0, 1.0);
} else if (bKind < 5.5) {
  float rr = length(bQ) * 2.0;
  bCol = vec3(0.42, 0.62, 0.56) * 0.2;
  float r1 = (rr - 0.82) * 11.0;
  float r2 = (rr - 0.45) * 13.0;
  bAl = exp(-r1 * r1) + 0.35 * exp(-r2 * r2);
} else if (bKind < 6.5) {
  float heart = clamp(1.0 - length(bQ) * 5.5, 0.0, 1.0);
  bCol = vec3(0.45, 1.0, 0.5) * (0.35 + 2.4 * heart * heart);
  bAl = bR * bR * bR;
} else if (bKind < 7.5) {
  bCol = vec3(0.12, 1.0, 0.4) * 0.5;
  bAl = bR * bR;
} else {
  // the light seen down its own length: a soft glow with no rays and no edge
  bCol = vec3(0.14, 1.0, 0.44) * 0.36;
  bAl = bR * bR * bR;
}
diffuseColor = vec4(bCol, bAl * vBastS.y);`;

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
    shader.uniforms.uBastion = bastionUniforms.uBastion;
    shader.uniforms.uBastGhost = bastionUniforms.uBastGhost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uBastGhost;\nattribute vec4 aS;\nattribute vec4 aK;\nattribute vec4 aD;\nvarying vec2 vBastQ;\nvarying vec3 vBastS;\nvarying vec2 vBastU;\n${PULSE_GLSL}`,
      )
      .replace('#include <project_vertex>', SPRITE_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vBastQ;\nvarying vec3 vBastS;\nvarying vec2 vBastU;',
      )
      .replace('#include <map_fragment>', SPRITE_FRAGMENT);
  };
  material.customProgramCacheKey = () => BASTION_SPRITE_PROGRAM_CACHE_KEY;
  material.name = 'SunkenBastionGateSprites';
  spriteMat = markSharedMaterial(material);
  return spriteMat;
}

function gateSprites(
  tier: BastionEffectsTier,
  ground: (lx: number, lz: number) => number,
): THREE.InstancedMesh {
  const sprites = bastionSprites(tier, ground);
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
  // Drops fall, lights wander and shafts reach away from their seeded matrices.
  mesh.frustumCulled = false;
  mesh.renderOrder = floorVfxRenderOrder('ground', 2);
  mesh.name = 'sunkenBastionGateSprites';
  return mesh;
}

/** Build the Drowned Gate Tower (world coordinates). */
export function buildSunkenBastionEntrance(seed: number): SunkenBastionEntranceView {
  const door = activeDungeonDoorPos(DUNGEONS[SUNKEN_BASTION_ENTRANCE_DUNGEON_ID]);
  const base = terrainHeight(door.x, door.z, seed);
  const ground = (lx: number, lz: number) => terrainHeight(door.x + lx, door.z + lz, seed) - base;
  const group = new THREE.Group();
  group.name = 'sunkenBastionEntrance';
  const gate = new THREE.Group();
  gate.name = 'sunkenBastionEntranceBody';
  gate.position.set(door.x, base, door.z);
  const main = sources.get(MAIN_URL);
  const gatehouse = main ? seat(main, true) : fallbackGate();
  gate.add(gatehouse);
  const ruinsSource = sources.get(RUINS_URL);
  const ruins = ruinsSource ? seat(ruinsSource, true) : null;
  if (ruins) gate.add(ruins);
  const growthSource = sources.get(GROWTH_URL);
  const growth = growthSource ? seat(growthSource, false) : null;
  if (growth) gate.add(growth);
  const passage = passageWindow();
  gate.add(passage);
  // Camera occlusion: every collider row is an occluder. The gatehouse and
  // the growth on it ghost together; the ruins round it on their own.
  const solids = { gate: [] as SetPieceSolid[], ruins: [] as SetPieceSolid[] };
  sunkenBastionEntranceColliders(seed, door).forEach((collider, i) => {
    // the set piece's rows are circles and boxes; a prism has no occluder box
    if (collider.type === 'prism') return;
    const { cameraTopY, ...shape } = collider;
    solids[bastionOccluderSet(SUNKEN_BASTION_ENTRANCE_COLLIDERS[i].name)].push({
      ...shape,
      topY: cameraTopY ?? base,
    });
  });
  // One entrance per world: a rebuild in the same page retires the last one's.
  for (const handle of occluderHandles) handle.dispose();
  bastionUniforms.uBastGhost.value = 1;
  occluderHandles = [
    registerSetPieceOccluders(solids.gate, growth ? [gatehouse, growth] : [gatehouse], {
      // the flooded passage is a shader window, not a model: it follows its wall
      onFade: (alpha) => {
        const shown = bastionPassageGhostFade(alpha);
        bastionUniforms.uBastGhost.value = shown;
        passage.visible = shown > 0;
      },
    }),
    registerSetPieceOccluders(solids.ruins, ruins ? [ruins] : []),
  ];
  // The player's static effects tier (the preset, lowered by the Advanced
  // Effects dial), never the frame governor: cosmetic richness only.
  const tier = resolveUiEffectsProfile({
    presetLabel: GFX.effectsTier,
    effectsQuality: GFX.effectsTier === 'low' ? 0 : 1,
    reduceMotion: false,
  }).tier;
  const light = new THREE.PointLight(
    BASTION_PULSE_LIGHT.color,
    bastionPulseLightIntensity(BASTION_BEACON.still),
    BASTION_PULSE_LIGHT.distance,
    2,
  );
  light.userData.baseIntensity = light.intensity;
  light.position.set(
    door.x + BASTION_PULSE_LIGHT.lx,
    base + BASTION_PULSE_LIGHT.y,
    door.z + BASTION_PULSE_LIGHT.lz,
  );
  gate.add(marshFog(tier, ground, light));
  gate.add(gateSprites(tier, ground));
  group.add(gate);
  group.add(light);
  return { group, glowLights: [light], cullGroups: [gate] };
}

/** The camera occluder sets of the entrance last built (gate, ruins). */
let occluderHandles: SetPieceOccluderHandle[] = [];

export const sunkenBastionEntranceInternalsForTest = {
  kitMaterial,
  passageMaterial,
  marshFogMaterial,
  spriteMaterial,
  passageCommon: PASSAGE_COMMON,
  pulseGlsl: PULSE_GLSL,
  fogVertex: FOG_VERTEX,
  fogFragment: FOG_FRAGMENT,
  spriteVertex: SPRITE_VERTEX,
  spriteFragment: SPRITE_FRAGMENT,
  passageGhost: PASSAGE_GHOST,
  occluderHandles: (): readonly SetPieceOccluderHandle[] => occluderHandles,
  fogFieldCount: BASTION_FOG_FIELDS.length,
  uniforms: bastionUniforms,
  resetCaches(): void {
    glassMat = passageMat = fogMat = spriteMat = null;
    puffTex = null;
    lastMotionCheck = -10;
    bastionUniforms.uBastGhost.value = 1;
  },
};
