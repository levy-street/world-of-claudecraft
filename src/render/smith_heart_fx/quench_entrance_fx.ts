// The Guardian of the Quench's entrance, "Under the ice" (plan:
// quench_entrance_core.ts), hosted by ../rift_death_zone.ts beside the raid's
// other fx and updated before her body's painter: it reads the scene's clock
// off the guardian's aura (IWorld only, so offline and online look the same),
// holds its look for her body (quench_entrance_state.ts: her eyes, her heart,
// her always-on cold), sends her stances through the gesture seam (lying
// frozen, the Emerge one-shot on the breach, her light held dim and grey
// while she lies there) and draws the rest:
//  - dormant: a sheet of clear ice over her lying body (her own model seen
//    through it, dim and grey), a breath of frost drifting off it now and
//    then, a faint light under it beating slow like a heart;
//  - the wake and the web: a web of cracks racing out from her across the
//    lake toward the raid (a dark fracture under a blue light leaking up
//    through it, motes of light rising off it), frost creeping over the ice,
//    cold mist rising, the snow thickening into a flurry, the sheet over her
//    crazing and trembling as the light under it swells, the ice cracking
//    deep (her own `heart_quench_*` samples);
//  - the breach: the sheet bursting into a fountain of chunks and shards, a
//    frost shockwave racing out across the raid (a wall of spray and the
//    floor's wave; cosmetic: no damage, no knockback), the camera's thud
//    through the shake sink and a burst of cold light at her (never a
//    white-out; reduced motion: neither);
//  - the blades: her conjured swords of ice (the Smith's blades' own section,
//    quench_blade_tip_core.ts) rising out of the lake one by one round her,
//    circling her, then turning to point each at one of the raid; after she
//    is handed back they plunge back under the ice.
// No camera is taken, no control: the player plays through it.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated (the
// compile gate links every program before the first frame that draws it);
// fixed pools, no light, no per-frame allocation; her model's own materials
// are never written (her dim rides the rig's glow pulse clones). The low
// tier thins the particles and the chunks; every beat plays on every tier.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { inSmithHeartClaim } from './council_fx_core';
import { HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { moltenDecal } from './heat_molten_decal';
import {
  QUENCH_BODY_COLORS,
  QUENCH_BODY_GESTURES,
  QUENCH_GUARDIAN,
  quenchSocketIndex,
} from './quench_body_core';
import { quenchBodySockets } from './quench_body_sockets';
import {
  AWAKE,
  CHUNK_LIFE,
  type ChunkState,
  crossedQuenchBeat,
  ENTRANCE_BLADE_PROFILE,
  ENTRANCE_WEB,
  FROST_REACH,
  heavedSlabAt,
  newChunkState,
  newQuenchEntranceLook,
  newSlabState,
  QUENCH_ENTRANCE,
  QUENCH_ENTRANCE_BLADES,
  QUENCH_ENTRANCE_LOW_SHARE,
  QUENCH_ENTRANCE_POOLS,
  QUENCH_ENTRANCE_SOUNDS,
  QUENCH_SHEET,
  QUENCH_SHEET_MOUTH,
  type QuenchEntranceClock,
  type QuenchEntranceLook,
  type QuenchEntranceStance,
  quenchEntranceClock,
  quenchEntranceFlash,
  quenchEntranceHash,
  quenchEntranceLook,
  quenchEntranceShake,
  SLAB,
  sheetChunkAt,
  stepQuenchEntranceTime,
  WEB_VERTICES,
  type WebPoint,
} from './quench_entrance_core';
import { holdQuenchEntrance } from './quench_entrance_state';

const SCAN_SEC = 0.25;
/** Seconds between re-sends of the held stance and of the dim pulse (the
 *  pulse holds 1 s, so she stays dim while it is re-sent, even on a slow
 *  frame; a rebuilt view picks the stance up on the next send). */
const RESEND_SEC = 0.35;
const E = QUENCH_ENTRANCE;
const P = QUENCH_ENTRANCE_POOLS;
const B = QUENCH_ENTRANCE_BLADES;
const C = QUENCH_BODY_COLORS;
const S_MOUTH = quenchSocketIndex('mouth');
const S_EYES = [quenchSocketIndex('eyeL'), quenchSocketIndex('eyeR')] as const;
/** The halos' instances: one per blade, one glint per blade's point (the
 *  snap onto its mark), then her two eyes' glints under the ice (bigger than
 *  her body's own, so they read through the sheet). */
const HALOS = B.count * 2 + 2;
const TIP0 = B.count;
const EYE0 = B.count * 2;

// ---- the floor: frost, the web, the light under her -------------------------------------------

const FLOOR_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Frost creeping over the ice: feathered rime and crazed plates inside a
 *  ragged front (its own yards: the disc's local frame), its front edge a
 *  breath brighter. */
const FROST_FRAG = /* glsl */ `
  uniform float uReach;
  uniform float uAlpha;
  varying vec2 vLocal;
  ${HEAT_NOISE_GLSL}
  void main() {
    vec2 p = vLocal;
    float r = length(p);
    float n = fbm(p * 0.16);
    float front = uReach * (0.8 + 0.35 * n);
    float inside = 1.0 - smoothstep(front - 3.0, front, r);
    if (inside <= 0.001) discard;
    float plates = 1.0 - smoothstep(0.0, 0.07, cellEdge(p * 0.32));
    float fern = fbm(p * 1.4 + n * 2.5);
    float rim = smoothstep(front - 3.0, front - 0.8, r) * inside;
    // Glints: a point of light in some cells of a fine grid.
    vec2 g = p * 2.2;
    vec2 cell = floor(g);
    vec2 off = vec2(hh2(cell), hh2(cell + 7.1)) * 0.8 + 0.1;
    float gd = length(fract(g) - off);
    float glint = step(0.9, hh2(cell + 3.3)) * (1.0 - smoothstep(0.0, 0.12, gd));
    float a = inside * (0.02 + 0.09 * fern * fern + 0.05 * plates + 0.12 * rim + 0.45 * glint) * uAlpha;
    vec3 col = mix(vec3(0.5, 0.75, 0.98), vec3(0.85, 0.95, 1.0), fern) + rim * 0.1 + glint * 0.4;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.6));
  }
`;

const STRIP_VERT = /* glsl */ `
  attribute float aReveal;
  attribute float aSide;
  varying float vReveal;
  varying float vSide;
  varying vec2 vLocal;
  void main() {
    vReveal = aReveal;
    vSide = aSide;
    vLocal = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A crack of the web: a dark fracture (the char pass darkens the ice) with
 *  the cold light leaking up through it (the glow pass), its running tip
 *  brightest; the light breathing on the crack's own yards. */
const WEB_FRAG = /* glsl */ `
  uniform float uGrow;
  uniform float uGlow;
  uniform float uTime;
  varying float vReveal;
  varying float vSide;
  varying vec2 vLocal;
  ${HEAT_NOISE_GLSL}
  void main() {
    float shown = 1.0 - smoothstep(uGrow - 0.03, uGrow, vReveal);
    if (shown <= 0.001) discard;
    float s = abs(vSide);
    float tq = (uGrow - vReveal) / 0.04;
    float tip = exp(-tq * tq) * (1.0 - step(0.995, uGrow));
    float n = vn(vLocal * 1.3 + vec2(uTime * 0.35, -uTime * 0.25));
    float core = 1.0 - smoothstep(0.0, 0.18 + 0.08 * n, s);
    float halo = 1.0 - smoothstep(0.18, 1.0, s);
    float g = uGlow * (0.7 + 0.5 * n);
    vec3 e = vec3(0.08, 0.38, 1.0) * halo * 0.6 * g
      + vec3(0.4, 0.78, 1.0) * core * 0.95 * g
      + vec3(0.85, 0.97, 1.0) * tip * (core * 2.0 + halo * 0.5);
    // The fracture fades with its light as the scene ends (no dark web left
    // on the lake to pop away).
    float a = clamp(shown * (core * 0.75 + halo * 0.3 * min(g, 1.0)) * min(1.0, uGlow * 1.6), 0.0, 1.0);
    gl_FragColor = vec4(e * shown / max(a, 0.02), a);
  }
`;

/** The cold light under her, through the ice (additive). */
const UNDER_FRAG = /* glsl */ `
  uniform float uUnder;
  uniform float uTime;
  varying vec2 vLocal;
  void main() {
    float d = length(vLocal);
    float g = max(1.0 - d, 0.0);
    g = g * g * (0.85 + 0.15 * sin(uTime * 3.0 + d * 9.0));
    gl_FragColor = vec4(vec3(0.3, 0.72, 1.0) * g * uUnder, 1.0);
  }
`;

// ---- the sheet over her ---------------------------------------------------------------------------

const SHEET_VERT = /* glsl */ `
  uniform float uTremble;
  uniform float uTime;
  varying vec3 vP;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vP = position;
    vec3 p = position;
    // A shudder through the ice as the light under it swells.
    p += normal * uTremble * 0.05 * sin(uTime * 47.0 + p.x * 11.0 + p.z * 7.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/** Clear lake ice over her: a deep blue-grey body that lets her show dim and
 *  grey, milky where it is thick, a pale rim where it curves away, crazing
 *  into plates as it strains, the cold light under it swelling through. */
const SHEET_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uCrack;
  uniform float uUnder;
  uniform vec2 uSize;
  varying vec3 vP;
  varying vec3 vN;
  varying vec3 vV;
  ${HEAT_NOISE_GLSL}
  void main() {
    vec3 n = normalize(vN);
    float fr = 1.0 - abs(dot(n, normalize(vV)));
    fr = fr * fr;
    vec2 q = vP.xz * uSize;
    float milk = fbm(q * 0.32 + 3.1);
    float centre = length(vP.xz);
    // The crazing spreads out from her middle as the light swells.
    float reach = uCrack * 1.25;
    float edge = cellEdge(q * 0.62);
    float craze = (1.0 - smoothstep(0.0, 0.07, edge)) * (1.0 - smoothstep(reach - 0.2, reach, centre));
    float under = uUnder * (1.0 - smoothstep(0.0, 1.0, centre)) * (0.55 + 0.45 * milk);
    vec3 deep = vec3(0.04, 0.12, 0.2);
    vec3 pale = vec3(0.45, 0.68, 0.85);
    float fr2 = fr * fr;
    vec3 col = mix(deep, pale, clamp(milk * 0.25 + fr2 * 0.6, 0.0, 1.0));
    // A cold glint off each facet (a fixed light from high over the lake).
    vec3 l = normalize(vec3(0.3, 0.9, 0.35));
    float spec = max(dot(reflect(-normalize(vV), n), l), 0.0);
    spec = spec * spec;
    spec = spec * spec;
    spec = spec * spec;
    col += vec3(0.75, 0.92, 1.0) * spec * 1.2;
    col += vec3(0.6, 0.88, 1.0) * craze * (0.5 + 1.6 * uUnder);
    col += vec3(0.25, 0.62, 1.0) * under * 1.2;
    // Clear over her (she shows through, dim and blue), paler only at the
    // facets turned right away, frosted where it meets the lake.
    float a = 0.07 + 0.06 * milk + 0.22 * fr2 + 0.45 * spec + 0.5 * craze;
    a += 0.16 * (1.0 - smoothstep(0.0, 0.22, vP.y));
    a *= smoothstep(-0.02, 0.06, vP.y);
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.8) * uAlpha);
  }
`;

// ---- ice bodies: the sheet's chunks and the conjured blades -----------------------------------

const ICE_VERT = /* glsl */ `
  attribute float aH;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying vec3 vGlow;
  void main() {
    vH = aH;
    #ifdef USE_INSTANCING_COLOR
    vGlow = instanceColor;
    #else
    vGlow = vec3(1.0);
    #endif
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/** Crystal ice: deep and clear facing the eye, pale and bright at its rim, a
 *  cold light down its length (`vH` up a blade; a chunk's is flat), the
 *  instance's colour its light. */
const ICE_FRAG = /* glsl */ `
  uniform float uCore;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying vec3 vGlow;
  void main() {
    vec3 n = normalize(vN);
    float fr = 1.0 - abs(dot(n, normalize(vV)));
    float rim = fr * fr;
    vec3 deep = vec3(0.0, 0.035, 0.14);
    vec3 pale = vec3(0.32, 0.66, 1.0);
    float light = vGlow.r;
    float fuller = uCore * (0.25 + 0.75 * sin(vH * 3.14159)) * light;
    // Deep blue crystal, its edges and its fuller burning cyan.
    vec3 col = deep + pale * rim * (0.25 + 0.6 * light) + vec3(0.1, 0.5, 1.0) * fuller * 0.6;
    float a = clamp(0.6 + 0.35 * rim + 0.1 * fuller, 0.0, 0.96);
    gl_FragColor = vec4(col, a);
  }
`;

// ---- the conjured blades: crystal swords with a burning heart ----------------------------------

const BLADE_VERT = /* glsl */ `
  attribute float aH;
  attribute float aCore;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying float vCore;
  varying vec3 vGlow;
  void main() {
    vH = aH;
    vCore = aCore;
    #ifdef USE_INSTANCING_COLOR
    vGlow = instanceColor;
    #else
    vGlow = vec3(1.0);
    #endif
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

/** A sword of lake ice: deep and clear through its flats, its facets
 *  catching a cold sheen and a play of light inside (a refraction's look:
 *  bands that slide as the view turns over the facets), a burning blue core
 *  down its ridge, its keen edges lit white, its rim pale; the instance's
 *  colour its light. */
const BLADE_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying float vH;
  varying float vCore;
  varying vec3 vGlow;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float nv = abs(dot(n, v));
    float fr = 1.0 - nv;
    float rim = fr * fr;
    float light = vGlow.r;
    float along = sin(vH * 3.14159);
    float inner = 0.5 + 0.5 * sin(dot(n, vec3(11.0, 7.0, 13.0)) * 1.7 + vH * 21.0 - uTime * 1.3);
    inner = inner * inner;
    float core = 1.0 - smoothstep(0.0, 0.32, vCore);
    float edge = smoothstep(0.72, 1.0, vCore);
    // A step deeper and more saturated than it should read: the Quench's
    // grade lifts it to clear blue ice on screen (quench_breath_core.ts).
    vec3 deep = vec3(0.0, 0.03, 0.2);
    vec3 cyan = vec3(0.0, 0.45, 1.0);
    vec3 pale = vec3(0.25, 0.7, 1.0);
    // A saturated deep-blue body, solid enough to stand dark against the
    // pale lake, its ridge burning cyan, its keen edges lit.
    vec3 col = deep * (0.55 + 0.6 * nv);
    col += cyan * core * (0.45 + 0.4 * light) * (0.5 + 0.5 * along);
    col += cyan * edge * (0.35 + 0.35 * light);
    col += pale * rim * 0.28;
    col += cyan * inner * 0.18 * (1.0 - edge);
    float a = clamp(0.93 + 0.07 * rim, 0.0, 0.99);
    gl_FragColor = vec4(col, a);
  }
`;

/** A blade's own crack in the ice where it broke out: a star of cracks
 *  running out with cold light in them (the instance's colour: red its
 *  reveal, green its strength). */
const STAR_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vK;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
    vK = instanceColor.rg;
    #else
    vK = vec2(1.0);
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const STAR_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vK;
  ${HEAT_NOISE_GLSL}
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0 || r < 0.0001 || vK.y <= 0.001) discard;
    float a = atan(p.y, p.x);
    float jag = vn(vec2(a * 3.0, r * 6.0)) - 0.5;
    float spokes = abs(sin(a * 4.5 + jag * 1.6 + r * 1.3));
    float line = 1.0 - smoothstep(0.0, 0.09 + 0.05 * (1.0 - r), spokes);
    float ringy = 1.0 - smoothstep(0.0, 0.05, abs(r - 0.45 + jag * 0.1));
    float shown = 1.0 - smoothstep(vK.x - 0.08, vK.x, r);
    float k = max(line, ringy * 0.6) * shown * (1.0 - r * 0.6);
    vec3 col = mix(vec3(0.2, 0.6, 1.0), vec3(0.85, 0.97, 1.0), line * (1.0 - r));
    gl_FragColor = vec4(col * k * vK.y, 1.0);
  }
`;

/** The shockwave's frosted edge on the floor: a crisp bright lip of frozen
 *  crystals racing out, a band of rime behind it fading (the ring's own
 *  local frame, its outer edge at 1). */
const BAND_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  varying vec2 vLocal;
  ${HEAT_NOISE_GLSL}
  void main() {
    float r = length(vLocal);
    float a = atan(vLocal.y, vLocal.x);
    float n = vn(vec2(a * 40.0, r * 18.0 - uTime * 2.0));
    float lip = 1.0 - smoothstep(0.0, 0.035 + 0.02 * n, 1.0 - r);
    float wake = smoothstep(0.86, 0.99, r) * (0.2 + 0.5 * n);
    float crystals = step(0.82, vn(vec2(a * 90.0, r * 40.0))) * smoothstep(0.75, 0.97, r);
    float k = (lip * 1.4 + wake * 0.45 + crystals * 0.9) * uAlpha;
    vec3 col = mix(vec3(0.35, 0.72, 1.0), vec3(0.95, 1.0, 1.0), lip + crystals * 0.5);
    gl_FragColor = vec4(col * k, 1.0);
  }
`;

// ---- light: billboards (the blades' halos, the breach's burst) ---------------------------------

const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    vUv = uv;
    #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(instanceMatrix[0].xyz);
    #else
    vCol = vec3(1.0);
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(modelMatrix[0].xyz);
    #endif
    c.xy += position.xy * s;
    gl_Position = projectionMatrix * c;
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  varying vec3 vCol;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float g = max(1.0 - d, 0.0);
    float core = g * g * g;
    g = g * g;
    gl_FragColor = vec4((uColor * g + vec3(1.0) * core * 0.6) * vCol, uAlpha * g);
  }
`;

// ---- the breach's geyser of ice and cold light -------------------------------------------------

const GEYSER_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec3 p = position;
    // Wider toward its top: it bursts open as it climbs.
    p.xz *= 1.0 + 0.9 * uv.y * uv.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

/** Streaks of ice and cold light shooting up an open tube, ragged at its
 *  top, brightest at its root, clear where it faces the eye (she stays seen
 *  through it). */
const GEYSER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uTop;
  varying vec2 vUv;
  varying float vFacing;
  ${HEAT_NOISE_GLSL}
  void main() {
    float h = vUv.y;
    vec2 q = vec2(vUv.x * 14.0, h * 5.0 - uTime * 9.0);
    float n = vn(q) * 0.6 + vn(q * 2.3 + 4.1) * 0.4;
    float streak = smoothstep(0.55 + 0.2 * h, 0.95, n + (1.0 - h) * 0.22);
    float top = 1.0 - smoothstep(uTop - 0.25, uTop, h + (n - 0.5) * 0.25);
    float rim = 1.0 - vFacing;
    float k = streak * top * (0.15 + 0.85 * rim * rim) * (1.0 - 0.55 * h);
    vec3 col = mix(vec3(0.1, 0.42, 1.0), vec3(0.75, 0.95, 1.0), streak * (1.0 - h) * 0.8);
    gl_FragColor = vec4(col, k * uAlpha);
  }
`;

// ---- the particles' options (written in place where they aim) ------------------------------

const _dir: [number, number, number] = [0, 1, 0];
const MIST = {
  speed: 0.6,
  up: 0.15,
  life: 5,
  size: [2.4, 7.5] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.13,
  drag: 0.5,
  floor: -1e6,
};
const SNOW = {
  speed: 0.6,
  up: -2.2,
  life: P.snowLife,
  size: [0.34, 0.26] as [number, number],
  color: C.snow as readonly [number, number, number],
  alpha: 0.95,
  drag: 0.25,
  dir: _dir,
  spread: 0.5,
  floor: -1e6,
};
const BREATH = {
  speed: 0.35,
  up: 0.55,
  life: 3.2,
  size: [0.6, 3.2] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.2,
  radius: 0.4,
  drag: 0.5,
  floor: -1e6,
};
const MOTE = {
  speed: 0.4,
  up: 2.6,
  life: 1.6,
  size: [0.3, 0.05] as [number, number],
  color: C.glitter as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 0.6,
  drag: 0.5,
  floor: -1e6,
};
const SHARDS = {
  speed: 18,
  up: 16,
  life: 2,
  size: [0.95, 0.2] as [number, number],
  color: C.shard as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 3,
  drag: 0.4,
  gravity: 16,
  floor: -1e6,
};
const POWDER = {
  speed: 9,
  up: 4,
  life: 2.6,
  size: [2.5, 9] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.28,
  radius: 3.5,
  drag: 1.1,
  floor: -1e6,
};
const ROLL = {
  speed: 13,
  up: 0.4,
  life: 3.4,
  size: [5, 17] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.5,
  dir: _dir,
  spread: 0.18,
  drag: 1.3,
  floor: -1e6,
};
const DEBRIS = {
  speed: 15,
  up: 20,
  life: 3,
  size: [0.42, 0.3] as [number, number],
  color: C.snow as readonly [number, number, number],
  alpha: 0.95,
  radius: 3,
  drag: 0.35,
  gravity: 14,
  floor: -1e6,
};
const VAPOR = {
  speed: 0.5,
  up: 1.1,
  life: 1.6,
  size: [0.7, 3] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.32,
  radius: 0.3,
  drag: 0.6,
  floor: -1e6,
};
const VAPOR_GLINT = {
  speed: 0.6,
  up: 1.6,
  life: 1.1,
  size: [0.3, 0.05] as [number, number],
  color: C.glitter as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 0.25,
  drag: 0.5,
  floor: -1e6,
};
const SPRAY = {
  speed: 3.5,
  up: 3.2,
  life: 1.3,
  size: [1.8, 5.5] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.42,
  dir: _dir,
  spread: 0.4,
  drag: 1.4,
  floor: -1e6,
};
const SPRAY_GLINT = {
  speed: 5,
  up: 4,
  life: 0.9,
  size: [0.4, 0.08] as [number, number],
  color: C.shard as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  dir: _dir,
  spread: 0.45,
  drag: 0.6,
  gravity: 6,
  floor: -1e6,
};
const BLADE_TRAIL = {
  speed: 0.5,
  up: -0.4,
  life: 1.2,
  size: [0.32, 0.05] as [number, number],
  color: C.glitter as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 0.3,
  drag: 0.6,
  floor: -1e6,
};
const BURST = {
  speed: 7,
  up: 3,
  life: 0.7,
  size: [0.5, 0.08] as [number, number],
  color: C.shard as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 0.5,
  drag: 0.8,
  gravity: 6,
  floor: -1e6,
};

// ---- scratch -------------------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);
const _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _chunk: ChunkState = newChunkState();
const _slab = newSlabState();

/** A strip pair per point of each line (`aReveal`, `aSide`), its places laid
 *  on the floor at the placing (layWeb). */
function webGeometry(lines: readonly (readonly WebPoint[])[], count: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const reveal = new Float32Array(count);
  const side = new Float32Array(count);
  const index: number[] = [];
  let v = 0;
  for (const line of lines) {
    for (let k = 0; k < line.length; k++) {
      reveal[v] = line[k].reveal;
      reveal[v + 1] = line[k].reveal;
      side[v] = -1;
      side[v + 1] = 1;
      if (k > 0) index.push(v - 2, v - 1, v, v - 1, v + 1, v);
      v += 2;
    }
  }
  geo.setAttribute('aReveal', new THREE.BufferAttribute(reveal, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(index);
  return geo;
}

/** A conjured blade: the profile's rings as flat-diamond sections joined
 *  facet to facet (flat shaded), `aH` its height share for the light. */
function bladeGeometry(): THREE.BufferGeometry {
  const prof = ENTRANCE_BLADE_PROFILE;
  const L = B.length;
  const pos: number[] = [];
  const h: number[] = [];
  const core: number[] = [];
  // Eight corners a ring: the keen edges, the bevels, the raised ridge down
  // each face (a fuller in crystal), so every facet catches the light. Each
  // corner's share out from the ridge (0) to the edge (1).
  const SHARE = [1, 0.62, 0, 0.62, 1, 0.62, 0, 0.62];
  const ring = (r: (typeof prof)[number]): [number, number, number][] => [
    [r.w, r.y, 0],
    [r.w * 0.55, r.y, r.d * 0.62],
    [0, r.y, r.d],
    [-r.w * 0.55, r.y, r.d * 0.62],
    [-r.w, r.y, 0],
    [-r.w * 0.55, r.y, -r.d * 0.62],
    [0, r.y, -r.d],
    [r.w * 0.55, r.y, -r.d * 0.62],
  ];
  const TRI: readonly [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
    [1, 1],
    [0, 1],
  ];
  for (let i = 1; i < prof.length; i++) {
    const a = ring(prof[i - 1]);
    const b = ring(prof[i]);
    for (let k = 0; k < 8; k++) {
      for (const [row, step] of TRI) {
        const c = (k + step) % 8;
        const p = row === 0 ? a[c] : b[c];
        pos.push(p[0], p[1], p[2]);
        h.push(p[1] / L);
        core.push(SHARE[c]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  geo.setAttribute('aCore', new THREE.Float32BufferAttribute(core, 1));
  geo.computeVertexNormals();
  return geo;
}

/** A plate of lake ice heaved up at the breach: a ragged seven-sided slab,
 *  flat shaded, its inner edge at its origin (the painter tips it up about
 *  that edge). */
function slabGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 0.88, 1, 7, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const k = 1 + (quenchEntranceHash(Math.round(Math.atan2(z, x) * 100), 9) - 0.5) * 0.45;
    pos.setX(i, x * k);
    pos.setZ(i, z * k + 1);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  flat.setAttribute(
    'aH',
    new THREE.Float32BufferAttribute(
      new Float32Array(flat.getAttribute('position').count).fill(0.5),
      1,
    ),
  );
  return flat;
}

/** The sheet over her: a flattened ball of faceted lake ice (its lower half
 *  under the floor), each corner nudged by a hash of its place so the shared
 *  corners of neighbouring facets move together (no seams), flat shaded so
 *  every facet catches the light on its own. */
function sheetGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = Math.round(x * 997) * 31 + Math.round(y * 991) * 17 + Math.round(z * 983);
    const k = 1 + (quenchEntranceHash(key, 5) - 0.5) * 0.16;
    // A flat crown (the top pressed down): a slab, not a dome.
    const yy = y > 0 ? y * (0.75 + 0.25 * (1 - y)) : y;
    pos.setXYZ(i, x * k, yy * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

export class QuenchEntranceFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** Everything drawn sits under this, placed on her and turned to her
   *  facing (her frame: +z ahead of her, toward the raid). */
  private readonly stage = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly frost: THREE.Mesh;
  private readonly frostMat: THREE.ShaderMaterial;
  private readonly webGeo: THREE.BufferGeometry;
  private readonly web: THREE.Mesh;
  private readonly webMat: THREE.ShaderMaterial;
  private readonly under: THREE.Mesh;
  private readonly underMat: THREE.ShaderMaterial;
  private readonly sheet: THREE.Mesh;
  private readonly sheetMat: THREE.ShaderMaterial;
  private readonly chunks: THREE.InstancedMesh;
  private readonly chunkCount: number;
  private readonly blades: THREE.InstancedMesh;
  private readonly slabs: THREE.InstancedMesh;
  private readonly stars: THREE.InstancedMesh;
  private readonly band: THREE.Mesh;
  private readonly bandMat: THREE.ShaderMaterial;
  private readonly geyserCore: THREE.Mesh;
  private readonly geyserCoreMat: THREE.ShaderMaterial;
  private readonly halos: THREE.InstancedMesh;
  private readonly flash: THREE.Mesh;
  private readonly flashMat: THREE.ShaderMaterial;
  private readonly geyser: THREE.Mesh;
  private readonly geyserMat: THREE.ShaderMaterial;
  private readonly look = newQuenchEntranceLook();
  private readonly clockRead: QuenchEntranceClock = { stage: 'none', t: 0 };
  /** The player each blade points at (entity id; -1: none, her facing). */
  private readonly marks = new Int32Array(B.count).fill(-1);
  private entityId = -1;
  private rosterSeen = Number.NaN;
  /** Where the stage sits (world) and her facing it was laid for. */
  private placedX = Number.NaN;
  private placedZ = Number.NaN;
  private placedYaw = Number.NaN;
  private stageY = 0;
  private time = AWAKE;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x51ce;
  private breathIn = 0;
  private resendIn = 0;
  private stanceSent: QuenchEntranceStance | null = null;
  private dimming = false;
  /** The scene was cut short before the breach: no blades. */
  private cut = false;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'smith-heart-quench-entrance';
    setRenderCategory(this.root, 'ui3d');
    this.stage.name = 'smithHeartQuenchEntranceStage';
    this.stage.visible = false;
    this.root.add(this.stage);
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : QUENCH_ENTRANCE_LOW_SHARE;
    this.particles = new EngineParticles(
      this.stage,
      this.uTime,
      this.density,
      (x, z) => this.floorAt(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      null,
    );

    // ---- the frost ----
    const disc = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    this.frostMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceFrost',
      uniforms: { uReach: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: FLOOR_VERT,
      fragmentShader: FROST_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials.push(this.frostMat);
    // The disc in yards (its shader reads its own local yards).
    const frostGeo = new THREE.CircleGeometry(FROST_REACH + 4, 120).rotateX(-Math.PI / 2);
    this.geometries.push(frostGeo);
    this.frost = new THREE.Mesh(frostGeo, this.frostMat);
    this.frost.name = 'smithHeartQuenchEntranceFrost';
    this.frost.frustumCulled = false;
    this.frost.visible = false;
    this.frost.renderOrder = floorVfxRenderOrder('encounter', 2);
    this.stage.add(this.frost);

    // ---- the web: a dark fracture and the light through it ----
    this.webGeo = webGeometry(ENTRANCE_WEB, WEB_VERTICES);
    this.geometries.push(this.webGeo);
    const web = moltenDecal(
      {
        name: 'smithHeartQuenchEntranceWeb',
        geometry: this.webGeo,
        vertexShader: STRIP_VERT,
        fragmentShader: WEB_FRAG,
        uniforms: { uGrow: { value: 0 }, uGlow: { value: 0 }, uTime: this.uTime },
        charStep: 3,
        glowStep: 10,
      },
      this.materials,
    );
    this.web = web.mesh;
    this.webMat = web.mat;
    this.stage.add(this.web);

    // ---- the light under her ----
    this.underMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceUnder',
      uniforms: { uUnder: { value: 0 }, uTime: this.uTime },
      vertexShader: FLOOR_VERT,
      fragmentShader: UNDER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.materials.push(this.underMat);
    this.under = new THREE.Mesh(disc, this.underMat);
    this.under.name = 'smithHeartQuenchEntranceUnder';
    this.under.frustumCulled = false;
    this.under.visible = false;
    this.under.renderOrder = floorVfxRenderOrder('encounter', 11);
    this.stage.add(this.under);

    // ---- the sheet over her ----
    const dome = sheetGeometry();
    this.geometries.push(dome);
    this.sheetMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceSheet',
      uniforms: {
        uAlpha: { value: 1 },
        uCrack: { value: 0 },
        uUnder: { value: 0 },
        uTremble: { value: 0 },
        uTime: this.uTime,
        uSize: { value: new THREE.Vector2(QUENCH_SHEET.halfWidth, QUENCH_SHEET.halfLength) },
      },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(this.sheetMat);
    this.sheet = new THREE.Mesh(dome, this.sheetMat);
    this.sheet.name = 'smithHeartQuenchEntranceSheet';
    this.sheet.frustumCulled = false;
    this.sheet.visible = false;
    this.sheet.scale.set(QUENCH_SHEET.halfWidth, QUENCH_SHEET.height, QUENCH_SHEET.halfLength);
    this.sheet.position.set(0, 0, QUENCH_SHEET.z);
    this.stage.add(this.sheet);

    // ---- the sheet's chunks and the blades: crystal ice ----
    const iceMat = (name: string, core: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uCore: { value: core } },
        vertexShader: ICE_VERT,
        fragmentShader: ICE_FRAG,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      });
      this.materials.push(m);
      return m;
    };
    const chunkGeo = new THREE.OctahedronGeometry(1, 0);
    chunkGeo.scale(0.55, 1.6, 0.3);
    chunkGeo.setAttribute(
      'aH',
      new THREE.Float32BufferAttribute(
        new Float32Array(chunkGeo.getAttribute('position').count).fill(0.5),
        1,
      ),
    );
    this.geometries.push(chunkGeo);
    this.chunkCount = Math.max(12, Math.round(P.chunks * this.density));
    this.chunks = new THREE.InstancedMesh(
      chunkGeo,
      iceMat('smithHeartQuenchEntranceChunks', 0.25),
      this.chunkCount,
    );
    this.chunks.name = 'smithHeartQuenchEntranceChunks';
    this.chunks.frustumCulled = false;
    this.chunks.visible = false;
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.chunkCount; i++) {
      this.chunks.setMatrixAt(i, _zero);
      this.chunks.setColorAt(i, _c.setRGB(0.6, 0.6, 0.6));
    }
    this.stage.add(this.chunks);
    // The great plates heaved up round her (the chunks' ice; every tier
    // heaves every plate: they are the breach itself, not a particle).
    const slabGeo = slabGeometry();
    this.geometries.push(slabGeo);
    this.slabs = new THREE.InstancedMesh(slabGeo, this.chunks.material, P.slabs);
    this.slabs.name = 'smithHeartQuenchEntranceSlabs';
    this.slabs.frustumCulled = false;
    this.slabs.visible = false;
    this.slabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.slabs; i++) {
      this.slabs.setMatrixAt(i, _zero);
      this.slabs.setColorAt(i, _c.setRGB(0.4, 0.4, 0.4));
    }
    this.stage.add(this.slabs);
    const bladeGeo = bladeGeometry();
    this.geometries.push(bladeGeo);
    const bladeMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceBlades',
      uniforms: { uTime: this.uTime },
      vertexShader: BLADE_VERT,
      fragmentShader: BLADE_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(bladeMat);
    this.blades = new THREE.InstancedMesh(bladeGeo, bladeMat, B.count);
    // Each blade's star of cracks where it breaks out of the ice.
    const starGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(starGeo);
    const starMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceBladeCracks',
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.materials.push(starMat);
    this.stars = new THREE.InstancedMesh(starGeo, starMat, B.count);
    this.stars.name = 'smithHeartQuenchEntranceBladeCracks';
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    this.stars.renderOrder = floorVfxRenderOrder('encounter', 12);
    this.stars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < B.count; i++) {
      this.stars.setMatrixAt(i, _zero);
      this.stars.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    if (this.stars.instanceColor) this.stars.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.stage.add(this.stars);
    // The shockwave's frosted edge on the floor.
    const bandGeo = new THREE.RingGeometry(0.84, 1, 160, 1).rotateX(-Math.PI / 2);
    this.geometries.push(bandGeo);
    this.bandMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceShockEdge',
      uniforms: { uAlpha: { value: 0 }, uTime: this.uTime },
      vertexShader: FLOOR_VERT,
      fragmentShader: BAND_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.materials.push(this.bandMat);
    this.band = new THREE.Mesh(bandGeo, this.bandMat);
    this.band.name = 'smithHeartQuenchEntranceShockEdge';
    this.band.frustumCulled = false;
    this.band.visible = false;
    this.band.renderOrder = floorVfxRenderOrder('encounter', 13);
    this.stage.add(this.band);
    this.blades.name = 'smithHeartQuenchEntranceBlades';
    this.blades.frustumCulled = false;
    this.blades.visible = false;
    this.blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < B.count; i++) {
      this.blades.setMatrixAt(i, _zero);
      this.blades.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    if (this.blades.instanceColor) this.blades.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.stage.add(this.blades);

    // ---- light: the blades' halos (one instanced draw), the breach's burst ----
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(quad);
    const glowMat = (name: string, color: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      });
      this.materials.push(m);
      return m;
    };
    this.halos = new THREE.InstancedMesh(
      quad,
      glowMat('smithHeartQuenchEntranceHalos', C.ring),
      HALOS,
    );
    this.halos.name = 'smithHeartQuenchEntranceHalos';
    this.halos.frustumCulled = false;
    this.halos.visible = false;
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < HALOS; i++) {
      this.halos.setMatrixAt(i, _zero);
      this.halos.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    if (this.halos.instanceColor) this.halos.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.stage.add(this.halos);
    this.flashMat = glowMat('smithHeartQuenchEntranceBurst', C.flash);
    this.flash = new THREE.Mesh(quad, this.flashMat);
    this.flash.name = 'smithHeartQuenchEntranceBurst';
    this.flash.frustumCulled = false;
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.stage.add(this.flash);

    // ---- the breach's geyser ----
    const tube = new THREE.CylinderGeometry(1, 1, 1, 48, 10, true).translate(0, 0.5, 0);
    this.geometries.push(tube);
    this.geyserMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceGeyser',
      uniforms: { uTime: this.uTime, uAlpha: { value: 0 }, uTop: { value: 1 } },
      vertexShader: GEYSER_VERT,
      fragmentShader: GEYSER_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(this.geyserMat);
    this.geyser = new THREE.Mesh(tube, this.geyserMat);
    this.geyser.name = 'smithHeartQuenchEntranceGeyser';
    this.geyser.frustumCulled = false;
    this.geyser.visible = false;
    this.stage.add(this.geyser);
    // Its white-hot core: the same streaks, narrower and brighter (its own
    // material on the same program).
    this.geyserCoreMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEntranceGeyserCore',
      uniforms: { uTime: this.uTime, uAlpha: { value: 0 }, uTop: { value: 1 } },
      vertexShader: GEYSER_VERT,
      fragmentShader: GEYSER_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(this.geyserCoreMat);
    this.geyserCore = new THREE.Mesh(tube, this.geyserCoreMat);
    this.geyserCore.name = 'smithHeartQuenchEntranceGeyserCore';
    this.geyserCore.frustumCulled = false;
    this.geyserCore.visible = false;
    this.stage.add(this.geyserCore);

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** The floor's height under a stage-local point, off the stage's own. */
  private floorAt(x: number, z: number): number {
    const yaw = this.stage.rotation.y;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const wx = this.stage.position.x + x * c + z * s;
    const wz = this.stage.position.z - x * s + z * c;
    return this.groundY(wx, wz) - this.stageY;
  }

  /** The entrance's look for its guardian (tests read it). */
  get currentLook() {
    return this.look;
  }

  /** The player each blade points at (tests read it). */
  get bladeMarks(): Int32Array {
    return this.marks;
  }

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
    const e = this.entityId >= 0 ? world.entities.get(this.entityId) : undefined;
    if (!e) {
      if (this.entityId >= 0) this.release();
      return;
    }
    const prev = this.time;
    const read = e.dead ? null : quenchEntranceClock(e.auras, this.clockRead);
    // Cut short before the breach (a forced pull): she breaks out, but her
    // blades stay under the ice (never pointed at players in a live fight).
    if (read?.stage === 'frozen') this.cut = false;
    else if (read?.stage === 'none' && prev >= 0 && prev < E.breachAt) this.cut = true;
    this.time = e.dead ? AWAKE : stepQuenchEntranceTime(prev, dt, this.clockRead);
    const look = quenchEntranceLook(this.time, this.look);
    holdQuenchEntrance(e.id, look);
    this.stance(e, look, prev, dt);
    if (!look.active) {
      if (this.stage.visible) this.hideStage();
      // The next scene lays its stage afresh where she lies then.
      this.placedX = Number.NaN;
      this.cut = false;
      return;
    }
    this.place(e);
    this.stage.visible = true;
    this.paint(e, prev, dt);
    this.particles.update(this.clock);
  }

  // ---- the scan ------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    if (this.entityId >= 0 && !world.entities.has(this.entityId)) this.release();
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.entityId >= 0) this.release();
      this.rosterSeen = Number.NaN;
      return;
    }
    if (this.entityId >= 0) return;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== QUENCH_GUARDIAN) continue;
      this.entityId = e.id;
      this.time = AWAKE;
      this.stanceSent = null;
      this.cut = false;
      break;
    }
  }

  private release(): void {
    // A view that saw her lie down stands her back up before forgetting her.
    if (this.entityId >= 0 && (this.stanceSent === 'frozen' || this.stanceSent === 'emerge'))
      this.playGesture?.(this.entityId, QUENCH_BODY_GESTURES.stand);
    if (this.entityId >= 0) holdQuenchEntrance(this.entityId, null);
    this.placedX = Number.NaN;
    this.entityId = -1;
    this.rosterSeen = Number.NaN;
    this.time = AWAKE;
    this.stanceSent = null;
    this.dimming = false;
    this.hideStage();
  }

  private hideStage(): void {
    this.stage.visible = false;
    this.flash.visible = false;
    this.geyser.visible = false;
    this.geyserCore.visible = false;
    this.band.visible = false;
    this.slabs.visible = false;
    this.stars.visible = false;
    this.particles.hideRings();
  }

  // ---- her stance --------------------------------------------------------------------------

  /** Her rig's stance and her dim, sent through the gesture seam: lying frozen
   *  (re-sent, so a rebuilt view lies down again), the Emerge one-shot once
   *  on the breach for a scene seen crossing it (a late joiner past the breach
   *  simply stands), standing once the scene is gone; the dim pulse re-sent
   *  while she lies under the ice, her light flaring back as she breaks out. */
  private stance(e: Entity, look: QuenchEntranceLook, prev: number, dt: number): void {
    if (!this.playGesture || e.dead) return;
    const G = QUENCH_BODY_GESTURES;
    this.resendIn -= dt;
    const resend = this.resendIn <= 0;
    if (resend) this.resendIn = RESEND_SEC;
    let want: QuenchEntranceStance = look.active ? look.stance : 'stand';
    // A breach never seen crossing (joined after it): stand, no replayed rise.
    if (
      want === 'emerge' &&
      this.stanceSent !== 'emerge' &&
      !crossedQuenchBeat(prev, this.time, E.breachAt)
    )
      want = 'stand';
    if (want !== this.stanceSent) {
      // Never awake a guardian nobody has seen frozen: the stance is the rig's
      // own default then.
      if (!(want === 'stand' && this.stanceSent === null)) {
        this.playGesture(
          e.id,
          want === 'frozen' ? G.frozen : want === 'emerge' ? G.emerge : G.stand,
        );
        if (want === 'emerge') this.playGesture(e.id, G.flare);
      }
      this.stanceSent = want;
    } else if (resend && want === 'frozen') this.playGesture(e.id, G.frozen);
    if (look.active && look.dim) {
      if (resend || !this.dimming) this.playGesture(e.id, G.frozenDim);
      this.dimming = true;
    } else this.dimming = false;
  }

  // ---- the stage ---------------------------------------------------------------------------

  /** Stand the stage on her, turned to her facing; the web laid on the floor
   *  under it (once per place). */
  private place(e: Entity): void {
    // Laid once per scene: the web, the frost and the air stay where they
    // were laid if she moves or turns in the scene's tail.
    if (!Number.isNaN(this.placedX)) return;
    const at = fxAnchor(e);
    const yaw = e.facing;
    this.placedX = at.x;
    this.placedZ = at.z;
    this.placedYaw = yaw;
    this.stageY = this.groundY(at.x, at.z);
    this.stage.position.set(at.x, this.stageY, at.z);
    this.stage.rotation.set(0, yaw, 0);
    this.stage.updateMatrixWorld();
    const pos = this.webGeo.getAttribute('position') as THREE.BufferAttribute;
    let v = 0;
    for (const line of ENTRANCE_WEB) {
      for (let k = 0; k < line.length; k++) {
        const a = line[Math.max(0, k - 1)];
        const b = line[Math.min(line.length - 1, k + 1)];
        let nx = -(b.z - a.z);
        let nz = b.x - a.x;
        const m = Math.hypot(nx, nz) || 1;
        nx /= m;
        nz /= m;
        const p = line[k];
        const w = p.half * 1.9;
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const x = p.x + nx * w * sgn;
          const z = p.z + nz * w * sgn;
          pos.setXYZ(v++, x, this.floorAt(x, z) + 0.06, z);
        }
      }
    }
    pos.needsUpdate = true;
    this.webGeo.computeBoundingSphere();
    this.frost.position.set(0, this.floorAt(0, 0) + 0.04, 0);
    this.under.position.set(0, this.floorAt(0, QUENCH_SHEET.z) + 0.08, QUENCH_SHEET.z);
  }

  // ---- the paint -----------------------------------------------------------------------------

  private paint(e: Entity, prev: number, dt: number): void {
    const L = this.look;
    const d = this.density;
    const t = this.time;
    // The frost.
    this.frost.visible = L.frostAlpha > 0.01;
    this.frostMat.uniforms.uReach.value = L.frost * FROST_REACH;
    this.frostMat.uniforms.uAlpha.value = L.frostAlpha;
    // The web.
    this.webMat.uniforms.uGrow.value = L.web;
    this.webMat.uniforms.uGlow.value = L.webGlow;
    this.web.visible = L.web > 0.001 && L.webGlow > 0.01;
    // The light under her.
    this.under.visible = L.under > 0.01;
    this.under.scale.setScalar(QUENCH_SHEET.halfLength * 1.6);
    this.underMat.uniforms.uUnder.value = Math.min(this.reducedMotion() ? 1 : 1.6, L.under);
    // The sheet.
    this.sheet.visible = L.sheet > 0.01;
    const su = this.sheetMat.uniforms;
    su.uAlpha.value = L.sheet;
    su.uCrack.value = L.sheetCrack;
    su.uUnder.value = L.under;
    // Reduced motion: no shudder, and the breach's additive light capped.
    const calm = this.reducedMotion();
    su.uTremble.value = calm ? 0 : L.tremble;
    // The cold air: mist, snow, the frost breath, the motes off the web.
    this.air(L, dt, d);
    // The breach.
    if (crossedQuenchBeat(prev, t, E.breachAt)) this.breach(e);
    this.paintChunks(L.sinceBreach);
    // The shockwave's spray: powder snow and shards thrown up along its
    // front as it races out over the raid.
    if (L.ring > 0.02) {
      let n = dt * P.sprayRate * L.ring * d;
      while (n > 0) {
        if (n < 1 && this.rand() > n) break;
        n -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = L.ringR * (0.97 + 0.06 * this.rand());
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        _dir[0] = Math.sin(a) * 0.6;
        _dir[1] = 1;
        _dir[2] = Math.cos(a) * 0.6;
        const glint = this.rand() < 0.35;
        this.particles.puff(x, this.floorAt(x, z) + 0.2, z, 1, glint ? SPRAY_GLINT : SPRAY);
      }
    }
    // The geyser.
    this.geyser.visible = L.geyser > 0.01;
    if (this.geyser.visible) {
      const r = E.geyserRadius;
      this.geyser.scale.set(r, Math.max(0.2, E.geyserHeight * L.geyserH), r);
      this.geyser.position.set(0, -0.3, QUENCH_SHEET.z * 0.5);
      this.geyserMat.uniforms.uAlpha.value = (this.reducedMotion() ? 0.7 : 1.6) * L.geyser;
      this.geyserMat.uniforms.uTop.value = 0.9 + 0.1 * L.geyserH;
    }
    // Reduced motion: the white-hot core goes (the outer geyser is capped).
    this.geyserCore.visible = this.geyser.visible && !this.reducedMotion();
    if (this.geyserCore.visible) {
      const r = E.geyserRadius * 0.42;
      this.geyserCore.scale.set(r, Math.max(0.2, E.geyserHeight * 0.85 * L.geyserH), r);
      this.geyserCore.position.copy(this.geyser.position);
      this.geyserCoreMat.uniforms.uAlpha.value = 2.4 * L.geyser * L.geyser;
      this.geyserCoreMat.uniforms.uTop.value = 0.85 + 0.15 * L.geyserH;
    }
    this.band.visible = L.ring > 0.01;
    if (this.band.visible) {
      this.band.scale.setScalar(L.ringR);
      this.band.position.set(0, this.floorAt(0, 0) + 0.1, 0);
      this.bandMat.uniforms.uAlpha.value = (this.reducedMotion() ? 0.4 : 1) * L.ring;
    }
    this.paintSlabs(L.sinceBreach);
    if (L.sinceBreach >= 0 && L.sinceBreach < 4.5) this.vapor(L.sinceBreach, dt);
    const flash = quenchEntranceFlash(L, this.reducedMotion());
    this.flash.visible = flash > 0.002;
    if (this.flash.visible) {
      this.flash.position.set(0, 3.5, QUENCH_SHEET.z * 0.5);
      this.flash.scale.setScalar(E.flashSize * (0.7 + 0.3 * flash));
      this.flashMat.uniforms.uAlpha.value = flash;
    }
    // The blades.
    if (!this.cut && crossedQuenchBeat(prev, t, E.pointAt)) this.pickMarks(e);
    this.paintBlades(e, prev, t, dt);
    // The sounds, each on its beat for a scene seen crossing it.
    for (let si = 0; si < QUENCH_ENTRANCE_SOUNDS.length; si++) {
      const s = QUENCH_ENTRANCE_SOUNDS[si];
      // A cut-short scene: no blades, so none of their sounds, and only the
      // breach's own sounds of the beats its jump crossed.
      if (this.cut && (s.at >= E.bladesAt || s.at < E.breachAt)) continue;
      if (!crossedQuenchBeat(prev, t, s.at)) continue;
      sfx.playAt(s.key, e.pos.x, e.pos.y + 1, e.pos.z, {
        gain: s.gain,
        rate: s.rate,
        cooldown: 0.05,
        jitter: false,
        priority: true,
      });
    }
  }

  private air(L: QuenchEntranceLook, dt: number, d: number): void {
    const p = this.particles;
    // Mist off the ice round her.
    let n = dt * P.mistRate * L.mist * d;
    while (n > 0) {
      if (n < 1 && this.rand() > n) break;
      n -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = 2 + Math.sqrt(this.rand()) * FROST_REACH * Math.max(0.35, L.frost);
      p.puff(Math.sin(a) * r, 0.4, Math.cos(a) * r, 1, MIST);
    }
    // Snow over the lake, driven sideways as it thickens into a flurry.
    const flurry = Math.max(0, L.snow - 1);
    _dir[0] = 0.45 + 1.3 * flurry;
    _dir[1] = -1;
    _dir[2] = 0.2 + 0.5 * flurry;
    n = dt * P.snowRate * L.snow * d;
    while (n > 0) {
      if (n < 1 && this.rand() > n) break;
      n -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * P.snowReach;
      p.puff(Math.sin(a) * r, P.snowHeight * (0.45 + 0.55 * this.rand()), Math.cos(a) * r, 1, SNOW);
    }
    // The frost breath off the sheet over her mouth.
    if (L.breath > 0) {
      this.breathIn -= dt;
      if (this.breathIn <= 0) {
        this.breathIn = P.breathEvery;
        const set = quenchBodySockets();
        const m = set?.points[S_MOUTH];
        let x: number = QUENCH_SHEET_MOUTH.x;
        let z: number = QUENCH_SHEET_MOUTH.z;
        if (m) {
          m.getWorldPosition(_v);
          this.stage.worldToLocal(_v);
          x = _v.x;
          z = _v.z;
        }
        p.puff(x, QUENCH_SHEET.height * 0.85, z, 4, BREATH);
      }
    }
    // Motes of light rising off the web's cracks.
    if (L.webGlow > 0.05 && L.web > 0.02) {
      n = dt * P.moteRate * Math.min(1.6, L.webGlow) * d;
      while (n > 0) {
        if (n < 1 && this.rand() > n) break;
        n -= 1;
        const line = ENTRANCE_WEB[Math.floor(this.rand() * ENTRANCE_WEB.length)];
        const pt = line[Math.floor(this.rand() * line.length)];
        if (pt.reveal > L.web) continue;
        p.puff(pt.x, this.floorAt(pt.x, pt.z) + 0.15, pt.z, 1, MOTE);
      }
    }
  }

  /** The breach: the sheet bursting, shards and powder flung, the floor's
   *  wave, her own light flaring back, the camera's thud. */
  private breach(e: Entity): void {
    const p = this.particles;
    const z = QUENCH_SHEET.z;
    p.puff(0, 1.2, z, Math.round(P.shardBurst * this.density) + 12, SHARDS);
    p.puff(0, 0.8, z, Math.round(26 * this.density) + 6, POWDER);
    p.puff(0, 2, z, Math.round(P.debrisBurst * this.density) + 10, DEBRIS);
    // A thick frost mist rolling out over the lake from the hole.
    const n = Math.round(P.mistBurst * this.density * (this.reducedMotion() ? 0.5 : 1)) + 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.3;
      _dir[0] = Math.sin(a);
      _dir[1] = 0.05;
      _dir[2] = Math.cos(a);
      p.puff(Math.sin(a) * 3, 0.6, z + Math.cos(a) * 3, 1, ROLL);
    }
    p.shockRing(0, 0, C.ring, E.ringTo, E.ringFor, { wake: 0.08, crest: 0.07, strength: 1 });
    const me = this.world?.entities.get(this.world.playerId);
    if (!this.shakeSink || !me) return;
    const amount = quenchEntranceShake(
      Math.hypot(me.pos.x - e.pos.x, me.pos.z - e.pos.z),
      this.reducedMotion(),
    );
    if (amount > 0) this.shakeSink(amount);
  }

  /** The great plates heaved up round her: tipped up out of the lake,
   *  turned outward, the outer ones flung and tumbling, all sinking back. */
  private paintSlabs(since: number): void {
    const live = since >= 0 && since < SLAB.stand + SLAB.sink + 1.2;
    this.slabs.visible = live;
    if (!live) return;
    for (let i = 0; i < P.slabs; i++) {
      heavedSlabAt(i, since, _slab);
      if (_slab.w <= 0) {
        this.slabs.setMatrixAt(i, _zero);
        continue;
      }
      // Turned to its bearing, then tipped up outward about its inner edge,
      // then its tumble.
      _q.setFromAxisAngle(_up, _slab.yaw);
      _axis.set(1, 0, 0);
      _q2.setFromAxisAngle(_axis, -_slab.tilt - _slab.tumble);
      _q.multiply(_q2);
      _p.set(_slab.x, this.floorAt(_slab.x, _slab.z) + _slab.y, _slab.z);
      _s.set(_slab.w, _slab.t, _slab.d);
      _m.compose(_p, _q, _s);
      this.slabs.setMatrixAt(i, _m);
    }
    this.slabs.instanceMatrix.needsUpdate = true;
  }

  /** Frost streaming off her as she rises through the wreck: cold vapour
   *  and glints off her body's points. */
  private vapor(since: number, dt: number): void {
    const set = quenchBodySockets();
    const pts = set?.points;
    const k = 1 - since / 4.5;
    let n = dt * 46 * k * this.density * (this.reducedMotion() ? 0.5 : 1);
    while (n > 0) {
      if (n < 1 && this.rand() > n) break;
      n -= 1;
      const pt = pts ? pts[Math.floor(this.rand() * pts.length)] : null;
      if (pt) {
        pt.getWorldPosition(_v);
        this.stage.worldToLocal(_v);
      } else _v.set((this.rand() - 0.5) * 3, 1 + this.rand() * 9, (this.rand() - 0.5) * 3);
      this.particles.puff(_v.x, _v.y, _v.z, 1, this.rand() < 0.3 ? VAPOR_GLINT : VAPOR);
    }
  }

  private paintChunks(since: number): void {
    const live = since >= 0 && since < CHUNK_LIFE + 0.1;
    this.chunks.visible = live;
    if (!live) return;
    for (let i = 0; i < this.chunkCount; i++) {
      // The low tier keeps every k-th chunk (the fountain stays whole).
      const src = Math.floor((i * P.chunks) / this.chunkCount);
      sheetChunkAt(src, since, _chunk);
      if (_chunk.size <= 0) {
        this.chunks.setMatrixAt(i, _zero);
        continue;
      }
      _axis.set(_chunk.ax, _chunk.ay, _chunk.az);
      _q.setFromAxisAngle(_axis, _chunk.spin);
      _p.set(_chunk.x, this.floorAt(_chunk.x, _chunk.z) + _chunk.y, _chunk.z);
      _s.setScalar(_chunk.size);
      _m.compose(_p, _q, _s);
      this.chunks.setMatrixAt(i, _m);
    }
    this.chunks.instanceMatrix.needsUpdate = true;
  }

  /** Each blade a mark of the raid (living players near her, by id), so the
   *  six points spread over who stands before her; none near: her facing. */
  private pickMarks(e: Entity): void {
    this.marks.fill(-1);
    const world = this.world;
    if (!world) return;
    const ids: number[] = this.markScratch;
    ids.length = 0;
    for (const p of world.entities.values()) {
      if (p.kind !== 'player' || p.dead) continue;
      if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) > 70) continue;
      ids.push(p.id);
    }
    ids.sort((a, b) => a - b);
    const n = ids.length;
    if (n === 0) return;
    for (let i = 0; i < B.count; i++) this.marks[i] = ids[i % n];
  }

  private readonly markScratch: number[] = [];

  private paintBlades(e: Entity, prev: number, t: number, dt: number): void {
    const L = this.look;
    let any = false;
    let stars = false;
    const world = this.world;
    const yaw = this.stage.rotation.y;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    for (let i = 0; i < B.count; i++) {
      const b = L.blades[i];
      if (!b.shown || this.cut) {
        this.blades.setMatrixAt(i, _zero);
        this.halos.setMatrixAt(i, _zero);
        this.halos.setMatrixAt(TIP0 + i, _zero);
        this.stars.setMatrixAt(i, _zero);
        continue;
      }
      any = true;
      // Its place round her: spiralling out to the ring as it bursts up out
      // of the ice point first, then hovering with a slow bob.
      const ringR = B.ring * b.reach;
      const bx = Math.sin(b.bearing) * ringR;
      const bz = Math.cos(b.bearing) * ringR;
      const floor = this.floorAt(bx, bz);
      let foot = floor - B.length + (B.length + B.hover) * b.lift;
      foot += 0.3 * Math.sin(this.clock * 1.7 + i * 1.3) * b.lift * (1 - b.plunge);
      // Its aim: upright, then its point snapped onto its mark (or ahead).
      _d.set(0, 1, 0);
      if (b.aim > 0) {
        const mark = this.marks[i] >= 0 ? world?.entities.get(this.marks[i]) : undefined;
        let tx: number;
        let ty: number;
        let tz: number;
        if (mark && !mark.dead) {
          // The mark's place in her frame.
          const wx = mark.pos.x - this.stage.position.x;
          const wz = mark.pos.z - this.stage.position.z;
          tx = wx * cy - wz * sy;
          tz = wx * sy + wz * cy;
          ty = mark.pos.y - this.stageY + 1.2;
        } else {
          tx = bx * 0.4;
          tz = 26;
          ty = 1.2;
        }
        const mid = foot + B.length * 0.5;
        _v.set(tx - bx, ty - mid, tz - bz).normalize();
        _d.lerp(_v, b.aim).normalize();
      }
      // The plunge: turned point down and driven under the ice.
      if (b.plunge > 0) {
        const k = Math.min(1, b.plunge * 2);
        _d.lerp(_down, k).normalize();
        if (_d.lengthSq() < 1e-6) _d.copy(_down);
        foot =
          floor +
          B.length +
          (foot - floor - B.length) * (1 - b.plunge) -
          (B.length * 2 + 2) * b.plunge;
      }
      _q.setFromUnitVectors(_up, _d);
      // Its spin about its own length: fast up out of the ice, then lazy.
      _q2.setFromAxisAngle(_up, b.spin);
      _q.multiply(_q2);
      // The blade's middle stays on its ring; it turns about its middle.
      const mid = foot + B.length * 0.5;
      _p.set(bx, mid, bz).addScaledVector(_d, -B.length * 0.5);
      _s.setScalar(1);
      _m.compose(_p, _q, _s);
      this.blades.setMatrixAt(i, _m);
      this.blades.setColorAt(i, _c.setRGB(b.glow, b.glow, b.glow));
      // Its halo round its middle, and the glint off its point on the snap.
      // (A soft cold light round its heart only as it is born: a wash over
      // the whole blade would pale its crystal.)
      // A soft deep-cyan glow behind it (dim, so it never pales the
      // crystal; brighter as it is born and as it snaps).
      _p.set(bx, mid, bz);
      _s.setScalar(B.length * 0.75);
      _m.compose(_p, _q2.identity(), _s);
      this.halos.setMatrixAt(i, _m);
      // Out of the ice only (never a glow through it before it breaks out
      // or after it plunges).
      const hk =
        (this.reducedMotion() ? 0.6 : 1) *
        (0.05 + 0.04 * Math.min(2, b.glow)) *
        Math.min(1, b.lift * 3) *
        (1 - b.plunge);
      this.halos.setColorAt(i, _c.setRGB(hk * 0.15, hk * 0.9, hk * 2));
      if (b.glint > 0.01) {
        _p.set(bx, mid, bz).addScaledVector(_d, B.length * 0.5);
        _s.setScalar(this.reducedMotion() ? 0.8 + 1.4 * b.glint : 1 + 9 * b.glint);
        _m.compose(_p, _q2.identity(), _s);
        this.halos.setMatrixAt(TIP0 + i, _m);
        const g = (this.reducedMotion() ? 0.5 : 1.1) * b.glint;
        this.halos.setColorAt(TIP0 + i, _c.setRGB(g * 0.9, g * 1.1, g * 1.3));
      } else this.halos.setMatrixAt(TIP0 + i, _zero);
      // Frost trailing off it as it spins up and circles; ice bursting as it
      // breaks out.
      if (b.lift < 1 && b.lift > 0.05 && this.rand() < dt * 34 * this.density)
        this.particles.puff(bx, floor + 0.3, bz, 2, BURST);
      // The frost trail: thick while it spins up into the circle.
      if (b.plunge === 0 && b.lift > 0.3) {
        let n = dt * (b.lift < 1 ? 70 : 14) * this.density * (this.reducedMotion() ? 0.35 : 1);
        while (n > 0) {
          if (n < 1 && this.rand() > n) break;
          n -= 1;
          _p.set(bx, mid, bz).addScaledVector(_d, B.length * (this.rand() - 0.5));
          this.particles.puff(_p.x, _p.y, _p.z, 1, BLADE_TRAIL);
        }
      }
      // Each blade's own star of cracks and burst of ice where it breaks
      // out, and the splash as it plunges back.
      const start = E.bladesAt + i * E.bladeStep;
      const sinceUp = t - start;
      const sx0 = Math.sin(b.bearing) * B.ring * 0.35;
      const sz0 = Math.cos(b.bearing) * B.ring * 0.35;
      if (sinceUp >= 0 && sinceUp < 2.6) {
        _p.set(sx0, this.floorAt(sx0, sz0) + 0.08, sz0);
        _s.setScalar(5.5);
        _m.compose(_p, _q2.identity(), _s);
        this.stars.setMatrixAt(i, _m);
        const reveal = Math.min(1, sinceUp / 0.35);
        const fade = 1 - Math.max(0, (sinceUp - 1.2) / 1.4);
        this.stars.setColorAt(i, _c.setRGB(reveal, fade, 0));
        stars = true;
      } else this.stars.setMatrixAt(i, _zero);
      if (crossedQuenchBeat(prev, t, start + 0.05))
        this.particles.puff(sx0, floor + 0.4, sz0, Math.round(22 * this.density) + 4, BURST);
      const pl = E.plungeAt + i * E.plungeStep + E.plungeFor * 0.6;
      if (crossedQuenchBeat(prev, t, pl))
        this.particles.puff(bx, floor + 0.4, bz, Math.round(16 * this.density) + 3, BURST);
    }
    this.stars.visible = stars;
    if (stars) {
      this.stars.instanceMatrix.needsUpdate = true;
      if (this.stars.instanceColor) this.stars.instanceColor.needsUpdate = true;
    }
    const eyes = this.paintEyes();
    this.blades.visible = any;
    this.halos.visible = any || eyes;
    if (any) {
      this.blades.instanceMatrix.needsUpdate = true;
      if (this.blades.instanceColor) this.blades.instanceColor.needsUpdate = true;
    }
    if (any || eyes) {
      this.halos.instanceMatrix.needsUpdate = true;
      if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
    }
  }

  /** Her eyes' glints under the ice: a sharp flare as they open, a steady
   *  cold light through the sheet, handed to her body's own glints as she
   *  breaks out. Returns whether any is drawn. */
  private paintEyes(): boolean {
    const L = this.look;
    const fade = L.sinceBreach >= 0 ? Math.max(0, 1 - L.sinceBreach / 1.2) : 1;
    const k = Math.min(2.6, L.eyes) * fade;
    const set = quenchBodySockets();
    let shown = false;
    for (let j = 0; j < 2; j++) {
      const slot = EYE0 + j;
      const pt = set?.points[S_EYES[j]];
      if (k <= 0.02) {
        this.halos.setMatrixAt(slot, _zero);
        continue;
      }
      if (pt) {
        pt.getWorldPosition(_p);
        this.stage.worldToLocal(_p);
      } else _p.set((j === 0 ? 1 : -1) * 0.2, 0.7, QUENCH_SHEET_MOUTH.z - 0.3);
      // Lifted to the sheet's face over them, so the ice never hides them.
      _p.y = Math.max(_p.y, QUENCH_SHEET.height * 0.75);
      _s.setScalar(0.9 + 1.1 * k);
      _m.compose(_p, _q.identity(), _s);
      this.halos.setMatrixAt(slot, _m);
      this.halos.setColorAt(slot, _c.setRGB(0.55 * k, 1.05 * k, 1.35 * k));
      shown = true;
    }
    return shown;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.chunks.dispose();
    this.blades.dispose();
    this.slabs.dispose();
    this.stars.dispose();
    this.halos.dispose();
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
