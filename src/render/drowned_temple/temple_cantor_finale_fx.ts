// Laverock's finale on the Moon Altar (plan: temple_cantor_finale_core.ts),
// composed by temple_fx.ts, the emotional close of the run:
//  - while he sings (his mirrored `guideState`), a column of moonlight falls on
//    him, a pool of light with a ring of crescents opens at his feet, the
//    lagoon round the island stills and glows with the moon's road on it, and
//    motes rise off the water round him; slow streams of light climb off the
//    lagoon toward the moon. This is the steady state: a player who comes in
//    after the song began (no event) still finds it lit.
//  - when his song begins (the sim's id-only `dungeonGuideFinale` event, with
//    where the Choir's fallen lie) the light swells, and each of the fallen
//    breaks into moonlight where they fell, one after another across the song:
//    the body's outline kindles on the stones and fills with light, then the
//    light peels upward off it as motes and wisps while a stream of light
//    climbs from it across the temple toward the moon; then a calm fade back
//    to the steady glow.
// Cosmetic only: nothing here is a cue a player acts on, so the low tier sheds
// density (motes, streams), never the effect.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built once here,
// under the gated temple root (temple_fx.ts attaches it through the compile
// gate, which links hidden meshes too), and only shown or hidden afterwards,
// so nothing links a program after the curtain. The particle pool shares the
// Ysolei glow pool's shader and blending (the crypt particle kit). The CPU
// writes a mote or a stream only when it is born; per frame it sets a few
// uniforms and positions, no allocation.

import * as THREE from 'three';
import { CANTOR_GUIDE_ID, CANTOR_NPC_ID } from '../../sim/content/drowned_temple_cantor';
import { DROWNED_TEMPLE_WATER_LEVEL } from '../../sim/content/drowned_temple_layout';
import { dungeonAt } from '../../sim/data';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { GLOW_FRAG, PARTICLE_VERT, ParticlePool } from '../hollow_crypt/crypt_fx_particles';
import {
  ALTAR_FROM_STAND,
  AMBIENT_STREAMS_PER_SEC,
  altarFromSinger,
  ambientStream,
  bodyShape,
  FADE_SEC,
  fallenStream,
  finaleIntensity,
  LAGOON_GLOW,
  lagoonStillness,
  MOON_DRIFT,
  type MoteLaunch,
  moteBudget,
  RISE_EMIT_SEC,
  RISE_LEAD_SEC,
  RISE_MOTES,
  RISE_WISPS,
  type RiseSpot,
  riseMote,
  riseSchedule,
  riseWisp,
  SONG_MOTES_PER_SEC,
  STREAM_LIFE,
  STREAMS_PER_FALLEN,
  type StreamLaunch,
  songMote,
} from './temple_cantor_finale_core';

const SCAN_SEC = 0.5;
/** Risings kept at once: a full run's fallen (about 35) with room to spare,
 *  and with the pool below sized so no live mote is ever recycled mid-flight. */
const MAX_RISES = 48;
/** Room in the pool past the risings: the song's live motes and the bursts. */
const POOL_SPARE = 400;
/** The song's motes are born in small batches, a few uploads a second rather
 *  than one every frame, for as long as he sings. */
const SONG_BATCH_SEC = 0.5;
/** Stream slots: every fallen's streams in flight at once, plus the lagoon's. */
const STREAM_SLOTS = MAX_RISES * STREAMS_PER_FALLEN + 24;
/** Seconds a fallen body's glow lives (kindle, fill, break up). */
const BODY_LIFE = 4;
/** The column's height over him (yards) and the pool of light's radius. */
const COLUMN_H = 64;
const POOL_R = 6.5;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

// The column of moonlight on him: brightest on its axis, bands of light
// climbing it and sparks rising through it, fading high into the sky.
const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDist;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const COLUMN_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDist;
${NOISE}
void main() {
  float axis = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
  float bands = vnoise(vec2(vUv.x * 12.0, vUv.y * 26.0 - uTime * 1.1));
  vec2 cell = vec2(vUv.x * 70.0, vUv.y * 200.0 - uTime * 9.0);
  float spark = step(0.988, h21(floor(cell))) * smoothstep(0.5, 0.0, length(fract(cell) - 0.5));
  float fadeUp = smoothstep(1.0, 0.12, vUv.y) * smoothstep(0.0, 0.025, vUv.y);
  // Thinner where it falls on him, so he reads inside the light.
  float body = mix(0.4, 1.0, smoothstep(0.02, 0.09, vUv.y));
  // A camera inside (or brushing) the column sees its wall dissolve, never a
  // screen-filling sheet of light.
  float near = smoothstep(2.5, 7.0, vDist);
  float a = (axis * axis * (0.3 + 0.7 * bands) * 0.42 * body + spark * 0.9) * fadeUp * near * uAlpha;
  vec3 col = mix(vec3(0.42, 0.62, 1.0), vec3(0.88, 0.94, 1.0), clamp(bands * axis + spark, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const FLAT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec2 vP;
void main() {
  vUv = uv;
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The pool of light at his feet: a soft glow, a silver ring and a ring of
// crescents turning slowly round him.
const POOL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
const float TAU = 6.2831853;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float ang = atan(c.y, c.x) + uTime * 0.07;
  float glow = pow(max(1.0 - r, 0.0), 1.7);
  float q1 = (r - 0.86) / 0.025;
  float q2 = (r - 0.5) / 0.015;
  float ring = exp(-q1 * q1) + 0.5 * exp(-q2 * q2);
  float seg = TAU / 10.0;
  float k = (fract(ang / seg) - 0.5) * seg * 0.68;
  float lv = r - 0.68;
  float cres = smoothstep(0.075, 0.065, length(vec2(k, lv))) * smoothstep(0.05, 0.06, length(vec2(k, lv - 0.03)));
  float breathe = 0.85 + 0.15 * sin(uTime * 1.3);
  float a = (glow * 0.55 * breathe + ring * 0.55 + cres * 0.75) * uAlpha;
  vec3 col = mix(vec3(0.42, 0.62, 1.0), vec3(0.9, 0.95, 1.0), clamp(ring + cres, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// The lagoon round the island: a silver sheen, the moon's road of glitter
// toward the moon, and rings of stir running out from the island that die
// away as the water stills.
const LAGOON_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uStill;
uniform vec2 uMoon;
uniform vec2 uRange;
varying vec2 vP;
${NOISE}
void main() {
  float r = length(vP);
  float rn = (r - uRange.x) / (uRange.y - uRange.x);
  float edge = smoothstep(0.0, 0.1, rn) * smoothstep(1.0, 0.5, rn);
  vec2 d = vP / max(r, 1e-3);
  float road = pow(max(dot(d, uMoon), 0.0), 26.0);
  float glit = vnoise(vP * 0.6 + vec2(uTime * 0.12, -uTime * 0.09));
#ifdef LAGOON_LOW
  float sparkle = smoothstep(0.55, 0.95, glit) * 0.6;
#else
  float sparkle = smoothstep(0.84, 0.98, vnoise(vP * 1.3 + vec2(uTime * 0.4, uTime * 0.25)));
#endif
  float ripple = 0.5 + 0.5 * sin(r * 0.5 - uTime * 1.5 + glit * 2.5);
  float stir = (1.0 - uStill) * ripple;
  float sheen = 0.08 + 0.06 * glit + stir * 0.12 + uStill * 0.04;
  float a = (sheen + road * (0.6 + 1.2 * sparkle)) * edge * mix(1.0, 0.3, rn) * uAlpha;
  vec3 col = mix(vec3(0.26, 0.46, 0.86), vec3(0.85, 0.93, 1.0), clamp(road * 0.8 + sparkle * road, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// A fallen body's glow on the stones (instanced): the outline kindles, the
// body fills with light, then it breaks up from the edges in and is gone.
const BODY_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
attribute vec4 aBody;  // x, y, z, yaw
attribute vec4 aDims;  // length, width, start, seed
varying vec2 vL;
varying float vAge;
varying float vSeed;
void main() {
  vAge = uTime - aDims.z;
  vSeed = aDims.w;
  if (vAge < 0.0 || vAge > ${BODY_LIFE.toFixed(1)}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vL = position.xy * 3.0;
  // Local y runs to -z so the quad's front face looks up (FrontSide culls the
  // back); world space directly: the finale root is never transformed.
  vec2 l = vec2(vL.x * aDims.x, -vL.y * aDims.y) * 0.5;
  float c = cos(aBody.w), s = sin(aBody.w);
  // A hand over the stones, so a body fallen on a stair still shows its outline.
  vec3 w = vec3(aBody.x + l.x * c - l.y * s, aBody.y + 0.22, aBody.z + l.x * s + l.y * c);
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const BODY_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
varying vec2 vL;
varying float vAge;
varying float vSeed;
${NOISE}
void main() {
  float e = length(vL);
  float kindle = smoothstep(0.0, 0.9, vAge);
  float qr = (e - 1.0) / 0.16;
  float rim = exp(-qr * qr) * kindle;
  float fill = smoothstep(0.6, 1.5, vAge) * smoothstep(1.05, 0.15, e);
  float halo = exp(-max(e - 1.0, 0.0) * 2.2) * 0.5 * kindle;
  float n = vnoise(vL * 2.6 + vSeed * 17.0 + vec2(0.0, -vAge * 0.6));
  float gone = smoothstep(1.7, ${BODY_LIFE.toFixed(1)}, vAge);
  float keep = 1.0 - smoothstep(n - 0.15, n + 0.1, gone * 1.15 + (e - 0.5) * 0.25 * gone);
  float a = (rim * 2.0 + fill * 1.0 + halo) * keep * uAlpha;
  vec3 col = mix(vec3(0.45, 0.66, 1.0), vec3(0.9, 0.95, 1.0), clamp(rim * 0.7 + fill * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// A stream of light climbing to the moon (instanced ribbons): its head climbs
// the sky, its tail follows off the ground, a sway along it, light flowing up.
const STREAM_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
uniform vec2 uMoon;
attribute vec4 aOrigin;  // x, y, z, start
attribute vec4 aShape;   // seed, height, reach, width
attribute float aBright;
varying vec2 vUv;
varying float vA;
varying float vS;
varying float vSeed;
vec3 streamPath(float s) {
  float sway = sin(s * 4.5 + aShape.x * 19.0 + uTime * 0.7) * (0.5 + 3.4 * s)
    + sin(s * 11.0 + aShape.x * 7.0 - uTime * 1.3) * 0.5 * s;
  vec2 side = vec2(-uMoon.y, uMoon.x);
  return aOrigin.xyz + vec3(0.0, aShape.y * s, 0.0)
    + vec3(uMoon.x, 0.0, uMoon.y) * aShape.z * s * s
    + vec3(side.x, 0.0, side.y) * sway;
}
void main() {
  float life = ${STREAM_LIFE.toFixed(2)};
  float age = uTime - aOrigin.w;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float s = position.y + 0.5;
  float head = clamp(age / (life * 0.6), 0.0, 1.0);
  float tail = clamp((age - life * 0.3) / (life * 0.7), 0.0, 1.0);
  float ss = mix(tail, head, s);
  vec4 v = wocCamRelView(streamPath(ss));
  vec4 v2 = wocCamRelView(streamPath(ss + 0.01));
  vec2 dir = v2.xy - v.xy;
  dir = dir / max(length(dir), 1e-5);
  float w = aShape.w * mix(1.0, 0.55, ss);
  v.xy += vec2(-dir.y, dir.x) * position.x * w;
  gl_Position = projectionMatrix * v;
  vUv = vec2(position.x + 0.5, s);
  vS = ss;
  vSeed = aShape.x;
  vA = aBright * smoothstep(0.0, 0.6, age) * (1.0 - smoothstep(life * 0.7, life, age));
}
`;

const STREAM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying float vA;
varying float vS;
varying float vSeed;
${NOISE}
void main() {
  float across = max(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0);
  float core = pow(max(across, 0.0), 1.5) * 0.8 + 0.35 * sqrt(across);
  float ends = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
  float flow = vnoise(vec2(vUv.x * 3.0 + vSeed * 9.0, vS * 34.0 - uTime * 2.6));
  float a = core * ends * (0.45 + 0.9 * flow) * vA * uAlpha;
  vec3 col = mix(vec3(0.45, 0.65, 1.0), vec3(0.92, 0.96, 1.0), clamp(core * flow, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

interface Rise {
  spot: RiseSpot;
  index: number;
  emitted: number;
  debt: number;
  flared: boolean;
}

type Uniform<T> = { value: T };

function additive(
  name: string,
  vert: string,
  frag: string,
  uniforms: Record<string, Uniform<unknown>>,
  side: THREE.Side = THREE.FrontSide,
): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
  });
  m.name = name;
  return m;
}

export class TempleCantorFinaleFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly material: THREE.ShaderMaterial;
  private readonly pool: ParticlePool;
  private readonly rises: Rise[] = [];
  private readonly density: number;
  private readonly streamsPerFallen: number;
  private readonly wisps: number;
  // the steady light
  private readonly uLight = { value: 0 };
  private readonly uLagoon = { value: 0 };
  private readonly uStill = { value: 0 };
  private readonly column: THREE.Mesh;
  private readonly footPool: THREE.Mesh;
  private readonly lagoon: THREE.Mesh;
  private readonly flatMats: THREE.ShaderMaterial[] = [];
  // the fallen's glows and the streams
  private readonly bodyGeo: THREE.InstancedBufferGeometry;
  private readonly bodyAttr: THREE.InstancedBufferAttribute;
  private readonly bodyDims: THREE.InstancedBufferAttribute;
  private readonly bodyMesh: THREE.Mesh;
  private bodyCursor = 0;
  private bodyLastDeath = -1;
  private readonly streamGeo: THREE.InstancedBufferGeometry;
  private readonly streamOrigin: THREE.InstancedBufferAttribute;
  private readonly streamShape: THREE.InstancedBufferAttribute;
  private readonly streamBright: THREE.InstancedBufferAttribute;
  private readonly streamMesh: THREE.Mesh;
  private streamCursor = 0;
  private streamLastDeath = -1;
  private streamDirty = false;
  private bodyDirty = false;
  private ambientDebt = 0;
  private ambientCount = 0;
  private singerId: number | null = null;
  private scan = 0;
  private songDebt = 0;
  private songCount = 0;
  private songWait = 0;
  private finaleNpc: number | null = null;
  /** Clock time this client saw the song begin (-1: it never did). */
  private songAt = -1;
  /** Clock time this client found him singing (-1: he is not). */
  private seenAt = -1;
  /** The light's level as it fades out after the song (or on leaving). */
  private fading = 0;
  private readonly lastAnchor = { x: 0, y: 0, z: 0 };
  private clock = 0;
  private disposed = false;

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    detail: boolean,
  ) {
    this.root.name = 'drowned-temple-cantor-finale';
    parent.add(this.root);
    this.density = detail ? 1 : 0.4;
    this.streamsPerFallen = detail ? STREAMS_PER_FALLEN : 1;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      vertexShader: PARTICLE_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.material.name = 'drownedTempleCantorFinaleMotes';
    // Sized from the per-tier counts so no live mote is recycled mid-flight.
    this.wisps = detail ? RISE_WISPS : Math.ceil(RISE_WISPS * 0.5);
    const perRise = 1 + this.wisps + Math.ceil(RISE_MOTES * this.density);
    this.pool = new ParticlePool(MAX_RISES * perRise + POOL_SPARE, this.material, 13);
    this.root.add(this.pool.mesh);

    // The column of moonlight on him (its base at his feet, rising out of sight).
    const colGeo = new THREE.CylinderGeometry(2.4, 3.6, COLUMN_H, 40, 1, true);
    colGeo.translate(0, COLUMN_H / 2 - 0.3, 0);
    const colMat = additive(
      'drownedTempleCantorColumn',
      COLUMN_VERT,
      COLUMN_FRAG,
      { uTime: this.uTime, uAlpha: this.uLight },
      THREE.DoubleSide,
    );
    colMat.forceSinglePass = true;
    this.column = new THREE.Mesh(colGeo, colMat);
    this.column.name = 'drownedTempleCantorColumn';
    this.column.frustumCulled = false;
    this.column.visible = false;
    this.root.add(this.column);

    // The pool of light at his feet.
    const poolGeo = new THREE.CircleGeometry(POOL_R, 72);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = additive('drownedTempleCantorPool', FLAT_VERT, POOL_FRAG, {
      uTime: this.uTime,
      uAlpha: this.uLight,
    });
    this.footPool = new THREE.Mesh(poolGeo, poolMat);
    this.footPool.name = 'drownedTempleCantorPool';
    this.footPool.renderOrder = floorVfxRenderOrder('ground', 6);
    this.footPool.visible = false;
    this.root.add(this.footPool);

    // The lagoon's glow round the island (lying on the water).
    const lagGeo = new THREE.RingGeometry(LAGOON_GLOW.inner, LAGOON_GLOW.outer, 160, 6);
    lagGeo.rotateX(-Math.PI / 2);
    // The ring's own plane coordinates for the shader (x, -z after the turn).
    const lp = lagGeo.getAttribute('position');
    const local = new Float32Array(lp.count * 2);
    for (let i = 0; i < lp.count; i++) {
      local[i * 2] = lp.getX(i);
      local[i * 2 + 1] = lp.getZ(i);
    }
    lagGeo.setAttribute('aPlane', new THREE.BufferAttribute(local, 2));
    const moonLen = Math.hypot(MOON_DRIFT.x, MOON_DRIFT.z);
    const lagMat = additive(
      'drownedTempleCantorLagoon',
      FLAT_VERT.replace('vP = position.xy;', 'vP = aPlane;').replace(
        'varying vec2 vP;',
        'attribute vec2 aPlane;\nvarying vec2 vP;',
      ),
      LAGOON_FRAG,
      {
        uTime: this.uTime,
        uAlpha: this.uLagoon,
        uStill: this.uStill,
        uMoon: { value: new THREE.Vector2(MOON_DRIFT.x / moonLen, MOON_DRIFT.z / moonLen) },
        uRange: { value: new THREE.Vector2(LAGOON_GLOW.inner, LAGOON_GLOW.outer) },
      },
    );
    // The low tier's lagoon skips the second noise (its glitter): a big surface
    // on screen for as long as he sings. Fixed at construction, before the gate.
    if (!detail) lagMat.defines = { LAGOON_LOW: '' };
    this.lagoon = new THREE.Mesh(lagGeo, lagMat);
    this.lagoon.name = 'drownedTempleCantorLagoon';
    this.lagoon.frustumCulled = false;
    this.lagoon.renderOrder = floorVfxRenderOrder('ground', 4);
    this.lagoon.visible = false;
    this.root.add(this.lagoon);
    this.flatMats.push(colMat, poolMat, lagMat);

    // The fallen's glows on the stones (one instance per rising).
    const quad = new THREE.PlaneGeometry(1, 1);
    this.bodyGeo = new THREE.InstancedBufferGeometry();
    this.bodyGeo.index = quad.index;
    this.bodyGeo.setAttribute('position', quad.getAttribute('position'));
    const dyn = (n: number, size: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(
        THREE.DynamicDrawUsage,
      );
    this.bodyAttr = dyn(MAX_RISES, 4);
    this.bodyDims = dyn(MAX_RISES, 4);
    for (let i = 0; i < MAX_RISES; i++) this.bodyDims.setXYZW(i, 1, 1, -1e6, 0);
    this.bodyGeo.setAttribute('aBody', this.bodyAttr);
    this.bodyGeo.setAttribute('aDims', this.bodyDims);
    this.bodyGeo.instanceCount = MAX_RISES;
    const bodyMat = additive('drownedTempleCantorFallenGlow', BODY_VERT, BODY_FRAG, {
      uTime: this.uTime,
      uAlpha: { value: 1 },
    });
    this.bodyMesh = new THREE.Mesh(this.bodyGeo, bodyMat);
    this.bodyMesh.name = 'drownedTempleCantorFallenGlow';
    this.bodyMesh.frustumCulled = false;
    this.bodyMesh.renderOrder = floorVfxRenderOrder('ground', 5);
    this.bodyMesh.visible = false;
    this.root.add(this.bodyMesh);

    // The streams of light (ribbons climbing to the moon).
    const ribbon = new THREE.PlaneGeometry(1, 1, 1, 32);
    this.streamGeo = new THREE.InstancedBufferGeometry();
    this.streamGeo.index = ribbon.index;
    this.streamGeo.setAttribute('position', ribbon.getAttribute('position'));
    this.streamOrigin = dyn(STREAM_SLOTS, 4);
    this.streamShape = dyn(STREAM_SLOTS, 4);
    this.streamBright = dyn(STREAM_SLOTS, 1);
    for (let i = 0; i < STREAM_SLOTS; i++) this.streamOrigin.setXYZW(i, 0, 0, 0, -1e6);
    this.streamGeo.setAttribute('aOrigin', this.streamOrigin);
    this.streamGeo.setAttribute('aShape', this.streamShape);
    this.streamGeo.setAttribute('aBright', this.streamBright);
    this.streamGeo.instanceCount = STREAM_SLOTS;
    const streamMat = additive(
      'drownedTempleCantorStreams',
      STREAM_VERT,
      STREAM_FRAG,
      {
        uTime: this.uTime,
        uAlpha: { value: 1 },
        uMoon: { value: new THREE.Vector2(MOON_DRIFT.x / moonLen, MOON_DRIFT.z / moonLen) },
      },
      THREE.DoubleSide,
    );
    streamMat.forceSinglePass = true;
    this.streamMesh = new THREE.Mesh(this.streamGeo, streamMat);
    this.streamMesh.name = 'drownedTempleCantorStreams';
    this.streamMesh.frustumCulled = false;
    this.streamMesh.visible = false;
    this.root.add(this.streamMesh);
    this.flatMats.push(bodyMat, streamMat);
    quad.dispose();
    ribbon.dispose();
  }

  handleEvent(ev: SimEvent): void {
    if (this.disposed || ev.type !== 'dungeonGuideFinale') return;
    // Laverock's finale only (another guide's finale is not moonlight), once
    // per song.
    if (ev.guideId !== CANTOR_GUIDE_ID || ev.npcId === this.finaleNpc) return;
    this.finaleNpc = ev.npcId;
    const schedule = riseSchedule(ev.spots, this.clock);
    for (let i = 0; i < schedule.length && this.rises.length < MAX_RISES; i++) {
      this.rises.push({ spot: schedule[i], index: i, emitted: 0, debt: 0, flared: false });
    }
    this.singerId = ev.npcId;
    this.songAt = this.clock;
    if (this.seenAt < 0) this.seenAt = this.clock;
    // The first note: a soft burst of moonlight round him.
    const e = this.world?.entities.get(ev.npcId);
    if (e) {
      for (let k = 0; k < 2; k++) {
        this.emit({
          x: e.pos.x,
          y: e.pos.y + 1.4 + k * 1.6,
          z: e.pos.z,
          vx: 0,
          vy: 0.5,
          vz: 0,
          ay: 0,
          life: 3,
          drag: 0.4,
          size0: 9 - k * 2,
          size1: 3,
          r: 0.8,
          g: 0.9,
          b: 1,
          a: 0.55,
        });
      }
    }
  }

  update(dt: number, clock: number): void {
    if (this.disposed) return;
    this.clock = clock;
    this.uTime.value = clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanSinger();
    }
    this.updateRises(dt, clock);
    this.updateSong(dt);
    this.updateLight(dt, clock);
    if (this.bodyDirty) {
      this.bodyAttr.needsUpdate = true;
      this.bodyDims.needsUpdate = true;
      this.bodyDirty = false;
    }
    if (this.streamDirty) {
      this.streamOrigin.needsUpdate = true;
      this.streamShape.needsUpdate = true;
      this.streamBright.needsUpdate = true;
      this.streamDirty = false;
    }
    this.bodyMesh.visible = clock <= this.bodyLastDeath;
    this.streamMesh.visible = clock <= this.streamLastDeath;
    this.pool.update(clock);
  }

  private emit(m: MoteLaunch): void {
    this.pool.emit(this.uTime.value, m);
  }

  private launchStream(s: StreamLaunch): void {
    const i = this.streamCursor;
    this.streamCursor = (this.streamCursor + 1) % STREAM_SLOTS;
    this.streamOrigin.setXYZW(i, s.x, s.y, s.z, s.at);
    this.streamShape.setXYZW(i, s.seed, s.height, s.reach, s.width);
    this.streamBright.setX(i, s.bright);
    this.streamLastDeath = Math.max(this.streamLastDeath, s.at + STREAM_LIFE);
    this.streamDirty = true;
  }

  private kindleBody(r: Rise): void {
    const i = this.bodyCursor;
    this.bodyCursor = (this.bodyCursor + 1) % MAX_RISES;
    const b = bodyShape(r.index);
    this.bodyAttr.setXYZW(i, r.spot.x, r.spot.y, r.spot.z, b.yaw);
    this.bodyDims.setXYZW(i, b.len, b.wid, r.spot.at, (r.index * 0.6180339887) % 1);
    this.bodyLastDeath = Math.max(this.bodyLastDeath, r.spot.at + BODY_LIFE);
    this.bodyDirty = true;
  }

  private updateRises(dt: number, clock: number): void {
    const perSec = (RISE_MOTES * this.density) / RISE_EMIT_SEC;
    for (let i = this.rises.length - 1; i >= 0; i--) {
      const r = this.rises[i];
      // The outline kindles a beat before the light peels off it.
      if (clock < r.spot.at) continue;
      if (!r.flared) {
        r.flared = true;
        this.kindleBody(r);
        for (let k = 0; k < this.streamsPerFallen; k++) {
          this.launchStream(fallenStream(r.spot, r.index, k));
        }
        // The body gives itself up: a wide soft flare where it lay.
        this.emit({
          x: r.spot.x,
          y: r.spot.y + 0.6,
          z: r.spot.z,
          vx: 0,
          vy: 0.7,
          vz: 0,
          ay: 0,
          life: 2.6,
          drag: 0.5,
          size0: 5.5,
          size1: 2,
          r: 0.78,
          g: 0.88,
          b: 1,
          a: 0.65,
        });
        for (let k = 0; k < this.wisps; k++) this.emit(riseWisp(r.spot, r.index, k));
      }
      // The light peels off once the body has filled (BODY_FRAG's fill).
      if (clock < r.spot.at + 0.8) continue;
      const b = moteBudget(r.debt, dt, perSec);
      r.debt = b.debt;
      for (let k = 0; k < b.count; k++) this.emit(riseMote(r.spot, r.index, r.emitted++));
      if (clock >= r.spot.at + 0.8 + RISE_EMIT_SEC) this.rises.splice(i, 1);
    }
  }

  private scanSinger(): void {
    const world = this.world;
    if (!world) return;
    // Only inside the Drowned Temple is there anyone to find.
    if (dungeonAt(world.player.pos.x)?.id !== 'drowned_temple') {
      this.singerId = null;
      return;
    }
    if (this.singerId !== null) {
      const e = world.entities.get(this.singerId);
      if (e?.guideState === 'singing') return;
      this.singerId = null;
    }
    // A late arrival (or a reload) finds him already singing.
    for (const e of world.entities.values()) {
      if (e.kind === 'npc' && e.templateId === CANTOR_NPC_ID && e.guideState === 'singing') {
        this.singerId = e.id;
        return;
      }
    }
  }

  private singer(): { pos: { x: number; y: number; z: number } } | null {
    if (this.singerId === null || !this.world) return null;
    const e = this.world.entities.get(this.singerId);
    return e && e.guideState === 'singing' ? e : null;
  }

  private updateSong(dt: number): void {
    const e = this.singer();
    if (!e) return;
    this.songWait += dt;
    if (this.songWait < SONG_BATCH_SEC) return;
    const span = this.songWait;
    this.songWait = 0;
    const b = moteBudget(this.songDebt, span, SONG_MOTES_PER_SEC * this.density);
    this.songDebt = b.debt;
    for (let k = 0; k < b.count; k++) {
      this.emit(songMote(e.pos.x, e.pos.y, e.pos.z, this.songCount++));
    }
    // Slow streams off the lagoon while he sings on (not over the fallen's own).
    const since = this.songAt >= 0 ? this.clock - this.songAt : Number.POSITIVE_INFINITY;
    if (since > RISE_LEAD_SEC) {
      const a = altarFromSinger(e.pos.x, e.pos.z);
      const s = moteBudget(this.ambientDebt, span, AMBIENT_STREAMS_PER_SEC * this.density);
      this.ambientDebt = s.debt;
      for (let k = 0; k < s.count; k++) {
        this.launchStream(
          ambientStream(a.x, a.z, DROWNED_TEMPLE_WATER_LEVEL, this.ambientCount++, this.clock),
        );
      }
    }
  }

  /** The column, the pool at his feet and the lagoon: swell, hold, calm to
   *  the steady glow while he sings, fade out when he stops (or we leave). */
  private updateLight(dt: number, clock: number): void {
    const e = this.singer();
    let level: number;
    let still: number;
    if (e) {
      if (this.seenAt < 0) this.seenAt = clock;
      const sinceSong = this.songAt >= 0 ? clock - this.songAt : null;
      level = finaleIntensity(sinceSong, clock - this.seenAt);
      still = lagoonStillness(sinceSong, clock - this.seenAt);
      this.lastAnchor.x = e.pos.x;
      this.lastAnchor.y = e.pos.y;
      this.lastAnchor.z = e.pos.z;
      this.fading = level;
    } else {
      this.seenAt = -1;
      this.fading = Math.max(0, this.fading - dt / FADE_SEC);
      level = this.fading;
      still = this.uStill.value;
    }
    const on = level > 0.002;
    this.column.visible = on;
    this.footPool.visible = on;
    this.lagoon.visible = on;
    if (!on) return;
    const { x, y, z } = this.lastAnchor;
    this.column.position.set(x, y, z);
    this.footPool.position.set(x, y + 0.07, z);
    this.lagoon.position.set(
      x + ALTAR_FROM_STAND.x,
      DROWNED_TEMPLE_WATER_LEVEL + 0.07,
      z + ALTAR_FROM_STAND.z,
    );
    this.uLight.value = level;
    this.uLagoon.value = level;
    this.uStill.value = still;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.pool.dispose();
    this.material.dispose();
    this.column.geometry.dispose();
    this.footPool.geometry.dispose();
    this.lagoon.geometry.dispose();
    this.bodyGeo.dispose();
    this.streamGeo.dispose();
    for (const m of this.flatMats) m.dispose();
  }
}
