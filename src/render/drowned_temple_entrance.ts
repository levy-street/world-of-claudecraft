// The Moon Stair, the Drowned Temple's world entrance (door (-70, 792),
// Thornpeak Heights): the three Blender GLBs (the gate and the stair, the weir
// and the pool, the render-only growth) seated on the door's terrain height,
// plus its cosmetic layer, all on ONE clock, the moonrise
// (drowned_temple_entrance_core.ts):
//   - the LIQUID MOONLIGHT, one mesh with three faces: the moon pool's water,
//     which shows a full moon hanging deep under its surface at any hour (the
//     moon's plane is traced per pixel, so it slides behind the kerb like a
//     thing with depth); the gate's film, layers of cold light turning at
//     their own depths behind the ring with the moon deep among them, which is
//     the door's portal look (the door body itself is only the invisible click
//     box, door_portal.ts doorArchAuthoredElsewhere) and draws on every tier;
//     and the mirror, the still water the weir holds at the stair's foot,
//     which reflects the sky and the gate that stands over it;
//   - the silver inlays' own material: every live inlay carries its place in
//     the moonrise in its colour alpha and lights when the light reaches it;
//   - the gate light, the one point light (a fire-light sink source);
//   - the mist, ONE instanced draw of soft noise-broken puffs lying on the
//     mirror, in the pit beyond the weir and on the pool;
//   - the sprites, ONE instanced additive draw: the halo on every live inlay,
//     the flare and the shaft at the crown, the motes, the glints on the wet
//     treads, the threads of water at the weir's notches.
// Pure placement and motion math lives in drowned_temple_entrance_core.ts;
// what collides is src/sim/drowned_temple_entrance.ts.
//
// Built once at boot as a static zone feature (static_world_features.ts), so it
// attaches through the renderer's gated attach (its programs link before its
// first visible frame), freezes its matrices and culls with the fog sweep.
// Everything moves on the shared uTime clock in its vertex or fragment shader;
// the only per-frame CPU is the mist's onBeforeRender: two uniform writes (the
// time of day, the reduced-motion switch) and the light's base. The camera's
// ghost is not per frame: each fading unit's onFade writes its component of
// uTempleGhost on the frames its fade changes (set_piece_occluders.ts).
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { activeDungeonDoorPos, DUNGEONS } from '../sim/data';
import {
  DROWNED_TEMPLE_ENTRANCE_COLLIDERS,
  DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID,
  drownedTempleEntranceColliders,
} from '../sim/drowned_temple_entrance';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { currentDayNightPhase } from './day_night_clock';
import {
  TEMPLE_DRIPS,
  TEMPLE_FILM_LAYERS,
  TEMPLE_FILM_LOOK,
  TEMPLE_FILM_MOON,
  TEMPLE_FILM_OCCLUDER,
  TEMPLE_GATE,
  TEMPLE_GATE_LIGHT,
  TEMPLE_GHOST_SETS,
  TEMPLE_MIST_FIELDS,
  TEMPLE_MOONRISE,
  TEMPLE_POOL,
  TEMPLE_POOL_MOON,
  TEMPLE_WATER_KIND,
  type TempleEffectsTier,
  type TempleGhostSet,
  type TempleMistPose,
  type TempleMoonrise,
  templeFilmLight,
  templeGateLightIntensity,
  templeGhostShown,
  templeMirrorGrid,
  templeMistPose,
  templeMistPuff,
  templeMistPuffCount,
  templeMistSurface,
  templeMoonrise,
  templeNightAmount,
  templeOccluderSet,
  templeSprites,
} from './drowned_temple_entrance_core';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { GFX, sharedUniforms, surfaceMat } from './gfx';
import { mistNoiseTexture } from './ignivar_mist_gate';
import { registerSetPieceOccluders, type SetPieceOccluderHandle } from './set_piece_occluders';
import type { SetPieceSolid } from './set_piece_occluders_core';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const MAIN_URL = '/models/props/drowned_temple_entrance.glb';
const WORKS_URL = '/models/props/drowned_temple_entrance_works.glb';
const GROWTH_URL = '/models/props/drowned_temple_entrance_growth.glb';
const URLS = [MAIN_URL, WORKS_URL, GROWTH_URL] as const;
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
export const drownedTempleEntrancePreloadInternalsForTest = { urls: [...URLS] };

export const TEMPLE_MOONWATER_PROGRAM_CACHE_KEY = 'drowned-temple-moonwater-v2';
export const TEMPLE_INLAY_PROGRAM_CACHE_KEY = 'drowned-temple-silver-inlay-v1';
export const TEMPLE_MIST_PROGRAM_CACHE_KEY = 'drowned-temple-mere-mist-v1';
export const TEMPLE_SPRITE_PROGRAM_CACHE_KEY = 'drowned-temple-moonrise-sprites-v3';

export interface DrownedTempleEntranceView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  cullGroups: THREE.Group[];
}

/** uTemple x: the night amount (0 day, 1 night); y: motion (1, or 0 under
 *  reduced motion). uTempleGhost: how much of what hangs on each fading unit
 *  shows (x the gate, y and z the east and west flanks, w the works; 1 while
 *  the unit is solid, 0 while it is the camera's ghost: templeGhostShown),
 *  written by the units' own onFade. uTemple is shared by every effect
 *  program; uTempleGhost by the two that draw what hangs on a unit (the
 *  moonwater's film and the sprites). No sprite hangs on a flank today, so
 *  the y and z components are written and not yet read. */
const templeUniforms = {
  uTemple: { value: new THREE.Vector2(0, 1) },
  uTempleGhost: { value: new THREE.Vector4(1, 1, 1, 1) },
};

const fx = (v: number) => v.toFixed(4);
const mr = TEMPLE_MOONRISE;

// Mirrors templeMoonrise and templeRuneGlow (drowned_temple_entrance_core.ts):
// spliced into every effect program, so the inlays, the film, the pool, the
// mist and the sprites keep the same instant.
const RISE_GLSL = `
uniform float uTime;
uniform vec2 uTemple;
vec3 templeRise() {
  float u = fract(uTime * uTemple.y / ${fx(mr.period)});
  float climb = clamp((u - ${fx(mr.climbStart)}) / ${fx(mr.climbEnd - mr.climbStart)}, 0.0, 1.0);
  float front = -0.06 + 1.14 * climb;
  float glow = u < ${fx(mr.climbStart)} ? 0.0 : 1.0 - smoothstep(${fx(mr.crestEnd)}, ${fx(mr.fadeEnd)}, u);
  float crest = smoothstep(${fx(mr.climbEnd - 0.04)}, ${fx(mr.climbEnd + 0.03)}, u) * (1.0 - smoothstep(${fx(mr.crestEnd)}, ${fx(mr.fadeEnd)}, u));
  return vec3(mix(1.08, front, uTemple.y), mix(${fx(mr.stillGlow)}, glow, uTemple.y), mix(${fx(mr.stillCrest)}, crest, uTemple.y));
}
float templeRune(float order, vec3 rise) {
  float lit = smoothstep(order - 0.035, order + 0.015, rise.x);
  float d = (rise.x - order) / 0.05;
  float flash = rise.x < 1.07 ? exp(-d * d) : 0.0;
  return ${fx(mr.ember)} + ${fx(1 - mr.ember)} * lit * rise.y + 0.7 * flash * rise.y;
}`;

// ---- materials (module-lifetime, shared) ------------------------------------------

/**
 * The inlay's material keeps its moonrise through a clone. Material.clone()
 * copies every declared property and DROPS onBeforeCompile and the program
 * key, and the camera occluder registry clones every material under a fading
 * unit (set_piece_occluders.ts: the family fades per structure): a bare clone
 * drew the gate's, the flanks' and the works' inlays as plain vertex colour,
 * at one brightness all through the moonrise, with only the treads' (no unit)
 * alive. Copying the two hooks as own properties also lets the dithered ghost
 * (occluder_dither_fade.ts) chain onto them and onto this key.
 */
class TempleInlayMaterial extends THREE.MeshBasicMaterial {
  override copy(source: THREE.MeshBasicMaterial): this {
    super.copy(source);
    this.onBeforeCompile = source.onBeforeCompile;
    if (Object.hasOwn(source, 'customProgramCacheKey')) {
      this.customProgramCacheKey = source.customProgramCacheKey;
    }
    return this;
  }
}

let inlayMat: THREE.MeshBasicMaterial | null = null;

/** The silver inlays: unlit, their light the moonrise's. A glowing face's
 *  colour ALPHA is its place in the moonrise (the Blender build writes it). */
function inlayMaterial(): THREE.MeshBasicMaterial {
  if (inlayMat) return inlayMat;
  const material = new TempleInlayMaterial({ color: 0xffffff, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uTemple = templeUniforms.uTemple;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${RISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `float tOrder = 1.0;
#if defined( USE_COLOR_ALPHA )
  tOrder = vColor.a;
  diffuseColor.rgb *= vColor.rgb;
#elif defined( USE_COLOR )
  diffuseColor.rgb *= vColor;
#endif
float tGlow = templeRune(tOrder, templeRise());
diffuseColor.rgb = (diffuseColor.rgb * 0.5 + vec3(0.36, 0.5, 0.66)) * (0.16 + 1.7 * tGlow);
// the colour alpha was the inlay's order, never its opacity: the ghost's fade still applies
diffuseColor.a = opacity;`,
      );
  };
  material.customProgramCacheKey = () => TEMPLE_INLAY_PROGRAM_CACHE_KEY;
  material.name = 'DrownedTempleSilverInlay';
  inlayMat = markSharedMaterial(material);
  return inlayMat;
}

/** The lit slots go through surfaceMat every time (it caches per graphics
 *  tier, so a live profile switch gets the new tier's material). */
function kitMaterial(name: string): THREE.Material {
  if (name === 'KitGlow') return inlayMaterial();
  if (name === 'KitLeaf') {
    return surfaceMat({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
  }
  if (name === 'KitWet') {
    return surfaceMat({ vertexColors: true, roughness: 0.12 });
  }
  return surfaceMat({ vertexColors: true, roughness: 0.9 });
}

function seat(source: THREE.Group, castShadow: boolean): THREE.Group {
  const model = source.clone(true);
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    markSharedGeometry(node.geometry);
    const swap = (m: THREE.Material) => kitMaterial(m.name);
    node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
    node.castShadow = castShadow && node.material !== inlayMat;
    node.receiveShadow = true;
  });
  return model;
}

/** Pre-load and headless stand-in: the ring's two feet, its crown, the dais,
 *  the flight (one slab on its slope), its cheeks and the penitents as plain
 *  blocks, so neither the colliders nor the walk surface is ever invisible if
 *  a GLB is missing. */
function fallbackGate(): THREE.Group {
  const root = new THREE.Group();
  const stone = surfaceMat({ color: 0xb9b6ad, roughness: 0.9 });
  const box = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
  const g = TEMPLE_GATE;
  for (const [x, y, z, w, h, d] of [
    [3.75, g.centre, 0, 1.4, g.outer * 2, 1.6],
    [-3.75, g.centre, 0, 1.4, g.outer * 2, 1.6],
    [0, g.centre + g.outer - 0.6, 0, 9, 1.3, 1.6],
    [3.4, -2, -6.7, 0.8, 5, 8.3],
    [-3.4, -2, -6.7, 0.8, 5, 8.3],
    [6.7, -3.4, -15.7, 2, 5.4, 2],
    [-6.7, -3.4, -15.7, 2, 5.4, 2],
  ] as const) {
    const mesh = new THREE.Mesh(box, stone);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    root.add(mesh);
  }
  const dais = new THREE.Mesh(box, stone);
  dais.position.set(0, g.dais - 1.5, -0.1);
  dais.scale.set(14.4, 3, 5);
  root.add(dais);
  // the flight: from the dais edge down to the water, a yard thick under its nosings
  const run = 23 * 0.46;
  const fall = g.dais - g.water;
  const flight = new THREE.Mesh(box, stone);
  flight.scale.set(6, 1, Math.hypot(run, fall));
  flight.rotation.x = -Math.atan2(fall, run);
  flight.position.set(0, (g.dais + g.water) / 2 - 0.5, -2.6 - run / 2);
  root.add(flight);
  return root;
}

// ---- the liquid moonlight: pool, film and mirror in one mesh ----------------------

const pm = TEMPLE_POOL_MOON;
const fm = TEMPLE_FILM_MOON;
/** One layer's call, its numbers the core's (the arms a whole number there). */
const filmLayer = (i: number): string => {
  const [depth, spin, grain, arms] = TEMPLE_FILM_LAYERS[i];
  return `tFilmLayer(fp, slide, ${fx(depth)}, ${fx(spin)}, ${fx(grain)}, ${arms.toFixed(1)}, tm)`;
};
const drip = (i: number, k: number) => fx(TEMPLE_DRIPS[i]?.[k] ?? 0);

// Mirrors templePoolTrace, templeFilmMoonHeight, templeFilmMoonSeen,
// templeFilmWhirl, templeFilmLight and templeMirrorSight.
const MOONWATER_COMMON = `
${RISE_GLSL}
uniform vec4 uTempleGhost;
varying vec3 vTempleP;
varying vec3 vTempleC;
varying vec2 vTempleK;
const float T_C = ${fx(TEMPLE_GATE.centre)};
const float T_IN = ${fx(TEMPLE_GATE.inner)};
const float T_OUT = ${fx(TEMPLE_GATE.outer)};
const float T_WATER = ${fx(TEMPLE_GATE.water)};
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
             mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The sky a still water gives back: pale at the horizon, deep overhead.
vec3 tSky(vec3 r) {
  float up = pow(clamp(r.y, 0.0, 1.0), 0.55);
  vec3 day = mix(vec3(0.33, 0.42, 0.52), vec3(0.06, 0.14, 0.32), up);
  vec3 night = mix(vec3(0.03, 0.042, 0.075), vec3(0.006, 0.01, 0.028), up);
  vec3 sky = mix(day, night, uTemple.x);
  // low down a still water gives back its own dark banks, not the sky
  vec3 bank = mix(vec3(0.05, 0.07, 0.055), vec3(0.008, 0.012, 0.014), uTemple.x);
  return mix(bank, sky, smoothstep(0.03, 0.2, r.y));
}
float tFilmLight(float crest) { return ${fx(templeFilmLight(0))} + ${fx(templeFilmLight(1) - templeFilmLight(0))} * crest; }
// One layer of the film's turning light, seen at its own depth behind the
// ring (templeFilmWhirl). The angle wraps along the line west of the layer's
// heart: it only ever enters through a WHOLE number of arms or through its
// own sine and cosine, so nothing steps across that line.
float tFilmLayer(vec2 fp, vec2 slide, float depth, float spin, float grain, float arms, float tm) {
  vec2 q = fp + slide * depth;
  float r = length(q);
  // a slow whirl: the light is drawn out along the turn, tighter toward the heart
  float ang = atan(q.y, q.x + 1.0e-5) + spin * tm + ${fx(TEMPLE_FILM_LOOK.twist)} * log(r + 0.35);
  float warp = tNoise(vec2(cos(ang), sin(ang)) * 1.7 + r * grain + tm * 0.02);
  float band = sin(arms * ang + warp * 5.0 + r * grain * 6.0);
  // (a layer's threads fade in away from its heart: no eye, no drain)
  float thread = pow(max(1.0 - abs(band), 0.0), 5.0) * smoothstep(0.25, ${fx(TEMPLE_FILM_LOOK.calm)}, r);
  return thread * (0.35 + 0.65 * tNoise(q * grain * 2.2 + 3.0)) + 0.18 * warp;
}
vec4 templeMoonwater() {
  vec3 dir = normalize(vTempleP - vTempleC);
  vec3 rise = templeRise();
  float night = uTemple.x;
  float tm = uTime * uTemple.y;
  vec3 col;
  float alpha = 1.0;
  if (vTempleK.x < 0.5) {
    // THE POOL: a full moon hanging deep under the surface, at any hour
    vec2 pp = vTempleP.xz - vec2(${fx(TEMPLE_POOL.lx)}, ${fx(TEMPLE_POOL.lz)});
    float rr = length(pp) / ${fx(TEMPLE_POOL.radius)};
    vec2 rip = vec2(tNoise(vTempleP.xz * 1.7 + tm * 0.11), tNoise(vTempleP.xz * 1.7 - tm * 0.09 + 5.0)) - 0.5;
    vec3 d = refract(normalize(dir + vec3(rip.x, 0.0, rip.y) * 0.05), vec3(0.0, 1.0, 0.0), ${fx(pm.eta)});
    float down = max(-d.y, 0.3);
    float depth = mix(${fx(pm.restDepth)}, ${fx(pm.crestDepth)}, rise.z);
    vec2 q = pp + d.xz * (depth / down);
    float md = length(q) / ${fx(pm.radius)};
    float disc = 1.0 - smoothstep(0.93, 1.02, md);
    float maria = 0.8 + 0.2 * tNoise(q * 2.6 + 3.0) - 0.2 * smoothstep(0.4, 0.7, tNoise(q * 1.25 + 9.0));
    float halo = exp(-max(md - 1.0, 0.0) * 2.4) * 0.38 + exp(-max(md - 1.0, 0.0) * 0.55) * 0.12;
    vec3 moon = vec3(0.86, 0.92, 1.0) * (disc * maria + halo * (1.0 - disc)) * (1.0 + 0.7 * rise.z);
    vec2 sq = (pp + d.xz * (${fx(pm.stars)} / down)) * 0.55;
    vec2 cell = floor(sq);
    float sh = tHash(cell);
    vec2 so = (vec2(tHash(cell + 3.1), tHash(cell + 7.7)) - 0.5) * 0.6;
    float star = step(0.55, sh) * smoothstep(0.13, 0.0, length(fract(sq) - 0.5 - so)) * (0.55 + 0.45 * sin(tm * (1.0 + sh * 3.0) + sh * 40.0));
    col = vec3(0.006, 0.013, 0.034) + vec3(0.012, 0.026, 0.06) * exp(-md * 0.25) + moon + vec3(0.75, 0.85, 1.0) * star * 0.8 * (1.0 - disc);
    // the surface: the sky lies on it at a glancing eye, a slow ring crosses it, the kerb shades its edge
    float ring = sin(rr * 26.0 - tm * 0.9) * exp(-rr * 2.4) * 0.03;
    float fres = 0.03 + 0.97 * pow(clamp(1.0 + min(dir.y, 0.0), 0.0, 1.0), 5.0);
    col = mix(col, tSky(reflect(dir, vec3(0.0, 1.0, 0.0))), clamp(fres * 0.3 + ring, 0.0, 1.0));
    col *= 1.0 - 0.62 * smoothstep(0.78, 1.0, rr);
  } else if (vTempleK.x < 1.5) {
    // THE FILM: cold liquid moonlight standing in the ring, the moon deep in it.
    // It hangs on the gate: gone with it while the gate is the camera's ghost.
    if (uTempleGhost.x <= 0.004) discard;
    vec2 fp = vTempleP.xy - vec2(0.0, T_C);
    float fr = length(fp) / T_IN;
    vec2 slide = dir.xy / max(abs(dir.z), 0.14);
    float light = tFilmLight(rise.z);
    float v = ${filmLayer(0)} * 0.4
            + ${filmLayer(1)} * 0.35
            + ${filmLayer(2)} * 0.25;
    vec2 mq = fp + slide * ${fx(fm.depth)} + vec2(0.0, ${fx(fm.restDrop)} * (1.0 - rise.z) - ${fx(fm.lift)});
    float md = length(mq) / ${fx(fm.radius)};
    float disc = 1.0 - smoothstep(0.9, 1.03, md);
    float maria = 0.76 + 0.24 * tNoise(mq * 1.3 + 3.0) - 0.26 * smoothstep(0.4, 0.7, tNoise(mq * 0.62 + 9.0));
    float halo = exp(-max(md - 1.0, 0.0) * 1.5) * 0.4;
    // a night standing in the ring at any hour: deep blue, lighter toward the stone
    col = mix(vec3(0.012, 0.03, 0.1), vec3(0.05, 0.12, 0.34), smoothstep(0.1, 1.0, fr)) * (0.7 + 0.6 * light);
    col += vec3(0.8, 0.9, 1.0) * (disc * maria + halo * (1.0 - disc)) * (${fx(fm.rest)} + ${fx(fm.crest)} * rise.z);
    // the silver threads of the light turning in front of it
    col += vec3(0.62, 0.8, 1.0) * v * (0.5 + 0.5 * fr) * light * ${fx(TEMPLE_FILM_LOOK.threads)} * (1.0 - ${fx(TEMPLE_FILM_LOOK.moonVeil)} * disc);
    // the light pools against the stone, and slow rings cross it
    col += vec3(0.45, 0.66, 1.0) * pow(smoothstep(0.72, 1.0, fr), 2.0) * 0.75 * light;
    col *= 1.0 + 0.05 * sin(fr * 22.0 - tm * 0.7);
    alpha = uTempleGhost.x;
  } else {
    // THE MIRROR: the still water the weir holds at the stair's foot
    float depth = vTempleK.y;
    vec2 w = vTempleP.xz;
    vec2 g = vec2(
      0.03 * sin(w.x * 1.3 + tm * 0.5 + sin(w.y * 0.7)) + 0.018 * sin(w.x * 3.7 - w.y * 1.9 + tm * 0.8),
      0.03 * sin(w.y * 1.1 - tm * 0.4 + sin(w.x * 0.9)) + 0.018 * sin(w.y * 3.1 + w.x * 2.3 - tm * 0.7));
    g += 0.022 * (vec2(tNoise(w * 3.0 + tm * 0.2), tNoise(w * 3.0 - tm * 0.17 + 7.0)) - 0.5);
    float crests = 0.0;
    for (int i = 0; i < 3; i++) {
      // the rings of the drops that fall from the penitents
      vec2 c = i == 0 ? vec2(${drip(0, 0)}, ${drip(0, 2)}) : (i == 1 ? vec2(${drip(3, 0)}, ${drip(3, 2)}) : vec2(${drip(4, 0)}, ${drip(4, 2)}));
      float fi = float(i);
      float period = 3.6 + fi * 1.7;
      float age = fract(tm / period + fi * 0.37) * period;
      vec2 dv = w - c;
      float r = length(dv) + 1.0e-4;
      float front = r - age * 0.8;
      float ring = sin(front * 13.0) * exp(-abs(front) * 3.0) * exp(-age * 0.75);
      g += dv / r * ring * 0.3;
      crests += max(ring, 0.0);
    }
    vec3 n = normalize(vec3(g.x, 1.0, g.y));
    vec3 r = reflect(dir, n);
    r.y = abs(r.y) + 0.02;
    r = normalize(r);
    vec3 refl = tSky(r);
    if (r.z > 1.0e-4) {
      // what the mirror sees: the gate's film, the ring's stone, or the sky
      float t = -vTempleP.z / r.z;
      vec2 h = vec2(vTempleP.x + r.x * t, T_WATER + r.y * t);
      float hr = length(h - vec2(0.0, T_C));
      float inFilm = (1.0 - smoothstep(T_IN - 0.3, T_IN, hr)) * step(${fx(TEMPLE_GATE.sill)}, h.y);
      float inRing = (1.0 - smoothstep(T_OUT - 0.25, T_OUT, hr)) * step(${fx(TEMPLE_GATE.dais)}, h.y) * (1.0 - inFilm);
      refl = mix(refl, mix(vec3(0.36, 0.38, 0.4), vec3(0.03, 0.04, 0.058), night), inRing);
      refl = mix(refl, vec3(0.16, 0.3, 0.7) * (0.55 + 0.35 * rise.z) * (0.55 + 0.45 * tNoise(h * 0.6 + tm * 0.05)), inFilm);
    }
    float fres = 0.05 + 0.8 * pow(clamp(1.0 - dot(-dir, n), 0.0, 1.0), 3.2);
    float day = 1.0 - 0.88 * night;
    vec3 murk = mix(vec3(0.06, 0.075, 0.045), vec3(0.008, 0.022, 0.02), smoothstep(0.0, 0.4, depth)) * day;
    col = mix(murk, refl, fres);
    // the moonrise leaves the water at the stair's foot: the drowned inlay lights under it
    vec2 fd = w - vec2(0.0, ${fx(-14.3)});
    float foot = exp(-dot(fd, fd) / 8.0) * templeRune(0.0, rise);
    col += vec3(0.3, 0.5, 0.92) * foot * (0.4 + 0.35 * tNoise(w * 2.2 + tm * 0.4)) * (0.45 + 0.55 * night);
    // the gate's light lies down the water toward the eye
    vec3 toGate = normalize(vec3(0.0, T_C, 0.0) - vTempleP);
    float spec = pow(max(dot(reflect(dir, normalize(vec3(g.x * 2.6, 1.0, g.y * 2.6))), toGate), 0.0), 36.0);
    col += vec3(0.6, 0.78, 1.0) * spec * (0.1 + 0.28 * rise.z) * (0.35 + 0.65 * night);
    col += (vec3(0.5, 0.6, 0.68) * day + vec3(0.3, 0.45, 0.8) * rise.z * 0.5) * crests * 0.3;
    // the shore: the water thins to nothing on the bed
    alpha = smoothstep(0.0, 0.1, depth) * (0.9 + 0.1 * fres);
  }
  return vec4(col, alpha);
}`;

let moonwaterMat: THREE.MeshBasicMaterial | null = null;

function moonwaterMaterial(): THREE.MeshBasicMaterial {
  if (moonwaterMat) return moonwaterMat;
  // Blended, but it lays its own depth: it draws first among the world's
  // marks, so the mist and the sprites behind the film stay behind it.
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uTemple = templeUniforms.uTemple;
    shader.uniforms.uTempleGhost = templeUniforms.uTempleGhost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aTempleK;\nvarying vec3 vTempleP;\nvarying vec3 vTempleC;\nvarying vec2 vTempleK;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvTempleP = position;\nvTempleC = cameraPosition - modelMatrix[3].xyz;\nvTempleK = aTempleK;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${MOONWATER_COMMON}`)
      .replace('#include <map_fragment>', 'diffuseColor = templeMoonwater();');
  };
  material.customProgramCacheKey = () => TEMPLE_MOONWATER_PROGRAM_CACHE_KEY;
  material.name = 'DrownedTempleMoonwater';
  moonwaterMat = markSharedMaterial(material);
  return moonwaterMat;
}

/** One mesh, three faces: the pool's disc, the film's disc cut by the sill,
 *  and the mirror's grid (each vertex carries how deep the bed lies under it). */
function moonwater(ground: (lx: number, lz: number) => number): THREE.Mesh {
  const positions: number[] = [];
  const kinds: number[] = [];
  const index: number[] = [];
  const K = TEMPLE_WATER_KIND;
  const fan = (
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    kind: number,
    at: (c: number, s: number) => [number, number, number],
  ): void => {
    const base = positions.length / 3;
    const steps = 40;
    positions.push(cx, cy, cz);
    kinds.push(kind, 1);
    for (let i = 0; i < steps; i++) {
      const a = (Math.PI * 2 * i) / steps;
      positions.push(...at(Math.cos(a) * radius, Math.sin(a) * radius));
      kinds.push(kind, 1);
    }
    for (let i = 0; i < steps; i++) index.push(base, base + 1 + i, base + 1 + ((i + 1) % steps));
  };
  const p = TEMPLE_POOL;
  fan(p.lx, p.water, p.lz, p.radius + 0.04, K.pool, (c, s) => [p.lx + c, p.water, p.lz - s]);
  const g = TEMPLE_GATE;
  fan(0, g.centre, 0, g.inner + 0.08, K.film, (c, s) => [
    c,
    Math.max(g.centre + s, g.sill - 0.04),
    0,
  ]);
  const grid = templeMirrorGrid();
  const base = positions.length / 3;
  for (let i = 0; i + 1 < grid.positions.length; i += 2) {
    const x = grid.positions[i];
    const z = grid.positions[i + 1];
    positions.push(x, g.water, z);
    kinds.push(K.mirror, g.water - ground(x, z));
  }
  for (const i of grid.index) index.push(base + i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aTempleK', new THREE.Float32BufferAttribute(kinds, 2));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, moonwaterMaterial());
  mesh.renderOrder = floorVfxRenderOrder('ground', 0);
  mesh.name = 'drownedTempleMoonwater';
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

// The vertex stage mirrors templeMistPose: the puff's centre drifts along its
// own lane and widens, rides what it lies on between its birth and its end,
// faces the camera and lies low and wide.
const MIST_VERTEX = `float tT = fract(aA.z + uTime * aA.w * uTemple.y);
vec3 tCenter = vec3(
  aA.x + aB.x * tT + sin(uTime * 0.17 * uTemple.y + aA.z * 6.2831853) * 0.4,
  mix(aC.x, aC.y, tT) + aB.w + 0.15 * tT,
  aA.y + aB.y * tT);
float tScale = aB.z * (0.75 + 0.8 * tT);
vec4 mvPosition = modelViewMatrix * vec4(tCenter, 1.0);
mvPosition.xy += position.xy * vec2(tScale, tScale * 0.42);
vTemplePuff = vec3(smoothstep(0.0, 0.2, tT) * (1.0 - smoothstep(0.6, 1.0, tT)), aA.z, aC.z * templeRise().z);
gl_Position = projectionMatrix * mvPosition;`;

const MIST_FRAGMENT = `#include <map_fragment>
#ifdef USE_MAP
vec2 tUv = vMapUv * vec2(1.5, 0.66) + vec2(vTemplePuff.y * 7.0 + uTime * 0.012 * uTemple.y, vTemplePuff.y * 3.0);
float tWisp = texture2D(uTempleNoise, tUv).r;
float tHole = texture2D(uTempleNoise, tUv * 2.3 + vec2(0.37, uTime * 0.009 * uTemple.y)).r;
diffuseColor.a *= smoothstep(0.04, 0.3, tWisp) * (0.45 + 1.4 * tHole);
#endif
diffuseColor.rgb = mix(vec3(0.72, 0.78, 0.83), vec3(0.15, 0.2, 0.3), uTemple.x) + vec3(0.36, 0.52, 0.9) * vTemplePuff.z * (0.4 + 0.6 * uTemple.x);
diffuseColor.a *= vTemplePuff.x * (0.5 + 0.5 * uTemple.x) * (1.0 + 0.3 * vTemplePuff.z);`;

function mistMaterial(): THREE.MeshBasicMaterial {
  if (mistMat) return mistMat;
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: puffTexture() ?? undefined,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uTemple = templeUniforms.uTemple;
    shader.uniforms.uTempleNoise = { value: mistNoiseTexture() };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute vec4 aA;\nattribute vec4 aB;\nattribute vec4 aC;\nvarying vec3 vTemplePuff;\n${RISE_GLSL}`,
      )
      .replace('#include <project_vertex>', MIST_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform vec2 uTemple;\nuniform sampler2D uTempleNoise;\nvarying vec3 vTemplePuff;',
      )
      .replace('#include <map_fragment>', MIST_FRAGMENT);
  };
  material.customProgramCacheKey = () => TEMPLE_MIST_PROGRAM_CACHE_KEY;
  material.name = 'DrownedTempleMereMist';
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
  templeUniforms.uTemple.value.y = reduced ? 0 : 1;
}

function mereMist(
  tier: TempleEffectsTier,
  ground: (lx: number, lz: number) => number,
  light: THREE.PointLight,
): THREE.InstancedMesh {
  const count = templeMistPuffCount(tier);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 4);
  const c = new Float32Array(count * 4);
  const mesh = new THREE.InstancedMesh(geometry, mistMaterial(), count);
  // The shader ignores these matrices; they are seeded across each puff's own
  // drift so the fog sweep's footprint measurement at attach sees the spread.
  const m = new THREE.Matrix4();
  const pose: TempleMistPose = { x: 0, t: 0, z: 0, scale: 0, alpha: 0 };
  const lie = (x: number, z: number) => templeMistSurface(x, z, ground(x, z));
  for (let i = 0; i < count; i++) {
    const p = templeMistPuff(i, count);
    const g0 = lie(p.ox, p.oz);
    const g1 = lie(p.ox + p.dx, p.oz + p.dz);
    a.set([p.ox, p.oz, p.phase, p.speed], i * 4);
    b.set([p.dx, p.dz, p.size, p.y], i * 4);
    c.set([g0, g1, p.lit, 0], i * 4);
    templeMistPose(p, (i / count) * 4, 0, pose);
    m.makeTranslation(pose.x, g0 + (g1 - g0) * pose.t + p.y, pose.z);
    mesh.setMatrixAt(i, m);
  }
  geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4));
  geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4));
  geometry.setAttribute('aC', new THREE.InstancedBufferAttribute(c, 4));
  // Every puff travels its whole lane in the shader, away from its seeded
  // matrix: frustum culling would drop puffs still on screen. The set piece's
  // cull group (the fog sweep) still sheds it with the rest.
  mesh.frustumCulled = false;
  mesh.renderOrder = floorVfxRenderOrder('ground', 1);
  mesh.name = 'drownedTempleMist';
  const rise: TempleMoonrise = { front: 0, glow: 0, crest: 0 };
  mesh.onBeforeRender = () => {
    const u = templeUniforms.uTemple.value;
    u.x = templeNightAmount(currentDayNightPhase());
    const time = sharedUniforms.uTime.value;
    motionNow(time);
    // The fire-light budget flickers a source about its own base: the moonrise
    // moves the base, the budget's shimmer rides on it.
    light.userData.baseIntensity = templeGateLightIntensity(templeMoonrise(time, u.y, rise).crest);
  };
  return mesh;
}

// ---- the sprites (one instanced additive draw) -------------------------------------

let spriteMat: THREE.MeshBasicMaterial | null = null;

// Mirrors templeSpritePose. Kinds: 0 halo, 1 flare, 2 shaft, 3 mote, 4 glint,
// 5 fall, 6 foam, 7 glow.
const SPRITE_VERTEX = `// aK.z is the kind, plus a tenth for each step of the fading unit it hangs on
float tK = floor(aK.z + 0.02);
float tHung = floor((aK.z - tK) * 10.0 + 0.5);
float tTm = uTime * uTemple.y;
float tN = uTemple.x;
vec3 tRise = templeRise();
vec3 tC = aS.xyz;
vec2 tQ = position.xy;
float tA = 1.0;
vec4 mvPosition;
vTempleU = vec2(tQ.x, tQ.y + 0.5);
if (tK > 1.5 && tK < 2.5) {
  // the shaft: a quad along its own axis, turned about it to face the eye
  vec3 dir = normalize(aD.xyz);
  float u = tQ.y + 0.5;
  vec3 foot = (modelMatrix * vec4(tC, 1.0)).xyz;
  vec3 toEye = normalize(cameraPosition - (foot + dir * aK.w * 0.5));
  vec3 side = cross(dir, toEye);
  float sl = length(side);
  side = sl > 1.0e-3 ? side / sl : vec3(1.0, 0.0, 0.0);
  // the foot goes through modelViewMatrix and the offset turns as a direction:
  // the point viewMatrix * world names, with no world point built first
  mvPosition = modelViewMatrix * vec4(tC, 1.0);
  mvPosition.xyz += mat3(viewMatrix) * (dir * (aK.w * u) + side * (tQ.x * mix(aS.w, aD.w, u)));
  tA = tRise.z * tRise.z * (0.45 + 0.55 * tN) * smoothstep(0.06, 0.45, sl);
} else if (tK > 4.5 && tK < 5.5) {
  // a thread of the fall: drawn out as it gathers speed
  float t = fract(aK.x + tTm * aK.y);
  tC.x += -aD.z * aD.w + aD.x * 0.25 * t;
  tC.z += aD.x * aD.w + aD.z * 0.25 * t;
  tC.y -= aK.w * t * t;
  mvPosition = modelViewMatrix * vec4(tC, 1.0);
  mvPosition.xy += tQ * vec2(aS.w, aS.w * (3.0 + 9.0 * t));
  tA = 0.55 * (1.0 - smoothstep(0.8, 1.0, t));
} else if (tK > 5.5 && tK < 6.5) {
  // the foam lies on the ground's own slope
  vec3 gx = normalize(vec3(1.0, aD.x, 0.0));
  vec3 gz = normalize(vec3(0.0, aD.z, 1.0));
  float sz = aS.w * (0.85 + 0.15 * sin(tTm * 2.3 + aK.x * 6.2831853));
  mvPosition = modelViewMatrix * vec4(tC + gx * (tQ.x * sz) + gz * (tQ.y * sz), 1.0);
  tA = 0.3 + 0.1 * sin(tTm * 1.7 + aK.x * 6.2831853);
} else {
  if (tK < 0.5) {
    tA = templeRune(aK.w, tRise) * (0.3 + 0.7 * tN);
  } else if (tK < 1.5) {
    tA = (0.06 + 0.94 * tRise.z) * (0.5 + 0.5 * tN);
  } else if (tK < 3.5) {
    float t = fract(aK.x + tTm * aK.y);
    tC.y += aK.w * t;
    tC.x += sin(tTm * 0.4 + aK.x * 6.2831853) * 0.35;
    tA = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.6, 1.0, t)) * (0.3 + 0.7 * tN);
  } else if (tK < 4.5) {
    tA = pow(max(0.0, sin(tTm * aK.y + aK.x * 6.2831853)), 10.0) * (0.75 + 0.25 * tN);
  } else {
    tA = (aK.w + (1.0 - aK.w) * tRise.z) * (0.45 + 0.55 * tN);
  }
  mvPosition = modelViewMatrix * vec4(tC, 1.0);
  mvPosition.xy += tQ * aS.w;
}
// what hangs on a fading unit goes with it while that unit is the camera's ghost
if (tHung > 0.5) tA *= tHung < 1.5 ? uTempleGhost.x : (tHung < 2.5 ? uTempleGhost.y : (tHung < 3.5 ? uTempleGhost.z : uTempleGhost.w));
vTempleQ = tQ;
vTempleS = vec2(tK, tA);
gl_Position = projectionMatrix * mvPosition;`;

const SPRITE_FRAGMENT = `vec2 tQ = vTempleQ;
float tKind = vTempleS.x;
vec3 tCol;
float tAl;
float tR = clamp(1.0 - length(tQ) * 2.0, 0.0, 1.0);
if (tKind > 1.5 && tKind < 2.5) {
  // a shaft of moonlight in the haze: no edge, thinning to nothing
  float across = max(1.0 - 4.0 * vTempleU.x * vTempleU.x, 0.0);
  float v = vTempleU.y;
  tCol = vec3(0.5, 0.68, 1.0) * 0.5;
  tAl = across * across * across * smoothstep(0.0, 0.08, v) * pow(max(1.0 - v, 0.0), 1.8);
} else if (tKind < 0.5) {
  float heart = clamp(1.0 - length(tQ) * 5.0, 0.0, 1.0);
  tCol = vec3(0.5, 0.7, 1.0) * (0.34 + 0.8 * heart * heart);
  tAl = tR * tR;
} else if (tKind < 1.5) {
  // the flare: a soft heart and four thin rays
  float ray = max(exp(-abs(tQ.x) * 46.0) * (1.0 - abs(tQ.y) * 2.0), exp(-abs(tQ.y) * 46.0) * (1.0 - abs(tQ.x) * 2.0));
  tCol = vec3(0.62, 0.8, 1.0) * 0.9;
  tAl = tR * tR * tR + max(ray, 0.0) * 0.6;
} else if (tKind < 3.5) {
  tCol = vec3(0.6, 0.8, 1.0) * 0.9;
  tAl = tR * tR;
} else if (tKind < 4.5) {
  float ray = max(exp(-abs(tQ.x) * 60.0) * (1.0 - abs(tQ.y) * 2.0), exp(-abs(tQ.y) * 60.0) * (1.0 - abs(tQ.x) * 2.0));
  tCol = vec3(0.86, 0.93, 1.0);
  tAl = max(ray, 0.0) + tR * tR * tR * 0.5;
} else if (tKind < 5.5) {
  tCol = vec3(0.7, 0.8, 0.86) * 0.55;
  tAl = clamp(1.0 - abs(tQ.x) * 2.0, 0.0, 1.0) * clamp(1.0 - abs(tQ.y) * 2.0, 0.0, 1.0);
} else if (tKind < 6.5) {
  tCol = vec3(0.7, 0.8, 0.86) * 0.4;
  tAl = tR * tR;
} else {
  // a glow seen through the air: no rays and no edge
  tCol = vec3(0.42, 0.62, 1.0) * 0.34;
  tAl = tR * tR * tR;
}
diffuseColor = vec4(tCol, tAl * vTempleS.y);`;

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
    shader.uniforms.uTemple = templeUniforms.uTemple;
    shader.uniforms.uTempleGhost = templeUniforms.uTempleGhost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec4 uTempleGhost;\nattribute vec4 aS;\nattribute vec4 aK;\nattribute vec4 aD;\nvarying vec2 vTempleQ;\nvarying vec2 vTempleS;\nvarying vec2 vTempleU;\n${RISE_GLSL}`,
      )
      .replace('#include <project_vertex>', SPRITE_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vTempleQ;\nvarying vec2 vTempleS;\nvarying vec2 vTempleU;',
      )
      .replace('#include <map_fragment>', SPRITE_FRAGMENT);
  };
  material.customProgramCacheKey = () => TEMPLE_SPRITE_PROGRAM_CACHE_KEY;
  material.name = 'DrownedTempleMoonriseSprites';
  spriteMat = markSharedMaterial(material);
  return spriteMat;
}

function moonriseSprites(
  tier: TempleEffectsTier,
  ground: (lx: number, lz: number) => number,
): THREE.InstancedMesh {
  const sprites = templeSprites(tier, ground);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const s = new Float32Array(sprites.length * 4);
  const k = new Float32Array(sprites.length * 4);
  const d = new Float32Array(sprites.length * 4);
  const mesh = new THREE.InstancedMesh(geometry, spriteMaterial(), sprites.length);
  const m = new THREE.Matrix4();
  sprites.forEach((sp, i) => {
    s.set([sp.x, sp.y, sp.z, sp.size], i * 4);
    k.set([sp.phase, sp.speed, sp.kind + sp.hung * 0.1, sp.range], i * 4);
    d.set([sp.dx, sp.dy, sp.dz, sp.spread], i * 4);
    m.makeTranslation(sp.x, sp.y, sp.z);
    mesh.setMatrixAt(i, m);
  });
  geometry.setAttribute('aS', new THREE.InstancedBufferAttribute(s, 4));
  geometry.setAttribute('aK', new THREE.InstancedBufferAttribute(k, 4));
  geometry.setAttribute('aD', new THREE.InstancedBufferAttribute(d, 4));
  // Motes rise, threads fall and the shaft reaches away from their seeded matrices.
  mesh.frustumCulled = false;
  mesh.renderOrder = floorVfxRenderOrder('ground', 2);
  mesh.name = 'drownedTempleSprites';
  return mesh;
}

/** Build the Moon Stair (world coordinates). */
export function buildDrownedTempleEntrance(seed: number): DrownedTempleEntranceView {
  const door = activeDungeonDoorPos(DUNGEONS[DROWNED_TEMPLE_ENTRANCE_DUNGEON_ID]);
  const base = terrainHeight(door.x, door.z, seed);
  const ground = (lx: number, lz: number) => terrainHeight(door.x + lx, door.z + lz, seed) - base;
  const group = new THREE.Group();
  group.name = 'drownedTempleEntrance';
  const body = new THREE.Group();
  body.name = 'drownedTempleEntranceBody';
  body.position.set(door.x, base, door.z);
  const mainSource = sources.get(MAIN_URL);
  const main = mainSource ? seat(mainSource, true) : fallbackGate();
  body.add(main);
  const worksSource = sources.get(WORKS_URL);
  const works = worksSource ? seat(worksSource, true) : null;
  if (works) body.add(works);
  const growthSource = sources.get(GROWTH_URL);
  const growth = growthSource ? seat(growthSource, false) : null;
  if (growth) body.add(growth);
  // Camera occlusion: every collider row is an occluder, in four fading units
  // (the gate, the flight's two flanks, the works), so only what stands in the
  // way goes; the film is one of the gate's solids, so ring and film ghost as
  // one. The treads carry no solid and never ghost under the character.
  const solids = {
    gate: [] as SetPieceSolid[],
    east: [] as SetPieceSolid[],
    west: [] as SetPieceSolid[],
    works: [] as SetPieceSolid[],
  };
  drownedTempleEntranceColliders(seed, door).forEach((collider, i) => {
    // the set piece's rows are circles and boxes; a prism has no occluder box
    if (collider.type === 'prism') return;
    const { cameraTopY, ...shape } = collider;
    solids[templeOccluderSet(DROWNED_TEMPLE_ENTRANCE_COLLIDERS[i].name)].push({
      ...shape,
      topY: cameraTopY ?? base,
    });
  });
  const f = TEMPLE_FILM_OCCLUDER;
  solids.gate.push({
    type: 'obb',
    x: door.x + f.lx,
    z: door.z + f.lz,
    hw: f.hw,
    hd: f.hd,
    rot: 0,
    topY: base + f.top,
  });
  const node = (root: THREE.Object3D | null, name: string): THREE.Object3D[] => {
    const found = root?.getObjectByName(name);
    return found ? [found] : [];
  };
  const gateRoots = mainSource
    ? [...node(main, 'Entrance_Moongate'), ...node(growth, 'Growth_Gate')]
    : [main];
  const roots: Record<TempleGhostSet, THREE.Object3D[]> = {
    gate: gateRoots,
    east: [...node(main, 'Entrance_FlankEast'), ...node(growth, 'Growth_FlankEast')],
    west: [...node(main, 'Entrance_FlankWest'), ...node(growth, 'Growth_FlankWest')],
    works: [...(works ? [works] : []), ...node(growth, 'Growth_Works')],
  };
  // One entrance per world: a rebuild in the same page retires the last one's.
  for (const handle of occluderHandles) handle.dispose();
  const ghost = templeUniforms.uTempleGhost.value;
  ghost.set(1, 1, 1, 1);
  occluderHandles = TEMPLE_GHOST_SETS.map((unit, i) =>
    registerSetPieceOccluders(solids[unit], roots[unit], {
      // the film, the halos, the flare, the shafts and the falls are no models:
      // each follows the unit it hangs on (uTempleGhost's component i)
      onFade: (alpha) => ghost.setComponent(i, templeGhostShown(alpha)),
    }),
  );
  // The player's static effects tier (GFX.effectsTier: the preset, already
  // lowered by the Advanced Effects dial), never the frame governor: cosmetic
  // richness only. (effectsQuality is read for the 'advanced' label alone.)
  const tier = resolveUiEffectsProfile({
    presetLabel: GFX.effectsTier,
    effectsQuality: 1,
    reduceMotion: false,
  }).tier;
  const light = new THREE.PointLight(
    TEMPLE_GATE_LIGHT.color,
    templeGateLightIntensity(TEMPLE_MOONRISE.stillCrest),
    TEMPLE_GATE_LIGHT.distance,
    2,
  );
  light.userData.baseIntensity = light.intensity;
  light.position.set(
    door.x + TEMPLE_GATE_LIGHT.lx,
    base + TEMPLE_GATE_LIGHT.y,
    door.z + TEMPLE_GATE_LIGHT.lz,
  );
  body.add(moonwater(ground));
  body.add(mereMist(tier, ground, light));
  body.add(moonriseSprites(tier, ground));
  group.add(body);
  group.add(light);
  return { group, glowLights: [light], cullGroups: [body] };
}

/** The camera occluder sets of the entrance last built, in TEMPLE_GHOST_SETS' order. */
let occluderHandles: SetPieceOccluderHandle[] = [];

export const drownedTempleEntranceInternalsForTest = {
  kitMaterial,
  inlayMaterial,
  moonwaterMaterial,
  mistMaterial,
  spriteMaterial,
  moonwater,
  moonwaterCommon: MOONWATER_COMMON,
  riseGlsl: RISE_GLSL,
  mistVertex: MIST_VERTEX,
  spriteVertex: SPRITE_VERTEX,
  mistFieldCount: TEMPLE_MIST_FIELDS.length,
  occluderHandles: (): readonly SetPieceOccluderHandle[] => occluderHandles,
  uniforms: templeUniforms,
  /** Stand a model in for a GLB (null takes it away again). */
  setSourceForTest(url: string, scene: THREE.Group | null): void {
    if (scene) sources.set(url, scene);
    else sources.delete(url);
  },
  urls: { main: MAIN_URL, works: WORKS_URL, growth: GROWTH_URL },
  resetCaches(): void {
    inlayMat = moonwaterMat = mistMat = spriteMat = null;
    puffTex = null;
    lastMotionCheck = -10;
    // the last build's sets go with it: nothing of a torn-down renderer stays reachable here
    for (const handle of occluderHandles) handle.dispose();
    occluderHandles = [];
    templeUniforms.uTempleGhost.value.set(1, 1, 1, 1);
  },
};
