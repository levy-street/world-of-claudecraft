// The Fogbeacon's light: the great lamp burning in the lantern room, the
// warm-white beam sweeping the headland through the fog (the one warm light
// on the roof, and the tell that finds the real Vael among his fog shades),
// and Vael's sickly green fog pouring off the lamp and down the cliffs over
// the fen-sea.
//
// The beam turns on the shared clock while idle; Vael's encounter visuals
// take it over through setBeaconYaw (the sim's lamp entity carries the yaw
// online and offline alike). The beam is ACTIONABLE during Vael (the reveal),
// so it draws on every graphics tier; the fog streams are cosmetic and shed.

import * as THREE from 'three';
import { BEACON_CROWN } from '../../sim/content/sunken_bastion_layout';
import { sharedUniforms } from '../gfx';
import { radialGlowTexture } from '../textures';
import {
  BASTION_FOG_STREAMS,
  BEACON_IDLE_PERIOD,
  BEACON_LAMP,
  resampleStream,
} from './bastion_plan_core';

/** Length of the beam from the lamp (yards) and its radius at the far end. */
export const BEACON_BEAM_LENGTH = 150;
export const BEACON_BEAM_FAR_RADIUS = 13;

/** The beam's dip (radians below level): a touch while idle; during the
 *  Fog Veil it aims at the crown's rim, where the sim stands the figures. */
const IDLE_PITCH = 0.06;
const VEIL_PITCH = Math.atan2(BEACON_LAMP[1] - BEACON_CROWN.h, BEACON_CROWN.r - 5);

// Per interior (slot origin key) override of the beam's yaw; null = idle sweep.
const yawOverride = new Map<string, number>();

function slotKey(ox: number, oz: number): string {
  return `${Math.round(ox)}|${Math.round(oz)}`;
}

/** Drive the beam of the Bastion at slot (ox, oz): a yaw (sim convention), or
 *  null to hand it back to the idle sweep. */
export function setBeaconYaw(ox: number, oz: number, yaw: number | null): void {
  if (yaw === null) yawOverride.delete(slotKey(ox, oz));
  else yawOverride.set(slotKey(ox, oz), yaw);
}

const BEAM_VERT = /* glsl */ `
uniform float uYaw;
uniform float uPitch;
uniform float uLength;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vAxisW;
varying vec3 vOriginW;
void main() {
  vLocal = position;
  // Turn the beam about the tower's vertical axis (sim yaw: sin x, cos z).
  // Dip it first (down toward the roof), then turn it.
  float cp = cos(uPitch);
  float sp = sin(uPitch);
  vec3 d = vec3(position.x, position.y * cp - position.z * sp, position.y * sp + position.z * cp);
  float c = cos(uYaw);
  float s = sin(uYaw);
  vec3 p = vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vOriginW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vAxisW = normalize(mat3(modelMatrix) * vec3(s * cp, -sp, c * cp));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BEAM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLength;
uniform float uFar;
uniform vec3 uColor;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec3 vAxisW;
varying vec3 vOriginW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  // Along the beam (0 at the lamp, 1 at its far end) and across it.
  float along = clamp(vLocal.z / uLength, 0.0, 1.0);
  float radius = mix(0.9, uFar, along);
  float across = length(vLocal.xy) / radius;
  // Looking down the beam's core reads brighter (a volume, not a cone skin).
  vec3 view = normalize(cameraPosition - vWorld);
  float grazing = 1.0 - abs(dot(view, vAxisW));
  float core = pow(max(0.0, 1.0 - across), 1.6);
  // Fog motes drifting through the light.
  float dust = noise(vec2(vLocal.z * 0.18 - uTime * 0.9, atan(vLocal.y, vLocal.x) * 3.0)) * 0.5
    + noise(vec2(vLocal.z * 0.05 - uTime * 0.3, vLocal.x * 0.3)) * 0.5;
  float fall = pow(max(1.0 - along, 0.0), 1.35) * smoothstep(0.0, 0.03, along);
  float i = core * fall * (0.5 + 0.5 * dust) * (0.6 + 0.4 * grazing) * 1.35;
  gl_FragColor = vec4(uColor * i, i);
  #include <colorspace_fragment>
}
`;

function buildBeam(ox: number, oz: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(
    BEACON_BEAM_FAR_RADIUS,
    0.9,
    BEACON_BEAM_LENGTH,
    28,
    8,
    true,
  )
    // The cylinder's +Y end is the lamp: lay it along +Z from its origin.
    .rotateX(-Math.PI / 2)
    .translate(0, 0, BEACON_BEAM_LENGTH / 2);
  const uniforms = {
    uTime: sharedUniforms.uTime,
    uYaw: { value: 0 },
    uPitch: { value: IDLE_PITCH },
    uLength: { value: BEACON_BEAM_LENGTH },
    uFar: { value: BEACON_BEAM_FAR_RADIUS },
    uColor: { value: new THREE.Color(0xffe9b8) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionBeaconBeam',
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sunkenBastionBeaconBeam';
  // The beam tilts a little down toward the roof and the fen below it.
  mesh.position.set(BEACON_LAMP[0], BEACON_LAMP[1], BEACON_LAMP[2]);
  mesh.frustumCulled = false;
  mesh.renderOrder = 22;
  const key = slotKey(ox, oz);
  let lastT = sharedUniforms.uTime.value;
  mesh.onBeforeRender = () => {
    const forced = yawOverride.get(key);
    const now = sharedUniforms.uTime.value;
    const dt = Math.min(0.1, Math.max(0, now - lastT));
    lastT = now;
    uniforms.uYaw.value = forced ?? ((now / BEACON_IDLE_PERIOD) * Math.PI * 2) % (Math.PI * 2);
    // During the Fog Veil the beam swings down onto the crown's rim, where
    // the veiled figures stand; it eases back up after.
    const want = forced === undefined ? IDLE_PITCH : VEIL_PITCH;
    uniforms.uPitch.value += (want - uniforms.uPitch.value) * Math.min(1, dt * 2.5);
  };
  return mesh;
}

function buildLampGlow(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunkenBastionBeaconLamp';
  const warm = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: 0xfff0c8,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: 'sunkenBastionLampWarm',
    }),
  );
  warm.scale.set(16, 16, 1);
  warm.position.set(BEACON_LAMP[0], BEACON_LAMP[1], BEACON_LAMP[2]);
  group.add(warm);
  // Vael's taint: a sick green corona round the lantern room.
  const green = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: 0x7fe0a8,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: 'sunkenBastionLampGreen',
    }),
  );
  green.scale.set(46, 46, 1);
  green.position.set(BEACON_LAMP[0], BEACON_LAMP[1] - 1.5, BEACON_LAMP[2]);
  group.add(green);
  return group;
}

// ---- Vael's fog pouring off the beacon ----------------------------------------------------

const STREAM_VERT = /* glsl */ `
attribute float aStream;
attribute float aPhase;
attribute vec3 aJitter;
uniform float uTime;
uniform vec3 uPath[STREAMS * SAMPLES];
uniform float uSize;
varying float vAlpha;
vec3 pathAt(int river, float s) {
  float f = s * float(SAMPLES - 1);
  int i = int(floor(f));
  i = clamp(i, 0, SAMPLES - 2);
  float t = f - float(i);
  return mix(uPath[river * SAMPLES + i], uPath[river * SAMPLES + i + 1], t);
}
void main() {
  int river = int(aStream + 0.5);
  float s = fract(aPhase + uTime * (0.006 + aJitter.x * 0.003));
  vec3 p = pathAt(river, s);
  float wobble = uTime * (0.25 + aJitter.y * 0.3) + aPhase * 30.0;
  // The fog spreads as it falls.
  float spread = 2.0 + s * 18.0;
  p += vec3(sin(wobble) * aJitter.z, sin(wobble * 1.3) * 0.4, cos(wobble * 0.9) * aJitter.z) * spread;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(220.0, uSize * (1.0 + s * 3.0) * (300.0 / max(1.0, -mv.z)));
  float nearFade = smoothstep(14.0, 60.0, -mv.z);
  vAlpha = nearFade * smoothstep(0.0, 0.05, s) * (1.0 - smoothstep(0.75, 1.0, s));
}
`;

const STREAM_FRAG = /* glsl */ `
precision highp float;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2) * vAlpha * 0.16;
  gl_FragColor = vec4(vec3(0.62, 0.86, 0.7) * a, a);
  #include <colorspace_fragment>
}
`;

const STREAM_SAMPLES = 16;

function buildFogStreams(density: number): THREE.Points {
  const streams = BASTION_FOG_STREAMS;
  const path: THREE.Vector3[] = [];
  for (const r of streams) {
    for (const p of resampleStream(r, STREAM_SAMPLES))
      path.push(new THREE.Vector3(p[0], p[1], p[2]));
  }
  const ids: number[] = [];
  const phases: number[] = [];
  const jitter: number[] = [];
  let seed = 11;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  streams.forEach((r, i) => {
    const n = Math.max(10, Math.round(r.count * density));
    for (let k = 0; k < n; k++) {
      ids.push(i);
      phases.push(rnd());
      jitter.push(rnd(), rnd(), 0.4 + rnd());
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(ids.length * 3), 3),
  );
  geo.setAttribute('aStream', new THREE.Float32BufferAttribute(ids, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geo.setAttribute('aJitter', new THREE.Float32BufferAttribute(jitter, 3));
  const material = new THREE.ShaderMaterial({
    name: 'sunkenBastionFogStreams',
    vertexShader: STREAM_VERT,
    fragmentShader: STREAM_FRAG,
    defines: { STREAMS: streams.length, SAMPLES: STREAM_SAMPLES },
    uniforms: {
      uTime: sharedUniforms.uTime,
      uPath: { value: path },
      uSize: { value: 26 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, material);
  points.name = 'sunkenBastionFogStreams';
  points.frustumCulled = false;
  points.renderOrder = 14;
  return points;
}

/** The Fogbeacon's lamp, beam and fog for the slot at (ox, oz), instance-local. */
export function buildBastionBeacon(
  ox: number,
  oz: number,
  opts: { lowGfx: boolean; density: number },
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sunkenBastionBeacon';
  group.add(buildBeam(ox, oz));
  group.add(buildLampGlow());
  if (!opts.lowGfx) group.add(buildFogStreams(opts.density));
  return group;
}
