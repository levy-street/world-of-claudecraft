// Wraith the Deadstrier's live ghostfire: its mane, tail and fetlock tufts
// are flame objects that burn and move, made of the web-pyre torch simulation
// (ossuary_pyre_field.ts) and moved by the same lean spring as the sprite
// buddy's orb flames (sprites_buddy_flame_core.ts).
//
// The GLB carries the flames as two skinned meshes, `ossuary_fire_core` and the
// thinner `ossuary_fire_halo` around it, with three per-vertex attributes from
// the flame build (scripts/assets/ossuary_charger/build_flames.mjs): `_flamet`
// (0 where the flame roots on the bone, 1 at its edge), `_flameregion` (0 mane,
// 1 tail, 2 legs: which bone's motion drives it), `_flameheat` (the pyre heat
// painted through it) and `_flameseed` (smooth along each flame sheet, so its
// flicker travels as one wave). The mane and the tail are each one flame, a
// sheet whose edge breaks into licks, not a row of strands. Their glTF
// materials are swapped here for one shared shader per layer:
//
// - Fire: the pyre field plays back as a looping 3D texture (lateral, up,
//   frame), scrolling up the tongues so it rises, its linear filter
//   crossfading between the simulated frames. Premultiplied: each flame adds
//   its green and also covers part of what is behind it, so it stays green
//   against a bright sky or a white wall instead of washing out to white.
// - Erosion: the same field sets an alpha cutoff that climbs with height, so
//   roots burn solid while the edge splits into separate licks whose
//   outline re-forms every frame, rather than glowing inside a fixed shape.
// - Physics: each region has a spring stepped from its anchor bone's real
//   world motion (gallop, turn, stop, the gait's own head and tail swing), and
//   the vertex shader bends each tongue away from that motion by the square
//   of its height, so roots stay on the bone and tips stream and overshoot.
//   Tips also pull toward world up, so fire rises whatever the head does.
// - Tail: the tail flame hangs off a short spring chain
//   (ossuary_tail_chain_core.ts) instead of a lean, so the tail lags, swings
//   and settles like hair while keeping the flame look.
// - Shape: each flame is one stylised shell whose licks heave and flutter on
//   smooth noise that travels from the root out to the edge, so swells rise
//   up the flame like real tongues; ripples climb its surface, the pyre field
//   races up through its colour bands, and speed stretches it along its flow.
// - Wisps: small pyre flames peel off the flame's edge, rise and burn out in
//   WORLD space (they trail behind a galloping mount). One instanced draw per
//   mount, a fixed pool, spawned on the CPU from the skinned tip vertices.
//
// Stepped once per rendered frame at the first flame's draw (onBeforeRender),
// so a mount out of the scene costs nothing and renderer.ts gains no call.
// Shared geometry is the GLB's own; the three materials are process-wide and
// marked shared, with per-instance uniform values written before each draw.
import * as THREE from 'three';
import { markRigFx } from './characters/rig_fx';
import { stretchForSpeed } from './ossuary_flame_stretch_core';
import {
  PYRE_FIELD_BASE64,
  PYRE_FIELD_FRAMES,
  PYRE_FIELD_HEIGHT,
  PYRE_FIELD_WIDTH,
} from './ossuary_pyre_field';
import {
  createTailChain,
  stepTailChain,
  TAIL_LINKS,
  type TailChainState,
} from './ossuary_tail_chain_core';
import { markSharedMaterial } from './shared_resource';
import {
  createSpriteFlameState,
  type SpriteFlameState,
  stepSpriteFlame,
} from './sprites_buddy_flame_core';

const STATE_KEY = 'ossuaryFlames';
const LAYERS = ['core', 'halo'] as const;
type Layer = (typeof LAYERS)[number];
const MESH_NAMES: Record<Layer, string> = {
  core: 'ossuary_fire_core',
  halo: 'ossuary_fire_halo',
};

/** Anchor bone per region (GLTFLoader strips the `tripo::` colons). The first
 *  name found wins; a rig missing all of them anchors that region on the root. */
const REGION_BONES: readonly (readonly string[])[] = [
  ['bone_15', 'tripoSpine_1'], // mane: the neck
  ['tripo0_Left_Limb_0', 'tripoSpine_1'], // tail
  ['tripoSpine_1', 'tripoSpine_0'], // legs: the fetlock tufts trail the body's motion
];
/** How far a flame's edge moves per unit of lean, in model units (the flame
 *  lengths in the bind pose; the tail is driven by its spring chain instead, and
 *  the mane barely leans, so it stays neutral over the neck when moving). */
const REGION_REACH = [0.05, 0, 0.08];
/** Flicker sway at a flame's edge per region, in model units (the tail is
 *  longest, so it swings widest). */
const REGION_SWAY = [0.015, 0.03, 0.01];
/** How far speed stretches each shell along its flow at a full gallop (a
 *  third longer). The mane's flow is nearly upright, so it grows up rather
 *  than back into the rider's face. */
const STRETCH_GAIN = 0.3;
/** How strongly each region's tips pull toward world up, as a lean tangent.
 *  The tail hangs, so it does not rise; the mane flows back down the neck like
 *  hair, so it rises only a little. */
const REGION_RISE = [0.15, 0, 0.35];

/** Ghostfire green, (deep, body, bright, core) in sRGB: pyre's blackbody ramp
 *  shifted green. Even the hottest stop stays green, never white. */
const RAMP: [number, number, number][] = [
  [0.0, 0.14, 0.03],
  [0.02, 0.55, 0.1],
  [0.18, 0.95, 0.22],
  [0.55, 1.0, 0.4],
];
/** How much of the background each layer covers, per unit of flame alpha (0
 *  is purely additive). */
const COVER: Record<'wisp', number> = { wisp: 0.4 };
/** How fast the flames' length follows a change of pace, per second. */
const STRETCH_RATE = 4;

const VERTEX = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  attribute float _flamet;
  attribute float _flameregion;
  attribute float _flameseed;
  attribute vec3 _flameoffset;
  uniform vec3 uSway;
  uniform vec3 uLean0;
  uniform vec3 uLean1;
  uniform vec3 uLean2;
  uniform vec3 uTail[${TAIL_LINKS}];
  uniform vec3 uReach;
  uniform vec3 uRise;
  uniform vec3 uUp;
  uniform float uTime;
  uniform float uStretch;
  varying float vT;
  varying float vLateral;
  varying float vRegion;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  float flameHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
  // Smooth 1D value noise: hashed keys eased into one another.
  float flameNoise(float x) {
    float i = floor(x);
    float f = x - i;
    return mix(flameHash(i), flameHash(i + 1.0), f * f * (3.0 - 2.0 * f));
  }
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    // Living shape: every lick's height runs on two smooth noise curves (a
    // slow heave and a quicker flutter), sampled with a lag that grows toward
    // the edge, so each swell is born at the root and travels up and out the
    // lick the way real flame tongues rise, rather than the whole shape
    // bobbing at once. v names the lick and u is 1 at its middle and 0 at the
    // notches, so the outline reshapes while the root holds. Speed stretches
    // every shell along its flow, about a third longer at a full gallop: the
    // mane's flow is nearly upright, so it grows up, not back at the rider.
    // Both act along each point's flow from its root, before skinning.
    float tb = clamp(_flamet, 0.0, 1.0);
    float heave = flameNoise(uv.y * 3.1 + uTime * 2.6 - tb * 1.4);
    float flutter = flameNoise(uv.y * 5.7 + 17.0 + uTime * 6.3 - tb * 2.6);
    float height = 0.65 * heave + 0.35 * flutter;
    float shape = 0.38 * (height - 0.5) * mix(0.35, 1.0, uv.x);
    transformed += _flameoffset * (${STRETCH_GAIN.toFixed(2)} * uStretch + shape);
    #include <skinning_vertex>
    float t = clamp(_flamet, 0.0, 1.0);
    vec3 lean = _flameregion < 0.5 ? uLean0 : (_flameregion < 1.5 ? uLean1 : uLean2);
    float reach = _flameregion < 0.5 ? uReach.x : (_flameregion < 1.5 ? uReach.y : uReach.z);
    float rise = _flameregion < 0.5 ? uRise.x : (_flameregion < 1.5 ? uRise.y : uRise.z);
    // At a gallop the tail and the fetlock flames stream back: they bend
    // further with the motion and pull up less. The mane holds its shape.
    if (_flameregion > 0.5) {
      reach *= 1.0 + 0.3 * uStretch;
      rise *= 1.0 - 0.7 * uStretch;
    }
    // Bend away from the motion by the square of the height: roots stay put.
    // The tips also pull toward world up (uUp, in this mesh's frame).
    transformed += (lean + uUp * rise) * reach * t * t;
    // Flicker: a wave runs up the tongue (phase falls behind with height), so
    // the root holds and the tip whips; two rates per axis keep it from
    // looking like a metronome. The tongue also breathes along its length.
    float sway = _flameregion < 0.5 ? uSway.x : (_flameregion < 1.5 ? uSway.y : uSway.z);
    float ph = _flameseed * 6.2832;
    float w = t * sqrt(t);
    vec3 flick = vec3(
      sin(uTime * 3.1 - t * 3.0 + ph) + 0.45 * sin(uTime * 7.3 - t * 5.0 + ph * 1.7),
      0.35 * sin(uTime * 4.7 + ph * 2.3),
      sin(uTime * 2.6 - t * 2.5 + ph * 1.3) + 0.4 * sin(uTime * 6.1 - t * 4.0 + ph * 0.6)
    );
    transformed += flick * sway * w;
    // The tail hangs off its spring chain: each point's distance from where
    // the rigid tail would be, blended along the tongue.
    if (_flameregion > 0.5 && _flameregion < 1.5) {
      float link = t * float(${TAIL_LINKS - 1});
      int i = int(min(floor(link), float(${TAIL_LINKS - 2})));
      transformed += mix(uTail[i], uTail[i + 1], link - float(i));
    }
    // Ripples run up the shell's surface as the fire rises: two waves climbing
    // from the root at different rates, strongest toward the edge.
    float lick = sin(uTime * 9.0 - t * 7.0 + position.z * 37.0 + _flameseed * 6.0)
      + 0.6 * sin(uTime * 13.7 - t * 11.0 + position.x * 41.0 + position.z * 19.0);
    transformed += normalize(objectNormal) * lick * 0.006 * t;
    vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
    vNormalView = normalize(transformedNormal);
    vViewDir = normalize(-mv.xyz);
    vT = t;
    vRegion = _flameregion;
    vUv = uv;
    // Along the flame line in the bind pose: the neck and tail run along z.
    vLateral = position.z * 0.85 + position.x * 0.5;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler3D uPyre;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  varying float vT;
  varying float vLateral;
  varying float vRegion;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  void main() {
    // Fast detail over slow shape: the pyre field races up the shell (the
    // shape itself only leans, sways slowly and reshapes now and then).
    float frame = fract(uTime * 2.4 + uSeed);
    vec2 st = vec2(vLateral * 7.0 + vRegion * 0.37 + uSeed, vT * 0.85 - uTime * 0.95);
    float fire = texture(uPyre, vec3(st, frame)).r;
    // The outer ridge crinkles: the noise runs along the edge, never up it, so
    // the outline ripples but nothing breaks off (wisps do that).
    float e1 = texture(uPyre, vec3(vLateral * 9.0 + uTime * 0.7 + uSeed, 0.37 + vRegion * 0.21, frame)).r;
    float e2 = texture(uPyre, vec3(vLateral * 23.0 - uTime * 1.3, 0.71, fract(frame + 0.5))).r;
    float edge = 1.0 - 0.07 * e1 - 0.035 * e2;
    if (vT > edge) discard;
    // Flat colour in hard bands, unlit: pale where the fire grows out of the
    // bone, bright green through the body, darker toward the ridge and round
    // the shell's silhouette (so the hull reads as a volume), the pyre field
    // streaking the bands as it rises, and a thin dark rim on the edge.
    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float rim = 1.0 - facing;
    float band = (1.0 - vT) * 0.85 + 0.3 * fire - 0.05 - 0.4 * rim * rim;
    vec3 col = band > 0.62 ? uC3 : (band > 0.16 ? uC2 : uC1);
    col = vT > edge - 0.035 ? uC0 * 1.6 : col;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function linear(rgb: [number, number, number]): THREE.Vector3 {
  const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return new THREE.Vector3(c.r, c.g, c.b);
}

let pyreTexture: THREE.Data3DTexture | null = null;

function pyreFieldTexture(): THREE.Data3DTexture {
  if (pyreTexture) return pyreTexture;
  const bin = atob(PYRE_FIELD_BASE64);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const tex = new THREE.Data3DTexture(data, PYRE_FIELD_WIDTH, PYRE_FIELD_HEIGHT, PYRE_FIELD_FRAMES);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  pyreTexture = tex;
  return tex;
}

const sharedMaterials = new Map<Layer, THREE.ShaderMaterial>();

function flameMaterial(layer: Layer): THREE.ShaderMaterial {
  const cached = sharedMaterials.get(layer);
  if (cached) return cached;
  const [c0, c1, c2, c3] = RAMP.map(linear);
  const material = new THREE.ShaderMaterial({
    name: `ossuary_flame_${layer}`,
    uniforms: {
      uPyre: { value: pyreFieldTexture() },
      uTime: { value: 0 },
      uSeed: { value: 0 },
      uStretch: { value: 0 },
      uLean0: { value: new THREE.Vector3() },
      uLean1: { value: new THREE.Vector3() },
      uLean2: { value: new THREE.Vector3() },
      uTail: { value: Array.from({ length: TAIL_LINKS }, () => new THREE.Vector3()) },
      uReach: { value: new THREE.Vector3(...REGION_REACH) },
      uRise: { value: new THREE.Vector3(...REGION_RISE) },
      uSway: { value: new THREE.Vector3(...REGION_SWAY) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uC0: { value: c0 },
      uC1: { value: c1 },
      uC2: { value: c2 },
      uC3: { value: c3 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // Solid flat colour cut to a crisp edge (the fragment discards outside it),
    // so it draws opaque: depth-correct between the sheets, no sorting.
    side: THREE.DoubleSide,
    fog: false,
  });
  sharedMaterials.set(layer, markSharedMaterial(material));
  return material;
}

// ---------------------------------------------------------------------------
// Wisps: small pyre flames that break off the tongue tips and rise.
// ---------------------------------------------------------------------------

/** Pool size per mount, spawn rate (per second), life range (seconds), rise
 *  speed (world units per second) and size range (world units). */
const WISP_COUNT = 40;
const WISP_RATE = 18;
const WISP_LIFE: [number, number] = [0.45, 0.9];
const WISP_RISE = 1.5;
const WISP_SIZE: [number, number] = [0.32, 0.6];
/** Tip vertices (by `_flamet`) that can shed a wisp. */
const WISP_TIP_T = 0.85;

const WISP_VERTEX = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iLife;
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;
  void main() {
    // Billboard in view space; iPos is in the mount root's frame, the corner
    // offset is added after the view transform so the size stays in world units.
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float size = iLife.y * iLife.w * (1.0 - 0.45 * iLife.x);
    mv.xy += position.xy * size * vec2(0.6, 1.0);
    vUv = uv;
    vAge = iLife.x;
    vSeed = iLife.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const WISP_FRAGMENT = /* glsl */ `
  uniform sampler3D uPyre;
  uniform float uCover;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;
  vec3 ramp(float h) {
    return h < 0.33 ? mix(uC0, uC1, h / 0.33)
      : (h < 0.66 ? mix(uC1, uC2, (h - 0.33) / 0.33) : mix(uC2, uC3, (h - 0.66) / 0.34));
  }
  void main() {
    // One pyre flame per wisp: the simulated column (it sits in the left half of
    // the profile) stepping through its frames as the wisp ages.
    vec3 p = vec3(0.2 + vUv.x * 0.45, 0.04 + vUv.y * 0.85, fract(vSeed + vAge * 0.9));
    float f = texture(uPyre, p).r;
    float fade = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge));
    // Soft-edged so no wisp ever shows its quad.
    float edge = (1.0 - smoothstep(0.3, 0.5, abs(vUv.x - 0.5)))
      * smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
    float alpha = clamp(f * 1.3, 0.0, 1.0) * fade * edge;
    vec3 color = ramp(clamp(f * (0.9 - 0.5 * vAge), 0.0, 1.0));
    gl_FragColor = vec4(color * alpha, clamp(alpha * uCover, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let wispMaterialShared: THREE.ShaderMaterial | null = null;

function wispMaterial(): THREE.ShaderMaterial {
  if (wispMaterialShared) return wispMaterialShared;
  const [c0, c1, c2, c3] = RAMP.map(linear);
  wispMaterialShared = markSharedMaterial(
    new THREE.ShaderMaterial({
      name: 'ossuary_flame_wisp',
      uniforms: {
        uPyre: { value: pyreFieldTexture() },
        uCover: { value: COVER.wisp },
        uC0: { value: c0 },
        uC1: { value: c1 },
        uC2: { value: c2 },
        uC3: { value: c3 },
      },
      vertexShader: WISP_VERTEX,
      fragmentShader: WISP_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      fog: false,
    }),
  );
  return wispMaterialShared;
}

interface Wisps {
  mesh: THREE.Mesh;
  pos: THREE.InstancedBufferAttribute;
  life: THREE.InstancedBufferAttribute;
  /** World position and velocity per slot, and age / lifetime in seconds. */
  world: Float32Array;
  vel: Float32Array;
  age: Float32Array;
  span: Float32Array;
  /** Core-mesh vertex indices that can shed a wisp (with their region). */
  tips: Int32Array;
  tipRegions: Uint8Array;
  owed: number;
  next: number;
}

function createWisps(core: THREE.Mesh): Wisps | null {
  const t = core.geometry.getAttribute('_flamet');
  const region = core.geometry.getAttribute('_flameregion');
  if (!t || !region) return null;
  const tips: number[] = [];
  // Flicks peel off the shells' outer ridge.
  for (let i = 0; i < t.count; i++) if (t.getX(i) >= WISP_TIP_T) tips.push(i);
  if (tips.length === 0) return null;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('uv', quad.getAttribute('uv'));
  const pos = new THREE.InstancedBufferAttribute(new Float32Array(WISP_COUNT * 3), 3);
  const life = new THREE.InstancedBufferAttribute(new Float32Array(WISP_COUNT * 4), 4);
  pos.setUsage(THREE.DynamicDrawUsage);
  life.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('iPos', pos);
  geometry.setAttribute('iLife', life);
  geometry.instanceCount = WISP_COUNT;
  const mesh = markRigFx(new THREE.Mesh(geometry, wispMaterial()));
  mesh.name = 'ossuary_flame_wisps';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return {
    mesh,
    pos,
    life,
    world: new Float32Array(WISP_COUNT * 3),
    vel: new Float32Array(WISP_COUNT * 3),
    age: new Float32Array(WISP_COUNT).fill(1),
    span: new Float32Array(WISP_COUNT).fill(1),
    tips: Int32Array.from(tips),
    tipRegions: Uint8Array.from(tips.map((i) => region.getX(i))),
    owed: 0,
    next: 0,
  };
}

const spawnLocal = new THREE.Vector3();
const leanLocal = new THREE.Vector3();
const rootInverse = new THREE.Matrix4();

function stepWisps(state: OssuaryFlamesState, dt: number, spawn: boolean): void {
  const w = state.wisps;
  if (!w) return;
  const core = state.meshes[0] as THREE.SkinnedMesh;
  // Spawn from the skinned tips, bent the way the shader bends them.
  // More flicks stream off at speed, as the air tears at the fire.
  w.owed = spawn ? w.owed + WISP_RATE * (1 + 1.5 * state.values.stretch) * dt : 0;
  while (w.owed >= 1) {
    w.owed -= 1;
    const k = Math.floor(Math.random() * w.tips.length);
    const vi = w.tips[k];
    const r = w.tipRegions[k];
    if (core.isSkinnedMesh) core.getVertexPosition(vi, spawnLocal);
    else spawnLocal.fromBufferAttribute(core.geometry.getAttribute('position'), vi);
    leanLocal.copy(state.values.leans[r]).addScaledVector(state.values.up, REGION_RISE[r]);
    spawnLocal.addScaledVector(leanLocal, REGION_REACH[r]);
    if (r === 1 && state.tail) spawnLocal.add(state.tail.offsets[TAIL_LINKS - 1]);
    core.localToWorld(spawnLocal);
    const s = w.next;
    w.next = (w.next + 1) % WISP_COUNT;
    w.world[s * 3] = spawnLocal.x;
    w.world[s * 3 + 1] = spawnLocal.y;
    w.world[s * 3 + 2] = spawnLocal.z;
    const rise = WISP_RISE * (0.7 + 0.6 * Math.random());
    w.vel[s * 3] = (Math.random() - 0.5) * 0.4;
    w.vel[s * 3 + 1] = rise;
    w.vel[s * 3 + 2] = (Math.random() - 0.5) * 0.4;
    w.age[s] = 0;
    w.span[s] = WISP_LIFE[0] + (WISP_LIFE[1] - WISP_LIFE[0]) * Math.random();
    w.life.setY(s, WISP_SIZE[0] + (WISP_SIZE[1] - WISP_SIZE[0]) * Math.random());
    w.life.setZ(s, Math.random());
  }
  // Age and move in world space, then express in the mount root's frame.
  rootInverse.copy(state.root.matrixWorld).invert();
  for (let s = 0; s < WISP_COUNT; s++) {
    w.age[s] += dt / w.span[s];
    const alive = w.age[s] < 1;
    if (alive) {
      w.world[s * 3] += w.vel[s * 3] * dt;
      w.world[s * 3 + 1] += w.vel[s * 3 + 1] * dt;
      w.world[s * 3 + 2] += w.vel[s * 3 + 2] * dt;
    }
    spawnLocal.fromArray(w.world, s * 3).applyMatrix4(rootInverse);
    w.pos.setXYZ(s, spawnLocal.x, spawnLocal.y, spawnLocal.z);
    w.life.setX(s, Math.min(w.age[s], 1));
    w.life.setW(s, alive ? 1 : 0);
  }
  w.pos.needsUpdate = true;
  w.life.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Per-mount state and stepping.
// ---------------------------------------------------------------------------

interface FlameValues {
  time: number;
  seed: number;
  /** Per-region lean in the flame mesh's local frame. */
  leans: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  /** World up in the flame mesh's local frame. */
  up: THREE.Vector3;
  /** 0 standing to 1 at a full gallop, eased: how much of each flame shows. */
  stretch: number;
}

interface OssuaryFlamesState {
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  anchors: THREE.Object3D[];
  springs: SpriteFlameState[];
  values: FlameValues;
  wisps: Wisps | null;
  tail: Tail | null;
  reducedMotion: () => boolean;
  frame: number;
  at: number;
  /** The mount root's last world position on the ground plane (NaN unset). */
  lastX: number;
  lastZ: number;
  /** The body material's bone-glow uniforms, or null if the model has no glow. */
  glow: BoneGlowUniforms | null;
}

interface BoneGlowUniforms {
  uFlameGlow: { value: THREE.Color };
  uFlamePulse: { value: number };
}

/** The green the fire throws on the bones at full strength (linear). */
const BONE_GLOW = new THREE.Color(0.06, 0.55, 0.14);

/**
 * Let the fire light the bones: the body mesh carries `_flameglow` (how near
 * each vertex is to a flame root, from build_flames.mjs), and its material
 * adds that as green emissive light, pulsing with the fire. Patched once per
 * material, before its first compile (the prewarm attaches the flames first),
 * under one program cache key so every charger shares the program.
 */
function lightBones(root: THREE.Object3D): BoneGlowUniforms | null {
  const body = root.getObjectByName('ossuary_body') as THREE.Mesh | undefined;
  if (!body?.isMesh || !body.geometry.getAttribute('_flameglow')) return null;
  const material = body.material;
  if (Array.isArray(material)) return null;
  const existing = material.userData.ossuaryBoneGlow as BoneGlowUniforms | undefined;
  if (existing) return existing;
  const uniforms: BoneGlowUniforms = {
    uFlameGlow: { value: BONE_GLOW.clone() },
    uFlamePulse: { value: 1 },
  };
  material.userData.ossuaryBoneGlow = uniforms;
  // Chained after any hook the body already carries (the env sheen, the rim),
  // with a program key of its own (characters/env_sheen.ts is the pattern).
  const previousCompile = material.onBeforeCompile;
  const previousCompileSource = previousCompile.toString();
  const previousProgramKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float _flameglow;\nvarying float vFlameGlow;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vFlameGlow = _flameglow;',
    )}`;
    shader.fragmentShader = `uniform vec3 uFlameGlow;\nuniform float uFlamePulse;\nvarying float vFlameGlow;\n${shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uFlameGlow * vFlameGlow * uFlamePulse;',
    )}`;
  };
  material.customProgramCacheKey = () =>
    `ossuary-bone-glow|${previousCompileSource}|${previousProgramKey()}`;
  material.needsUpdate = true;
  return uniforms;
}

interface Tail {
  /** One core-mesh vertex per chain link, root to tip (rigidly skinned, so
   *  its skinned position is where the unbent tail is). */
  verts: Int32Array;
  chain: TailChainState;
  goals: Float32Array;
  /** Per link: the chain's offset from the rigid tail, in the mesh's frame. */
  offsets: THREE.Vector3[];
}

/** Pick the chain's sample vertices down the middle of the tail. */
function createTail(core: THREE.Mesh): Tail | null {
  const t = core.geometry.getAttribute('_flamet');
  const region = core.geometry.getAttribute('_flameregion');
  const uv = core.geometry.getAttribute('uv');
  const pos = core.geometry.getAttribute('position');
  if (!t || !region || !uv || !pos) return null;
  const verts = new Int32Array(TAIL_LINKS).fill(-1);
  const score = new Float32Array(TAIL_LINKS).fill(Infinity);
  for (let i = 0; i < t.count; i++) {
    if (region.getX(i) !== 1) continue;
    for (let k = 0; k < TAIL_LINKS; k++) {
      const s =
        Math.abs(t.getX(i) - k / (TAIL_LINKS - 1)) +
        Math.abs(uv.getX(i) - 1) +
        Math.abs(pos.getX(i));
      if (s < score[k]) {
        score[k] = s;
        verts[k] = i;
      }
    }
  }
  if (verts.includes(-1)) return null;
  return {
    verts,
    chain: createTailChain(),
    goals: new Float32Array(TAIL_LINKS * 3),
    offsets: Array.from({ length: TAIL_LINKS }, () => new THREE.Vector3()),
  };
}

const tailGoal = new THREE.Vector3();
const tailLocal = new THREE.Vector3();

function stepTail(state: OssuaryFlamesState, dt: number, still: boolean): void {
  const tail = state.tail;
  if (!tail) return;
  const core = state.meshes[0] as THREE.SkinnedMesh;
  if (!core.isSkinnedMesh) return;
  for (let k = 0; k < TAIL_LINKS; k++) {
    core.getVertexPosition(tail.verts[k], tailGoal);
    core.localToWorld(tailGoal);
    tailGoal.toArray(tail.goals, k * 3);
  }
  // Reduced motion holds the tail on its goals: no swing.
  if (still) tail.chain.primed = false;
  stepTailChain(tail.chain, tail.goals, dt);
  for (let k = 0; k < TAIL_LINKS; k++) {
    tailLocal.fromArray(tail.chain.pos, k * 3);
    tailGoal.fromArray(tail.goals, k * 3);
    core.worldToLocal(tailLocal);
    core.worldToLocal(tailGoal);
    tail.offsets[k].subVectors(tailLocal, tailGoal);
  }
}

/** A longer gap than this between draws re-primes the springs (the same rule
 *  as the buddy flames: an off-screen stretch is not one frame of motion). */
const MAX_FRAME_GAP_S = 0.25;

const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const meshQuat = new THREE.Quaternion();

function stepFlames(state: OssuaryFlamesState, frame: number, mesh: THREE.Object3D): void {
  if (state.frame === frame) return;
  state.frame = frame;
  const now = performance.now();
  let dt = (now - state.at) / 1000;
  state.at = now;
  if (!(dt > 0)) return;
  if (dt > MAX_FRAME_GAP_S) {
    state.springs = state.springs.map(() => createSpriteFlameState());
    if (state.wisps) state.wisps.age.fill(1);
    if (state.tail) state.tail.chain.primed = false;
    state.lastX = Number.NaN;
    dt = 0;
  }
  const still = state.reducedMotion();
  if (!still) state.values.time += dt;
  // The lean is a world-space tilt; the shader bends in the mesh's frame.
  mesh.matrixWorld.decompose(scratchPos, meshQuat, scratchScale);
  meshQuat.invert();
  state.values.up.set(0, 1, 0).applyQuaternion(meshQuat);
  for (let r = 0; r < state.springs.length; r++) {
    const spring = state.springs[r];
    state.anchors[r].matrixWorld.decompose(scratchPos, scratchQuat, scratchScale);
    stepSpriteFlame(spring, scratchPos.x, scratchPos.y, scratchPos.z, dt);
    state.values.leans[r].set(spring.leanX, 0, spring.leanZ).applyQuaternion(meshQuat);
  }
  stepStretch(state, dt);
  if (state.glow) {
    // The light breathes with the fire: a slow swell under a quicker flutter.
    const tm = state.values.time;
    state.glow.uFlamePulse.value =
      0.8 + 0.12 * Math.sin(tm * 2.1) + 0.08 * Math.sin(tm * 7.7 + 1.3);
  }
  stepTail(state, dt, still);
  stepWisps(state, dt, !still);
}

/** Ease the flames' length toward the mount's ground speed this frame. */
function stepStretch(state: OssuaryFlamesState, dt: number): void {
  state.root.getWorldPosition(scratchPos);
  const known = Number.isFinite(state.lastX) && dt > 0;
  const speed = known ? Math.hypot(scratchPos.x - state.lastX, scratchPos.z - state.lastZ) / dt : 0;
  state.lastX = scratchPos.x;
  state.lastZ = scratchPos.z;
  if (!known) return;
  const target = stretchForSpeed(speed);
  state.values.stretch += (target - state.values.stretch) * (1 - Math.exp(-STRETCH_RATE * dt));
}

const FLAME_RIGS = new WeakMap<THREE.Object3D, OssuaryFlamesState>();

function drawFlame(this: THREE.Mesh, renderer: THREE.WebGLRenderer): void {
  const rig = FLAME_RIGS.get(this);
  if (!rig) return;
  stepFlames(rig, renderer.info.render.frame, this);
  const u = (this.material as THREE.ShaderMaterial).uniforms;
  u.uTime.value = rig.values.time;
  u.uSeed.value = rig.values.seed;
  u.uStretch.value = rig.values.stretch;
  (u.uLean0.value as THREE.Vector3).copy(rig.values.leans[0]);
  (u.uLean1.value as THREE.Vector3).copy(rig.values.leans[1]);
  (u.uLean2.value as THREE.Vector3).copy(rig.values.leans[2]);
  const tail = u.uTail.value as THREE.Vector3[];
  for (let k = 0; k < TAIL_LINKS; k++) {
    if (rig.tail) tail[k].copy(rig.tail.offsets[k]);
    else tail[k].set(0, 0, 0);
  }
  (u.uUp.value as THREE.Vector3).copy(rig.values.up);
  (this.material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
}

function findBone(root: THREE.Object3D, names: readonly string[]): THREE.Object3D {
  for (const name of names) {
    const bone = root.getObjectByName(name);
    if (bone) return bone;
  }
  return root;
}

/** Light Wraith the Deadstrier's flames on a mount visual root. Idempotent; a
 *  no-op (false) for any model without the two flame meshes. */
export function attachOssuaryFlames(root: THREE.Object3D, reducedMotion: () => boolean): boolean {
  if (root.userData[STATE_KEY]) return true;
  const meshes: THREE.Mesh[] = [];
  for (const layer of LAYERS) {
    const mesh = root.getObjectByName(MESH_NAMES[layer]) as THREE.Mesh | undefined;
    if (!mesh?.isMesh || !mesh.geometry.getAttribute('_flamet')) return false;
    meshes.push(mesh);
  }
  const state: OssuaryFlamesState = {
    root,
    meshes,
    anchors: REGION_BONES.map((names) => findBone(root, names)),
    springs: REGION_BONES.map(() => createSpriteFlameState()),
    values: {
      time: Math.random() * 100,
      seed: Math.random(),
      leans: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()],
      up: new THREE.Vector3(0, 1, 0),
      stretch: 0,
    },
    wisps: createWisps(meshes[0]),
    tail: createTail(meshes[0]),
    reducedMotion,
    frame: -1,
    at: performance.now(),
    lastX: Number.NaN,
    lastZ: Number.NaN,
    glow: lightBones(root),
  };
  LAYERS.forEach((layer, i) => {
    const mesh = markRigFx(meshes[i]);
    // The flames are solid flat colour now, with their dark rim drawn in; the
    // soft halo shell around them would only fog that crisp edge, so it is
    // never drawn (and so never compiled).
    if (layer === 'halo') {
      mesh.visible = false;
      return;
    }
    mesh.material = flameMaterial(layer);
    mesh.onBeforeRender = drawFlame;
    // Never culled on the bind-pose bounds of flames that bend.
    mesh.frustumCulled = false;
    // Under the wisps (renderOrder 2), which blend over it.
    mesh.renderOrder = 0;
    FLAME_RIGS.set(mesh, state);
  });
  if (state.wisps) root.add(state.wisps.mesh);
  root.userData[STATE_KEY] = state;
  return true;
}
