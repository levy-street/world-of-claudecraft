// Ignivar's furnace VFX: fire plumes + heat shimmer venting from the three
// molten ports, plus the emissive pulse that makes his lava breathe.
//
// The GLB carries three non-deforming socket bones, each placed on the centre
// of a real glowing vent in the mesh and rolled so its LOCAL +Y points the way
// the vent faces. Parent an emitter to the bone and it inherits every bit of
// skeletal animation for free -- no per-frame transform chasing.
//
//   vfx_core    front chest core, faces forward   (the big octagon)
//   vfx_vent.l  left upper back, faces backward
//   vfx_vent.r  right upper back, faces backward
//   vfx_eyes    eye slit, faces forward           (not vented -- for eye beams)
//
// Everything below is GPU-side: particles advect in the vertex shader off a
// per-particle seed, so update() only pushes one uniform per frame.
//
// NOTE ON HEAT HAZE: a true refractive haze needs the scene colour buffer,
// which only the post stack owns. What ships here is the cheap version -- an
// additive shimmer billboard whose UVs wobble. To upgrade it to real
// refraction, feed post.ts's read target in as `uScene` and displace the
// sample by the same wobble; the shader is written with that swap in mind.

import * as THREE from 'three';
import { assetUrl } from './assets/media';
import { sharedUniforms } from './gfx';

// NOTE: three.js's GLTFLoader sanitizes node names (dots are reserved chars
// and get STRIPPED: 'vfx_vent.l' -> 'vfx_ventl'), so the lookup below matches
// both the raw glTF spelling and the sanitized one.
export const IGNIVAR_VENTS = ['vfx_core', 'vfx_vent.l', 'vfx_vent.r'] as const;
export type IgnivarVent = (typeof IGNIVAR_VENTS)[number];
const VENT_LOOKUP: readonly string[] = [
  ...IGNIVAR_VENTS,
  'vfx_ventl',
  'vfx_ventr', // three.js sanitized (dot stripped)
  'vfx_vent_l',
  'vfx_vent_r', // underscore variants, just in case
];

export interface IgnivarVfxOptions {
  /** particles per vent. 96 reads full at boss scale; drop for crowds. */
  count?: number;
  /** metres the plume travels before it dies (model units x scene scale). */
  reach?: number;
  /** base emissive multiplier; the pulse rides on top of this. */
  emissiveBase?: number;
  /** heat shimmer on/off -- the cheapest thing to cut on low spec. */
  shimmer?: boolean;
  /** flipbook atlas for the flame breath (6x6 intensity frames). */
  flameTexUrl?: string;
  /** how far the flame breath sprays, in model units along the core's +Y. */
  flameReach?: number;
  /** flickering point light riding the breath -- cut on low spec. */
  flameLight?: boolean;
}

export interface IgnivarVfxHandle {
  /** call once per frame with seconds since the last frame */
  update(dt: number): void;
  /** 0 = dormant, 1 = normal, >1 = channelling / enraged. Drives plume
   *  length, particle brightness and the emissive pulse depth together. */
  setIntensity(v: number): void;
  /** cast release (ChannelEnd): a dense flare plus an expanding body shell */
  pulse(): void;
  /** landing impact (JumpAttack): ground fire ring plus a half-strength kick */
  shockwave(): void;
  /** flame breath (Channel): a sustained flamethrower jet from the chest
   *  core. true ignites (fast whoosh), false chokes it off over ~half a
   *  second. Call from gameplay for the duration of the channel. */
  setFlame(on: boolean): void;
  dispose(): void;
}

// ---------------------------------------------------------------- shaders

const PLUME_VERT = `
uniform float uTime;
uniform float uIntensity;
uniform float uReach;
attribute float aSeed;
attribute float aSize;
varying float vLife;
varying float vSeed;

// cheap hash -> [0,1)
float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }

void main() {
  vSeed = aSeed;
  // each particle runs its own loop, offset so the stream is continuous
  float speed = 0.55 + h11(aSeed) * 0.45;
  float life  = fract(uTime * speed * 0.6 + aSeed);
  vLife = life;

  // travel along the socket's local +Y -- the direction the vent faces
  float dist = life * uReach * (0.7 + 0.6 * uIntensity) * 0.7;

  // lateral spread widens as the plume rises, with a slow curl
  float ang    = h11(aSeed + 1.7) * 6.2831853;
  float radius = h11(aSeed + 3.1) * 0.35;
  float curl   = uTime * (0.8 + h11(aSeed + 5.3) * 1.4);
  float spread = 0.06 + life * 0.34;
  vec3 pos = vec3(
    cos(ang + curl) * radius * spread,
    dist,
    sin(ang + curl) * radius * spread
  );
  // ember turbulence: fast per-particle flutter that grows once the ember is
  // free of the vent -- real embers dance, they do not glide
  float turb = 0.6 + 0.8 * h11(aSeed + 7.9);
  float free = 0.25 + life;
  pos.x += sin(uTime * (6.0 + turb * 5.0) + aSeed * 61.0 + life * 9.0) * 0.05 * free;
  pos.z += cos(uTime * (5.0 + turb * 6.0) + aSeed * 47.0 + life * 7.0) * 0.05 * free;
  // buoyant lift: hot gas turns upward in WORLD space as it leaves the vent.
  // pow 1.3 bends the stream up EARLY and hard -- the column reads near
  // vertical a hand-span off the vent.
  vec4 world = modelMatrix * vec4(pos, 1.0);
  float mscale = length(modelMatrix[1].xyz);
  world.y += (pow(max(life, 0.0), 1.3) * uReach * 2.0
           + sin(uTime * 7.0 + aSeed * 53.0) * 0.02 * life) * mscale;

  vec4 mv = viewMatrix * world;
  // grow out of the vent, then burn away
  float grow = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.55, 1.0, life));
  gl_PointSize = aSize * mscale * grow * (1.0 + uIntensity * 0.5) * (260.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const PLUME_FRAG = `
uniform float uIntensity;
uniform float uBurst;
varying float vLife;
varying float vSeed;

void main() {
  // round soft-edged ember
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = 1.0 - smoothstep(0.0, 0.5, r);

  // white-hot at the vent -> orange -> deep red ember -> smoke
  // real embers run RED: the white-hot flash is brief, the long tail is
  // deep red-orange fading to dark cinder
  vec3 hot   = vec3(1.00, 0.85, 0.55);
  vec3 mid   = vec3(1.00, 0.30, 0.05);
  vec3 cool  = vec3(0.38, 0.04, 0.01);
  vec3 col = mix(hot, mid, smoothstep(0.0, 0.22, vLife));
  col = mix(col, cool, smoothstep(0.30, 0.80, vLife));

  float fade = (1.0 - smoothstep(0.5, 1.0, vLife));
  // intensity 0 = DORMANT: the fire goes fully out (death), not just dim
  float alive = smoothstep(0.0, 0.3, uIntensity);
  float a = core * core * fade * (0.55 + 0.45 * uIntensity) * alive * uBurst;
  gl_FragColor = vec4(col * (1.0 + uIntensity * 0.6), a);
}
`;

// Smoke is RIBBONS, not puffs: each vent carries a few camera-facing strips
// whose centreline spirals up the (buoyancy-bent) plume path and waves over
// time, with the alpha scrolling upward along the ribbon so the wisp reads
// as rising. aT runs 0..1 along the strip, aSide is the +-1 width offset.
const SMOKE_VERT = `
uniform float uTime;
uniform float uIntensity;
uniform float uReach;
attribute float aSeed;
attribute float aT;
attribute float aSide;
varying vec2 vUv;
varying float vSeed;

float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }

void main() {
  vUv = vec2(aSide * 0.5 + 0.5, aT);
  vSeed = aSeed;
  float t = aT;
  float dist = (0.30 + t * 0.95) * uReach;
  // a slow rising spiral, plus an S-wave running down the ribbon
  float ang = h11(aSeed + 1.7) * 6.2831853 + t * 3.0 + uTime * (0.5 + h11(aSeed) * 0.5);
  float r = (0.04 + t * 0.42) * (0.6 + 0.8 * h11(aSeed + 3.1));
  float wave = sin(t * 7.0 - uTime * 2.6 + aSeed * 37.0) * (0.03 + t * 0.12);
  vec3 pos = vec3(cos(ang) * r + wave, dist, sin(ang) * r);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  float mscale = length(modelMatrix[1].xyz);
  world.y += pow(max(t, 0.0), 1.15) * uReach * 2.6 * mscale;
  vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  float width = (0.018 + t * 0.085) * mscale;
  world.xyz += camRight * aSide * width;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SMOKE_FRAG = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
varying float vSeed;

void main() {
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  edge = pow(max(edge, 0.0), 1.4);
  // wispy breakup scrolling upward with the rise
  float flow = 0.55 + 0.45 * sin(vUv.y * 12.0 - uTime * 2.8 + vSeed * 41.0);
  float ends = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));

  // fire-lit at the root, cooling to ash grey as it climbs
  vec3 lit  = vec3(0.42, 0.28, 0.18);
  vec3 grey = vec3(0.26, 0.24, 0.23);
  vec3 col = mix(lit, grey, smoothstep(0.0, 0.4, vUv.y));

  float alive = smoothstep(0.0, 0.3, uIntensity);
  float a = edge * ends * flow * (0.16 + 0.08 * uIntensity) * alive;
  gl_FragColor = vec4(col, a);
}
`;

// The ChannelEnd release: an expanding fresnel SHELL that erupts from the
// core and washes over the whole character, riding the same uBurst envelope
// as the extra particles -- exp decay makes it expand fast then linger.
const PULSE_VERT = `
uniform float uBurst;
varying float vRim;
varying float vP;
void main() {
  float p = 1.0 - uBurst;            // 0 at the moment of release -> 1 expanded
  vP = p;
  float r = mix(0.18, 1.25, p);      // core-sized -> past the whole silhouette
  vec4 mv = viewMatrix * modelMatrix * vec4(position * r, 1.0);
  vec3 nv = normalize(mat3(viewMatrix) * mat3(modelMatrix) * normal);
  vRim = 1.0 - abs(nv.z);            // bright edge-on rim, clear face-on
  gl_Position = projectionMatrix * mv;
}
`;
const PULSE_FRAG = `
uniform float uBurst;
uniform float uIntensity;
varying float vRim;
varying float vP;
void main() {
  float rim = pow(clamp(vRim, 0.0, 1.0), 2.2);
  vec3 col = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.20, 0.03), vP);
  float a = rim * uBurst * uBurst * 1.3;
  a += (1.0 - vP) * (1.0 - vP) * 0.20 * uBurst;   // brief full-face wash at birth
  gl_FragColor = vec4(col * (1.2 + uIntensity * 0.4), a);
}
`;
// JumpAttack landing: a flat fire RING that races across the ground from
// under his feet. Own envelope (uShock) so the meteor slam and the channel
// pulse never fight; the ring lives on the model ROOT so it stays flat on
// the floor no matter what the skeleton is doing.
const SHOCK_VERT = `
uniform float uShock;
varying float vRad;
void main() {
  float rr = length(position.xz);
  vRad = (rr - 0.55) / 0.45;          // 0 at the ring's inner edge, 1 outer
  float p = 1.0 - uShock;             // 0 at impact -> 1 fully expanded
  float s = mix(0.15, 2.3, p);
  vec3 pos = vec3(position.x * s, position.y + 0.02, position.z * s);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
}
`;
const SHOCK_FRAG = `
uniform float uShock;
uniform float uIntensity;
varying float vRad;
void main() {
  float r = clamp(vRad, 0.0, 1.0);
  float band = sin(r * 3.14159);      // hot band peaking mid-ring
  vec3 col = mix(vec3(1.0, 0.90, 0.60), vec3(1.0, 0.25, 0.03), r);
  float a = band * band * uShock * uShock * 1.4;
  gl_FragColor = vec4(col * (1.2 + uIntensity * 0.3), a);
}
`;
const SHIMMER_VERT = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vUv = uv;
  // billboard toward the camera, anchored at the socket
  vec3 c = vec3(modelMatrix[3]);
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 up    = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  float mscale = length(modelMatrix[1].xyz);
  float s = 0.55 * (0.8 + 0.4 * uIntensity) * mscale;
  vec3 world = c + right * position.x * s + up * (position.y * s + s * 0.55);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

// Swap `uScene` in and sample it at (screenUv + wob * 0.02) to get true
// refraction; the wobble term is already isolated for exactly that.
const SHIMMER_FRAG = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float rise = uTime * 1.6;
  float wob = sin((vUv.y * 14.0) - rise) * 0.5 + sin((vUv.x * 9.0) + rise * 1.3) * 0.5;
  float mask = (1.0 - smoothstep(0.15, 0.5, length(p)))
             * smoothstep(0.0, 0.35, vUv.y)
             * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  float alive = smoothstep(0.0, 0.3, uIntensity);
  float a = mask * (0.10 + 0.10 * uIntensity) * (0.6 + 0.4 * wob) * alive;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.42), max(a, 0.0));
}
`;

// The flame breath: a flamethrower jet of flipbook billboards advected up the
// core socket's +Y (its emit direction). The atlas is 6x6 = 36 frames of a
// SINGLE-CHANNEL fire-intensity bake (a Mantaflow burst graded to grayscale);
// the colour ramp lives HERE in the shader, so the same texel drives the
// additive fire pass (white-hot ramp), the soot pass (dark blobs riding
// inside the stream) and the alpha erosion -- and the grade can shift with
// life/intensity per frame, which a baked RGB flipbook cannot.
// Billboard sizes and the buoyant tail-rise are added AFTER modelMatrix, so
// they scale off length(modelMatrix[1]) -- correct under any root scale with
// no extra uniform (the viewer normalizes the root; the game does not).
const FLAME_GRID = 6.0;
const FLAME_FRAMES = 36.0;

const FLAME_COMMON = `
uniform float uTime;
uniform float uFlame;
uniform float uReach;
attribute float iSeed;
varying float vLife;
varying float vSeed;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
varying float vFade;
float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }

// flipY'd atlas: frame 0 is the image's top-left cell
vec2 cellUv(vec2 corner, float f) {
  float col = mod(f, ${FLAME_GRID.toFixed(1)});
  float row = floor(f / ${FLAME_GRID.toFixed(1)});
  return vec2((col + corner.x) / ${FLAME_GRID.toFixed(1)},
              (${(FLAME_GRID - 1).toFixed(1)} - row + corner.y) / ${FLAME_GRID.toFixed(1)});
}
`;

const FLAME_VERT = `
${FLAME_COMMON}
void main() {
  vSeed = iSeed;
  // each sprite loops on its own clock; the stagger keeps the stream solid
  float dur = 0.45 + 0.6 * h11(iSeed + 2.3);
  float life = fract(uTime / dur + iSeed * 7.13);
  vLife = life;

  // fast launch, decelerating -- a pressured jet, not a lobbed ember.
  // the reach breathes a little so the tip never sits on a fixed plane
  float reach = uReach * (0.38 + 0.62 * uFlame) * (0.9 + 0.1 * sin(uTime * 9.0 + iSeed * 31.0));
  float dist = (1.0 - pow(max(1.0 - life, 0.0), 1.55)) * reach;
  float ang = h11(iSeed + 1.7) * 6.2831853;
  float rad = (0.10 + 0.85 * h11(iSeed + 3.1)) * life * 0.40;
  float swirl = uTime * (0.6 + 0.8 * h11(iSeed + 5.3));
  vec3 pos = vec3(cos(ang + swirl) * rad, dist, sin(ang + swirl) * rad);
  pos.x += sin(uTime * 7.0 + iSeed * 43.0 + life * 6.0) * 0.05 * (0.3 + life);
  pos.z += cos(uTime * 6.3 + iSeed * 29.0 + life * 5.0) * 0.05 * (0.3 + life);

  vec4 world = modelMatrix * vec4(pos, 1.0);
  float mscale = length(modelMatrix[1].xyz);
  // hot gas: the tail of the stream bends up in WORLD space
  world.y += pow(max(life, 0.0), 2.0) * 0.55 * mscale;

  float size = (0.13 + 0.55 * pow(max(life, 0.0), 0.7)) * (0.8 + 0.4 * h11(iSeed + 9.7)) * mscale;
  float rot = h11(iSeed + 4.4) * 6.2831853 + uTime * (h11(iSeed + 6.1) - 0.5) * 2.4;
  vec2 rc = vec2(position.x * cos(rot) - position.y * sin(rot),
                 position.x * sin(rot) + position.y * cos(rot));
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  world.xyz += (camRight * rc.x + camUp * rc.y) * size;
  gl_Position = projectionMatrix * viewMatrix * world;

  float ff = min(life * ${FLAME_FRAMES.toFixed(1)}, ${(FLAME_FRAMES - 1).toFixed(3)});
  float fA = floor(ff);
  vBlend = ff - fA;
  vec2 corner = position.xy + 0.5; // plane verts run -0.5..0.5
  vUvA = cellUv(corner, fA);
  vUvB = cellUv(corner, min(fA + 1.0, ${(FLAME_FRAMES - 1).toFixed(1)}));
  vFade = 0.45 * uFlame * uFlame * smoothstep(0.02, 0.18, life) * (1.0 - smoothstep(0.72, 1.0, life));
}
`;

const FLAME_FRAG = `
uniform sampler2D uTex;
uniform float uTime;
uniform float uIntensity;
uniform float uSoot;
varying float vLife;
varying float vSeed;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
varying float vFade;

vec3 fireRamp(float t) {
  vec3 c = mix(vec3(0.0), vec3(0.25, 0.012, 0.0), smoothstep(0.0, 0.15, t));
  c = mix(c, vec3(0.85, 0.12, 0.012), smoothstep(0.15, 0.35, t));
  c = mix(c, vec3(1.0, 0.38, 0.03),  smoothstep(0.35, 0.55, t));
  c = mix(c, vec3(1.0, 0.72, 0.15),  smoothstep(0.55, 0.75, t));
  c = mix(c, vec3(1.0, 0.92, 0.55),  smoothstep(0.75, 0.90, t));
  c = mix(c, vec3(1.0, 0.99, 0.90),  smoothstep(0.90, 1.0, t));
  return c;
}

void main() {
  // frame-blended flipbook sample; the atlas stores intensity, not colour
  float I = mix(texture2D(uTex, vUvA).r, texture2D(uTex, vUvB).r, vBlend);
  // erosion bites the sprite away as it ages, on top of the baked breakup
  float er = 0.10 + 0.55 * smoothstep(0.5, 1.0, vLife);
  float m = smoothstep(er, er + 0.12, I);
  if (uSoot > 0.5) {
    // dark soot blobs tumbling INSIDE the stream (normal blending, under fire)
    vec3 col = mix(vec3(0.34, 0.15, 0.06), vec3(0.05, 0.035, 0.03),
                   smoothstep(0.25, 0.8, vLife));
    gl_FragColor = vec4(col, m * 0.45 * smoothstep(0.3, 0.7, vLife) * vFade);
  } else {
    // white-hot at the muzzle, cooling to red cinder down the stream
    float flick = 0.92 + 0.08 * sin(uTime * 24.0 + vSeed * 61.0);
    float heat = mix(1.2, 0.5, smoothstep(0.08, 0.9, vLife)) * flick;
    vec3 col = fireRamp(clamp(I * heat, 0.0, 1.0));
    gl_FragColor = vec4(col * (0.9 + 0.35 * uIntensity), m * vFade);
  }
}
`;

// the muzzle: a hot billboard flare parked just off the vent mouth
const FMUZZLE_VERT = `
uniform float uTime;
uniform float uFlame;
varying vec2 vUv;
void main() {
  vUv = uv;
  float mscale = length(modelMatrix[1].xyz);
  vec4 c = modelMatrix * vec4(0.0, 0.10, 0.0, 1.0);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = (0.22 + 0.04 * sin(uTime * 21.0) + 0.02 * sin(uTime * 33.0)) * uFlame * mscale;
  vec3 world = c.xyz + (camRight * position.x + camUp * position.y) * s;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;
const FMUZZLE_FRAG = `
uniform float uFlame;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - r, 0.0), 2.6) * uFlame;
  vec3 col = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.97, 0.85), pow(max(1.0 - r, 0.0), 3.0));
  gl_FragColor = vec4(col * 1.5, a);
}
`;

// The ground-fire AoE (raid telegraph): a flat circle the players must leave.
// Phase 1 `heatup()` -- molten cracks spread over a scorching disc from the
// centre out, with a pulsing warning rim. Phase 2 `erupt()` -- a flash ring
// races to the rim and the disc becomes a looping sea of flipbook flames on a
// churning lava pool. Same atlas + fireRamp as the flame breath, so the raid
// reads as one fire language.
//
// PERFORMANCE CONTRACT (the raid spawns ~10 at once): 2 draw calls per
// instance (disc + instanced flames), no lights, geometry and texture shared
// across every instance via module caches, frustum culling LEFT ON with real
// bounds, and update() writes three floats. dispose() releases only the
// per-instance materials -- the shared geos/texture stay cached for the next
// spawn on purpose (a raid respawns these constantly).
const AOE_DISC_VERT = `
varying vec2 vP;
void main() {
  vP = position.xz; // circle baked flat; local radius 1
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;
const AOE_DISC_FRAG = `
uniform float uTime;
uniform float uHeat;
uniform float uFlame;
uniform float uErupt;
uniform float uInnerRadiusRatio;
uniform float uPatternScale;
varying vec2 vP;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// jittered-cell Voronoi F1/F2: F2-F1 goes to 0 exactly on the border between
// two rock plates -- that border IS the crack line
vec2 vor(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(h21(ip + g), h21(ip + g + 19.19));
    vec2 d = g + o - fp;
    float dd = dot(d, d);
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  return vec2(sqrt(f1), sqrt(f2));
}
vec3 fireRamp(float t) {
  vec3 c = mix(vec3(0.0), vec3(0.25, 0.012, 0.0), smoothstep(0.0, 0.15, t));
  c = mix(c, vec3(0.85, 0.12, 0.012), smoothstep(0.15, 0.35, t));
  c = mix(c, vec3(1.0, 0.38, 0.03),  smoothstep(0.35, 0.55, t));
  c = mix(c, vec3(1.0, 0.72, 0.15),  smoothstep(0.55, 0.75, t));
  c = mix(c, vec3(1.0, 0.92, 0.55),  smoothstep(0.75, 0.90, t));
  c = mix(c, vec3(1.0, 0.99, 0.90),  smoothstep(0.90, 1.0, t));
  return c;
}
void main() {
  float r = length(vP);
  if (r > 1.0 || r < uInnerRadiusRatio) discard;
  float glow = max(uHeat, uFlame);
  if (glow < 0.004 && uErupt < 0.004) discard;
  vec2 patternP = vP * uPatternScale;
  // scorch grain + reveal jitter (static per world position, so the pattern
  // holds still while its heat moves)
  float n = vnoise(patternP * 4.0) * 0.65 + vnoise(patternP * 9.0 + 7.3) * 0.35;
  // domain-warped dual-scale Voronoi: big rock PLATES with craggy borders,
  // plus a finer secondary cracking inside them
  vec2 wp = patternP * 3.2 + (vec2(vnoise(patternP * 7.0), vnoise(patternP * 7.0 + 31.7)) - 0.5) * 0.55;
  vec2 F = vor(wp);
  float edge = F.y - F.x;
  vec2 wp2 = patternP * 6.5 + (vec2(vnoise(patternP * 11.0 + 5.2), vnoise(patternP * 11.0 + 17.9)) - 0.5) * 0.4;
  vec2 G = vor(wp2);
  float edge2 = G.y - G.x;
  float coreCrack = 1.0 - smoothstep(0.0, 0.055, edge);   // white-hot fissure line
  float glowCrack = 1.0 - smoothstep(0.0, 0.30, edge);    // heat bleeding up the plate walls
  float subCrack = (1.0 - smoothstep(0.0, 0.045, edge2)) * 0.5; // finer secondary cracking
  // cracks reveal centre-out as the heat builds
  float reveal = 1.0 - smoothstep(
    uHeat * 1.15 - 0.35,
    uHeat * 1.15,
    r + (n - 0.5) * 0.2
  );
  float pulse = 0.75 + 0.25 * sin(uTime * 5.0 + r * 6.0);
  float ring = smoothstep(0.90, 0.955, r) * (1.0 - smoothstep(0.975, 1.0, r));
  float churn = vnoise(patternP * 3.0 + vec2(uTime * 0.35, -uTime * 0.22));
  vec3 col = vec3(0.0);
  float a = 0.0;
  // scorched fill darkens the ground under everything
  float scorch = (0.30 * uHeat + 0.45 * uFlame) * (0.45 + 0.55 * n);
  col += vec3(0.05, 0.03, 0.025) * scorch;
  a += scorch * 0.85;
  // fissure glow: hottest at the circle's centre, breathing while the
  // telegraph charges, white-hot in the crack cores once burning
  float centerHeat = 1.0 - r * 0.42;
  float vheat = (0.52 + 0.26 * uHeat * pulse + 0.38 * uFlame * (0.7 + 0.5 * churn)) * centerHeat;
  float rg = reveal * glow;
  col += fireRamp(vheat * 0.72) * glowCrack * 0.9 * rg * (0.8 + 1.0 * uFlame);
  col += fireRamp(min(vheat + 0.38 + 0.12 * pulse, 1.0)) * coreCrack * 1.6 * rg;
  col += fireRamp(vheat * 0.85) * subCrack * rg;
  a += (glowCrack * 0.7 + coreCrack + subCrack * 0.5) * rg;
  // churning lava sheen under the full burn
  col += fireRamp(0.25 + 0.35 * churn) * uFlame * 0.18 * (1.0 - r * r);
  a += uFlame * 0.16 * (1.0 - r);
  // warning rim: pulses through heat-up, steadies bright while burning
  vec3 rcol = mix(vec3(1.0, 0.22, 0.03), vec3(1.0, 0.55, 0.10), uFlame);
  col += rcol * ring * (0.55 + 0.45 * pulse) * glow * 1.6;
  a += ring * glow * 0.8;
  // eruption flash: one ring racing centre -> rim as uErupt decays
  float er = 1.0 - uErupt;
  float ering = smoothstep(er - 0.14, er - 0.02, r) * (1.0 - smoothstep(er, er + 0.04, r));
  col += vec3(1.0, 0.85, 0.5) * ering * uErupt * 2.2;
  a += ering * uErupt;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;
// Ground flames reuse FLAME_COMMON + FLAME_FRAG wholesale (uFlame here is the
// burn envelope; uReach is declared-unused). Each sprite loops rising from a
// fixed area-uniform spot inside the circle.
const AOE_FLAME_VERT = `
${FLAME_COMMON}
uniform float uErupt;
uniform float uInnerRadiusRatio;
uniform float uOuterRadiusRatio;
uniform float uLocalFlameScale;
void main() {
  vSeed = iSeed;
  float dur = 0.5 + 0.5 * h11(iSeed + 2.3);
  float life = fract(uTime / dur + iSeed * 7.13);
  vLife = life;
  float ang = h11(iSeed + 1.7) * 6.2831853;
  float outer = uOuterRadiusRatio;
  float inner = min(uInnerRadiusRatio + 0.012, outer - 0.01);
  float rad = sqrt(mix(inner * inner, outer * outer, h11(iSeed + 3.1)));
  float dir = sign(h11(iSeed + 6.9) - 0.5);
  float sw = ang + uTime * (0.25 + 0.45 * h11(iSeed + 5.3)) * dir * 0.4;
  vec3 pos = vec3(cos(sw) * rad, (0.02 + life * (0.55 + 0.75 * h11(iSeed + 8.1))) * uLocalFlameScale, sin(sw) * rad);
  pos.x += sin(uTime * 5.0 + iSeed * 43.0 + life * 5.0) * 0.05 * life * uLocalFlameScale;
  pos.z += cos(uTime * 4.3 + iSeed * 29.0 + life * 4.0) * 0.05 * life * uLocalFlameScale;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  float mscale = length(modelMatrix[1].xyz);
  float size = (0.16 + 0.42 * pow(max(life, 0.0), 0.7)) * (0.75 + 0.5 * h11(iSeed + 9.7)) * mscale * uLocalFlameScale;
  float rot = h11(iSeed + 4.4) * 6.2831853 + uTime * (h11(iSeed + 6.1) - 0.5) * 2.0;
  vec2 rc = vec2(position.x * cos(rot) - position.y * sin(rot),
                 position.x * sin(rot) + position.y * cos(rot));
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  world.xyz += (camRight * rc.x + camUp * rc.y) * size;
  gl_Position = projectionMatrix * viewMatrix * world;
  float ff = min(life * 36.0, 35.000);
  float fA = floor(ff);
  vBlend = ff - fA;
  vec2 corner = position.xy + 0.5;
  vUvA = cellUv(corner, fA);
  vUvB = cellUv(corner, min(fA + 1.0, 35.0));
  // the eruption overshoot makes the first flames jump tall and bright
  float k = uFlame * (1.0 + uErupt * 0.6);
  vFade = 0.42 * k * k * smoothstep(0.02, 0.15, life) * (1.0 - smoothstep(0.7, 1.0, life));
}
`;

// ---------------------------------------------------------------- attach

/**
 * Wire the furnace VFX onto a loaded Ignivar. `root` is the GLB scene (or any
 * ancestor of the socket bones and the skinned body).
 */
export function attachIgnivarVfx(
  root: THREE.Object3D,
  opts: IgnivarVfxOptions = {},
): IgnivarVfxHandle {
  const count = opts.count ?? 96;
  const reach = opts.reach ?? 0.55;
  const emissiveBase = opts.emissiveBase ?? 2.4; // matches the GLB's stored strength
  const wantShimmer = opts.shimmer !== false;
  const flameReach = opts.flameReach ?? 2.5;

  const uTime = sharedUniforms.uTime ?? { value: 0 };
  const uIntensity = { value: 1 };
  const disposables: Array<{ dispose(): void }> = [];
  const attached: THREE.Object3D[] = [];

  // ---- locate the sockets. glTF exports bones as named nodes, so a plain
  // name lookup finds them whether or not a Skeleton was built.
  const sockets = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (VENT_LOOKUP.includes(o.name)) sockets.set(o.name, o);
  });
  if (sockets.size !== IGNIVAR_VENTS.length) {
    // Loud, because a silent miss here looks exactly like "the VFX is broken".
    console.warn(`[ignivar-vfx] found ${sockets.size}/${IGNIVAR_VENTS.length} vent sockets:`, [
      ...sockets.keys(),
    ]);
  }

  // ---- one plume per vent; the CORE carries the show, the rear vents breathe
  const makePlumeGeo = (n: number) => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3); // unused; the vert shader places them
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i] = i / n + Math.random() * (0.5 / n);
      size[i] = 0.026 + Math.random() * 0.042; // small dancing embers, not blobs
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    // the shader ignores `position`, so give it a bound the culler can trust
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, reach * 0.5, 0), reach * 1.6);
    return g;
  };
  const plumeGeoCore = makePlumeGeo(count);
  const plumeGeoRear = makePlumeGeo(Math.max(16, Math.round(count * 0.42)));
  disposables.push(plumeGeoCore, plumeGeoRear);

  const uBurst = { value: 0 }; // ChannelEnd pulse envelope (0 = hidden)
  const plumeMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uIntensity, uReach: { value: reach }, uBurst: { value: 1 } },
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(plumeMat);
  // the ChannelEnd pulse: a 2x-dense extra particle set per vent, alpha-gated
  // by uBurst so the vents ERUPT to ~3x particles and settle back down.
  // Fire it from gameplay with handle.pulse() at the cast release.
  const burstMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uIntensity, uReach: { value: reach }, uBurst },
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(burstMat);
  const burstGeoCore = makePlumeGeo(count * 2);
  const burstGeoRear = makePlumeGeo(Math.max(32, Math.round(count * 0.84)));
  disposables.push(burstGeoCore, burstGeoRear);

  // ---- smoke: RIBBON strips continuing the plume, not puff sprites
  const makeSmokeGeo = (RIBBONS: number) => {
    const g = new THREE.BufferGeometry();
    const SEGS = 14;
    const nv = RIBBONS * (SEGS + 1) * 2;
    const pos = new Float32Array(nv * 3); // the vert shader places them
    const seed = new Float32Array(nv);
    const tArr = new Float32Array(nv);
    const side = new Float32Array(nv);
    const idx: number[] = [];
    for (let rb = 0; rb < RIBBONS; rb++) {
      const s0 = rb / RIBBONS + Math.random() * (0.5 / RIBBONS);
      for (let s = 0; s <= SEGS; s++) {
        for (let k = 0; k < 2; k++) {
          const v = (rb * (SEGS + 1) + s) * 2 + k;
          seed[v] = s0;
          tArr[v] = s / SEGS;
          side[v] = k === 0 ? -1 : 1;
        }
        if (s < SEGS) {
          const a = (rb * (SEGS + 1) + s) * 2;
          idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(tArr, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, reach, 0), reach * 4);
    return g;
  };
  const smokeGeoCore = makeSmokeGeo(3);
  const smokeGeoRear = makeSmokeGeo(1);
  disposables.push(smokeGeoCore, smokeGeoRear);
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uIntensity, uReach: { value: reach } },
    vertexShader: SMOKE_VERT,
    fragmentShader: SMOKE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  disposables.push(smokeMat);

  const pulseGeo = new THREE.SphereGeometry(1, 32, 20);
  const pulseMat = new THREE.ShaderMaterial({
    uniforms: { uBurst, uIntensity },
    vertexShader: PULSE_VERT,
    fragmentShader: PULSE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(pulseGeo, pulseMat);
  const uShock = { value: 0 }; // landing shockwave envelope (0 = hidden)
  const shockGeo = new THREE.RingGeometry(0.55, 1.0, 48).rotateX(-Math.PI / 2);
  const shockMat = new THREE.ShaderMaterial({
    uniforms: { uShock, uIntensity },
    vertexShader: SHOCK_VERT,
    fragmentShader: SHOCK_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(shockGeo, shockMat);
  {
    const shockRing = new THREE.Mesh(shockGeo, shockMat);
    shockRing.name = 'ignivar__shockwave';
    shockRing.frustumCulled = false;
    shockRing.renderOrder = 3;
    root.add(shockRing); // ROOT, not a bone: the ring stays flat on the ground
    attached.push(shockRing);
  }
  {
    const coreBone = sockets.get('vfx_core');
    if (coreBone) {
      const shellAnchor = coreBone.parent ?? coreBone;
      const shell = new THREE.Mesh(pulseGeo, pulseMat);
      shell.name = 'ignivar__pulse_shell';
      shell.frustumCulled = false;
      shell.renderOrder = 3; // over the fire
      shellAnchor.add(shell);
      attached.push(shell);
    }
  }
  // ---- the flame breath: flipbook jet + soot + sparks + muzzle, CORE only
  const uFlame = { value: 0 }; // breath envelope: 0 off, 1 full roar
  const flameTex = getFlameTex(opts.flameTexUrl ?? '/textures/vfx/ignivar_flame_6x6.webp');
  const flameCount = 110;
  const makeFlameGeo = (n: number) => {
    const g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    plane.dispose();
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = i / n + Math.random() * (0.5 / n);
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, flameReach * 0.5, 0), flameReach * 2);
    return g;
  };
  const makeFlameMat = (soot: boolean) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uFlame,
        uIntensity,
        uReach: { value: flameReach },
        uTex: { value: flameTex },
        uSoot: { value: soot ? 1 : 0 },
      },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: soot ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
  const flameLight = opts.flameLight !== false ? new THREE.PointLight(0xff7722, 0, 0, 1.6) : null;
  {
    const coreBone = sockets.get('vfx_core');
    if (coreBone) {
      const fireGeo = makeFlameGeo(flameCount);
      const sootGeo = makeFlameGeo(Math.round(flameCount * 0.45));
      const fireMat = makeFlameMat(false);
      const sootMat = makeFlameMat(true);
      disposables.push(fireGeo, sootGeo, fireMat, sootMat);
      const soot = new THREE.Mesh(sootGeo, sootMat);
      soot.name = 'vfx_core__flame_soot';
      soot.frustumCulled = false;
      soot.renderOrder = 2; // under the additive fire, over the smoke ribbons
      coreBone.add(soot);
      attached.push(soot);
      const fire = new THREE.Mesh(fireGeo, fireMat);
      fire.name = 'vfx_core__flame';
      fire.frustumCulled = false;
      fire.renderOrder = 3;
      coreBone.add(fire);
      attached.push(fire);

      const muzzleGeo = new THREE.PlaneGeometry(1, 1);
      const muzzleMat = new THREE.ShaderMaterial({
        uniforms: { uTime, uFlame },
        vertexShader: FMUZZLE_VERT,
        fragmentShader: FMUZZLE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      disposables.push(muzzleGeo, muzzleMat);
      const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
      muzzle.name = 'vfx_core__flame_muzzle';
      muzzle.frustumCulled = false;
      muzzle.renderOrder = 3;
      coreBone.add(muzzle);
      attached.push(muzzle);

      if (flameLight) {
        flameLight.name = 'vfx_core__flame_light';
        flameLight.position.set(0, flameReach * 0.35, 0);
        coreBone.add(flameLight);
        attached.push(flameLight);
      }
    }
  }

  const shimmerGeo = wantShimmer ? new THREE.PlaneGeometry(1, 1) : null;
  const shimmerMat = wantShimmer
    ? new THREE.ShaderMaterial({
        uniforms: { uTime, uIntensity },
        vertexShader: SHIMMER_VERT,
        fragmentShader: SHIMMER_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    : null;
  if (shimmerGeo) disposables.push(shimmerGeo);
  if (shimmerMat) disposables.push(shimmerMat);

  for (const [name, bone] of sockets) {
    const isCore = name === 'vfx_core';
    const plume = new THREE.Points(isCore ? plumeGeoCore : plumeGeoRear, plumeMat);
    plume.name = `${name}__plume`;
    plume.frustumCulled = false; // it lives in bone space; the bound is nominal
    plume.renderOrder = 2; // fire draws over its own smoke
    bone.add(plume);
    attached.push(plume);

    const burst = new THREE.Points(isCore ? burstGeoCore : burstGeoRear, burstMat);
    burst.name = `${name}__burst`;
    burst.frustumCulled = false;
    burst.renderOrder = 2;
    bone.add(burst);
    attached.push(burst);

    const smoke = new THREE.Mesh(isCore ? smokeGeoCore : smokeGeoRear, smokeMat);
    smoke.name = `${name}__smoke`;
    smoke.frustumCulled = false;
    smoke.renderOrder = 1;
    bone.add(smoke);
    attached.push(smoke);

    if (shimmerGeo && shimmerMat) {
      const sh = new THREE.Mesh(shimmerGeo, shimmerMat);
      sh.name = `${name}__shimmer`;
      sh.frustumCulled = false;
      bone.add(sh);
      attached.push(sh);
    }
  }

  // ---- the emissive pulse: lava breathing, not a strobe
  const pulsed: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std?.emissiveMap && !pulsed.includes(std)) pulsed.push(std);
    }
  });
  if (!pulsed.length) console.warn('[ignivar-vfx] no emissive material found to pulse');

  let t = 0;
  let target = 1;
  let flameTarget = 0;
  return {
    update(dt: number) {
      // clamp: a hitch (or a hidden tab's giant frame) must never swallow a
      // whole pulse/shockwave envelope in one step
      dt = Math.min(dt, 0.05);
      t += dt;
      // intensity eases toward its target so death is a fade, not a switch
      uIntensity.value += (target - uIntensity.value) * Math.min(1, dt * 1.6);
      uBurst.value *= Math.exp(-dt * 1.1); // the pulse dies off on its own
      uShock.value *= Math.exp(-dt * 1.8); // the ground ring is snappier
      // ignition is a whoosh, choke-off a beat slower
      uFlame.value +=
        (flameTarget - uFlame.value) * Math.min(1, dt * (flameTarget > uFlame.value ? 5.0 : 2.4));
      if (flameLight) {
        flameLight.intensity =
          uFlame.value * (6 + 2 * Math.sin(t * 23.0) + 1.5 * Math.sin(t * 17.3));
      }
      // two detuned sines: a slow swell with a faster flutter riding it, so the
      // glow never lands on an obvious beat
      const swell = Math.sin(t * 1.15) * 0.5 + Math.sin(t * 2.7) * 0.18;
      const depth = 0.22 + 0.18 * uIntensity.value;
      // 0 = DORMANT: the lava itself goes dark, not just the particles
      const gate =
        0.05 + 0.95 * Math.min(1, uIntensity.value) + 0.3 * Math.max(0, uIntensity.value - 1);
      const k = emissiveBase * (1 + swell * depth) * gate;
      for (const m of pulsed) m.emissiveIntensity = k;
      // uTime is the shared clock; only advance it if nothing else owns it
      if (!sharedUniforms.uTime) uTime.value = t;
    },
    setIntensity(v: number) {
      target = Math.max(0, v);
    },
    pulse() {
      // one big exhale: 3x particles flare in and the glow spikes
      uBurst.value = 1;
      uIntensity.value = Math.max(uIntensity.value, 2.2);
    },
    shockwave() {
      // meteor landing: the ground ring races out, embers kick, glow flares
      uShock.value = 1;
      uBurst.value = Math.max(uBurst.value, 0.5);
      uIntensity.value = Math.max(uIntensity.value, 1.6);
    },
    setFlame(on: boolean) {
      flameTarget = on ? 1 : 0;
      if (on) uIntensity.value = Math.max(uIntensity.value, 1.4); // the furnace roars with it
    },
    dispose() {
      for (const o of attached) o.parent?.remove(o);
      for (const d of disposables) d.dispose();
      // flameTex stays in the module cache -- the AoE circles share it
      for (const m of pulsed) m.emissiveIntensity = emissiveBase;
    },
  };
}

// ------------------------------------------------- ground-fire AoE factory

// Shared across every instance and NEVER disposed: the raid churns through
// these, and rebuilding geometry per spawn is the only real cost worth
// avoiding. ~10 concurrent instances = 20 draw calls, 3 shader programs.
const flameTexCache = new Map<string, THREE.Texture>();
function getFlameTex(url: string): THREE.Texture {
  let t = flameTexCache.get(url);
  if (!t) {
    t =
      typeof document === 'undefined'
        ? new THREE.Texture()
        : new THREE.TextureLoader().load(assetUrl(url));
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    flameTexCache.set(url, t);
  }
  return t;
}
const aoeDiscGeos = new Map<string, THREE.BufferGeometry>();
const aoeFlameGeos = new Map<number, THREE.InstancedBufferGeometry>();
function getAoeDiscGeo(innerRadiusRatio: number): THREE.BufferGeometry {
  const key = innerRadiusRatio.toFixed(6);
  let geometry = aoeDiscGeos.get(key);
  if (!geometry) {
    geometry =
      innerRadiusRatio <= 0
        ? new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2)
        : new THREE.RingGeometry(innerRadiusRatio, 1, 96).rotateX(-Math.PI / 2);
    aoeDiscGeos.set(key, geometry);
  }
  return geometry;
}
function getAoeFlameGeo(n: number): THREE.InstancedBufferGeometry {
  let g = aoeFlameGeos.get(n);
  if (!g) {
    g = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    g.setAttribute('uv', plane.getAttribute('uv'));
    plane.dispose();
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) seed[i] = i / n + Math.random() * (0.5 / n);
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = n;
    // real bounds so per-circle frustum culling keeps working in the arena
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.2);
    aoeFlameGeos.set(n, g);
  }
  return g;
}

export interface GroundFireAoeOptions {
  /** world radius of the circle. Default 1.2. */
  radius?: number;
  /** Optional safe hole, in world units, for an annular field. */
  innerRadius?: number;
  /** flame sprites in the burn phase. Default 56; drop for low spec. */
  count?: number;
  flameTexUrl?: string;
  /** Use an instance clock so callers can freeze the fire for reduced motion. */
  localTime?: boolean;
  /** Keep a full disc so the safe inner radius can move without rebuilding geometry. */
  dynamicInnerRadius?: boolean;
}

export interface GroundFireAoeHandle {
  /** add this to the scene and set its position to the spawn point */
  group: THREE.Group;
  /** call once per frame with seconds since the last frame */
  update(dt: number): void;
  /** phase 1: the telegraph -- cracks spread, rim pulses, no damage yet */
  heatup(): void;
  /** phase 2: the burn -- eruption flash, then a looping sea of flames */
  erupt(immediate?: boolean): void;
  /** Move the safe inner edge. Requires dynamicInnerRadius at construction. */
  setInnerRadius(innerRadius: number): void;
  /** choke the fire off; safe to dispose() ~1s later once it fades */
  stop(): void;
  phase(): 'off' | 'heatup' | 'fire';
  dispose(): void;
}

/**
 * One raid AoE fire circle. Typical use, 10x per wave:
 *   const aoe = createGroundFireAoe();
 *   scene.add(aoe.group); aoe.group.position.copy(spawnPoint);
 *   aoe.heatup();               // telegraph starts
 *   ...telegraph duration is gameplay's call...
 *   aoe.erupt();                // damage phase
 *   aoe.stop();                 // wave over
 *   setTimeout(() => { scene.remove(aoe.group); aoe.dispose(); }, 1000);
 */
export function createGroundFireAoe(opts: GroundFireAoeOptions = {}): GroundFireAoeHandle {
  const radius = Math.max(0.01, opts.radius ?? 1.2);
  let innerRadius = Math.max(0, Math.min(radius * 0.98, opts.innerRadius ?? 0));
  const innerRadiusRatio = innerRadius / radius;
  const localFlameScale = Math.min(1, 3.5 / radius);
  const count = opts.count ?? 56;
  const usesLocalTime = opts.localTime === true;
  const uTime = usesLocalTime ? { value: 0 } : (sharedUniforms.uTime ?? { value: 0 });
  const uHeat = { value: 0 };
  const uFlame = { value: 0 };
  const uErupt = { value: 0 };
  const uIntensity = { value: 1 }; // FLAME_FRAG expects it; AoE runs it flat

  const group = new THREE.Group();
  group.name = 'ground_fire_aoe';
  group.scale.setScalar(radius); // flames + disc share the local unit circle
  group.userData.visualLanguage = 'ignivar-ground-fire';
  group.userData.innerRadius = innerRadius;
  group.userData.outerRadius = radius;

  const discMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uHeat,
      uFlame,
      uErupt,
      uInnerRadiusRatio: { value: innerRadiusRatio },
      uPatternScale: { value: Math.max(1, radius / 3.5) },
    },
    vertexShader: AOE_DISC_VERT,
    fragmentShader: AOE_DISC_FRAG,
    transparent: true,
    depthWrite: false,
    // coplanar with the arena floor: bias instead of fighting it
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const disc = new THREE.Mesh(
    getAoeDiscGeo(opts.dynamicInnerRadius === true ? 0 : innerRadiusRatio),
    discMat,
  );
  disc.name = 'ground_fire_aoe__disc';
  disc.position.y = 0.02 * localFlameScale;
  disc.renderOrder = 1;
  group.add(disc);

  const flameMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uFlame,
      uErupt,
      uInnerRadiusRatio: { value: innerRadiusRatio },
      uOuterRadiusRatio: {
        value: opts.dynamicInnerRadius === true || innerRadiusRatio > 0.001 ? 0.97 : 0.82,
      },
      uLocalFlameScale: { value: localFlameScale },
      uIntensity,
      uReach: { value: 1 }, // declared by FLAME_COMMON, unused here
      uTex: { value: getFlameTex(opts.flameTexUrl ?? '/textures/vfx/ignivar_flame_6x6.webp') },
      uSoot: { value: 0 },
    },
    vertexShader: AOE_FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const flames = new THREE.Mesh(getAoeFlameGeo(count), flameMat);
  flames.name = 'ground_fire_aoe__flames';
  flames.renderOrder = 2;
  group.add(flames);

  let heatTarget = 0;
  let flameTarget = 0;
  return {
    group,
    update(dt: number) {
      dt = Math.min(Math.max(0, dt), 0.05);
      if (usesLocalTime) uTime.value = (uTime.value + dt) % 1000;
      uHeat.value +=
        (heatTarget - uHeat.value) * Math.min(1, dt * (heatTarget > uHeat.value ? 2.2 : 3.0));
      uFlame.value +=
        (flameTarget - uFlame.value) * Math.min(1, dt * (flameTarget > uFlame.value ? 6.0 : 2.6));
      uErupt.value *= Math.exp(-dt * 2.2);
    },
    heatup() {
      heatTarget = 1;
      flameTarget = 0;
    },
    erupt(immediate = false) {
      heatTarget = 1; // the ground stays molten under the burn
      flameTarget = 1;
      uHeat.value = immediate ? 1 : uHeat.value;
      uFlame.value = immediate ? 1 : uFlame.value;
      uErupt.value = immediate ? 0 : 1;
    },
    setInnerRadius(nextInnerRadius: number) {
      if (opts.dynamicInnerRadius !== true) return;
      innerRadius = Math.max(0, Math.min(radius * 0.98, nextInnerRadius));
      discMat.uniforms.uInnerRadiusRatio.value = innerRadius / radius;
      flameMat.uniforms.uInnerRadiusRatio.value = innerRadius / radius;
      group.userData.innerRadius = innerRadius;
    },
    stop() {
      heatTarget = 0;
      flameTarget = 0;
    },
    phase() {
      return flameTarget > 0 ? 'fire' : heatTarget > 0 ? 'heatup' : 'off';
    },
    dispose() {
      group.parent?.remove(group);
      discMat.dispose();
      flameMat.dispose();
      // geos + texture are module-cached on purpose (the raid respawns these)
    },
  };
}
