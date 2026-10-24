// The live flame over each orb of the sprite buddy (Flicker and Glimmer): a
// see-through cone round the orb and up to a point, additive like fire, clear
// in the middle so the face reads through, glowing at the rim, with noise
// scrolling up it so it flickers. Look reference and the shape's numbers:
// docs/design/sprites-buddy/flame_preview.py. The motion and colour math is
// the pure sprites_buddy_flame_core.ts.
//
// Each flame is parented to its orb's `<c>_squash` bone, so it follows the
// orb and its squash but not its spin. Once per rendered frame, at the
// flame's own draw (onBeforeRender), each orb's lean spring steps from the
// bone's world-space motion and the vertex shader bends the cone's top, so the
// flame reacts to the buddy's real movement in the world as well as to its
// clips. Stepping at the draw keeps renderer.ts (line-budgeted) down to the one
// attach call in template_model_vfx.ts.
//
// One geometry and one material per orb colour are shared by every buddy
// (marked shared, never disposed); per-instance uniform values ride
// mesh.userData and are written in onBeforeRender with uniformsNeedUpdate, so
// two buddies drawn back to back still upload their own lean and colour.
import * as THREE from 'three';
import { markRigFx } from './characters/rig_fx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import {
  createSpriteFlameState,
  goldFlameGreen,
  type SpriteFlameState,
  spriteMergeDepth,
  stepSpriteFlame,
  tealFlameFade,
} from './sprites_buddy_flame_core';

/** Sprite radius in rig units (animate_sprites.py R). */
const R = 0.5;
/** Flame radius round the orb, and how far its tip reaches above the shell top,
 *  both in sprite radii (flame_preview.py SHELL and RISE). */
const SHELL = 1.15;
const RISE = 2.1;
const FLAME_BOTTOM = -SHELL * R;
const FLAME_HEIGHT = (2 * SHELL + RISE) * R;

const FLAME_NAME = 'spritesBuddyFlame';
const STATE_KEY = 'spritesBuddyFlame';
const ORBS = ['gold', 'teal'] as const;
type Orb = (typeof ORBS)[number];

/** (core, body, tip) in sRGB, flame_preview.py PALETTE. */
const PALETTE: Record<Orb | 'green', [number, number, number][]> = {
  gold: [
    [1.0, 0.97, 0.7],
    [1.0, 0.82, 0.15],
    [1.0, 0.55, 0.05],
  ],
  teal: [
    [0.8, 1.0, 1.0],
    [0.25, 0.9, 1.0],
    [0.1, 0.5, 1.0],
  ],
  green: [
    [0.88, 1.0, 0.72],
    [0.45, 1.0, 0.3],
    [0.15, 0.8, 0.2],
  ],
};

const VERTEX = /* glsl */ `
  uniform vec3 uLean;
  uniform float uStretch;
  varying vec3 vGen;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  const float BOTTOM = ${FLAME_BOTTOM.toFixed(5)};
  const float HEIGHT = ${FLAME_HEIGHT.toFixed(5)};
  void main() {
    vec3 p = position;
    // 0..1 bottom to tip, before any bend: the noise rides the flame's shape.
    vGen = vec3(p.x / HEIGHT + 0.5, (p.y - BOTTOM) / HEIGHT, p.z / HEIGHT + 0.5);
    float up = max(p.y, 0.0);
    // Stretch the part above the orb's centre, thinning it to keep its volume,
    // then bend it: the offset grows with the square of the height, so the
    // cone curves away from the motion like a flame dragged through the air.
    float s = mix(1.0, uStretch, clamp(up / (HEIGHT * 0.5), 0.0, 1.0));
    p.xz /= sqrt(s);
    p.y = p.y < 0.0 ? p.y : up * uStretch;
    p += uLean * (p.y > 0.0 ? p.y * p.y / HEIGHT : 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uGreen;
  uniform float uFade;
  uniform vec3 uCore;
  uniform vec3 uBody;
  uniform vec3 uTip;
  uniform vec3 uGreenCore;
  uniform vec3 uGreenBody;
  uniform vec3 uGreenTip;
  varying vec3 vGen;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  vec3 ramp(vec3 core, vec3 body, vec3 tip, float h) {
    return h < 0.45 ? mix(core, body, smoothstep(0.2, 0.45, h)) : mix(body, tip, smoothstep(0.45, 0.95, h));
  }

  void main() {
    float h = clamp(vGen.y, 0.0, 1.0);
    // Noise stretched tall and scrolling up, so it reads as rising streaks.
    vec3 q = vGen * vec3(3.0, 1.0, 3.0) * 2.4;
    q.y -= uTime * 2.6;
    q.xz += uTime * 0.45 + uSeed;
    float n = 0.65 * noise(q) + 0.35 * noise(q * 2.03 + 11.0);
    n = clamp((n - 0.3) / 0.4, 0.0, 1.0);
    // One whole flame: it thins with height and the noise flickers its top.
    float tongue = smoothstep(0.0, 0.3, 1.0 - pow(max(h, 0.0), 1.2) + (n - 0.5) * 0.35);
    float facing = 1.0 - abs(dot(normalize(vNormalView), normalize(vViewDir)));
    // Round the orb only a flickering rim glows, fading out toward the bottom,
    // so the orb shows through clearly; above it the flame fills in, its own
    // outline softened so only the flicker draws the edge.
    float rim = facing * facing * (0.35 + 0.6 * n) * smoothstep(0.05, 0.45, h);
    float soft = (1.0 - 0.8 * facing * facing * facing) * (0.22 + 0.5 * n);
    float alpha = tongue * mix(rim, soft, smoothstep(0.4, 0.62, h)) * uFade;
    vec3 colour = mix(ramp(uCore, uBody, uTip, h), ramp(uGreenCore, uGreenBody, uGreenTip, h), uGreen);
    gl_FragColor = vec4(colour * alpha, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function linear(rgb: [number, number, number]): THREE.Vector3 {
  const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return new THREE.Vector3(c.r, c.g, c.b);
}

let sharedGeometry: THREE.BufferGeometry | null = null;

/** The flame shell in bone space (orb centre at the origin, +Y up): a round
 *  bottom hugging the orb, then a cone that leaves the equator upright and
 *  tapers nearly straight to a point (flame_preview.py flame_mesh). */
function flameGeometry(): THREE.BufferGeometry {
  if (sharedGeometry) return sharedGeometry;
  const rings = 24;
  const segs = 32;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const lat = (Math.PI * i) / rings - Math.PI / 2;
    for (let j = 0; j <= segs; j++) {
      const lon = (2 * Math.PI * j) / segs;
      let r: number;
      let y: number;
      if (lat <= 0) {
        r = Math.cos(lat) * SHELL * R;
        y = Math.sin(lat) * SHELL * R;
      } else {
        const t = lat / (Math.PI / 2);
        r = SHELL * R * (1 - t ** 1.3) ** 1.1;
        y = t * (SHELL + RISE) * R;
      }
      // +sin on Z winds every quad outward (a, b above a, a + 1 round from a).
      positions.push(Math.cos(lon) * r, y, Math.sin(lon) * r);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  sharedGeometry = markSharedGeometry(geometry);
  return sharedGeometry;
}

const sharedMaterials = new Map<Orb, THREE.ShaderMaterial>();

function flameMaterial(orb: Orb): THREE.ShaderMaterial {
  const cached = sharedMaterials.get(orb);
  if (cached) return cached;
  const [core, body, tip] = PALETTE[orb].map(linear);
  const [greenCore, greenBody, greenTip] = PALETTE.green.map(linear);
  const material = new THREE.ShaderMaterial({
    name: `sprites_buddy_flame_${orb}`,
    uniforms: {
      uTime: { value: 0 },
      uSeed: { value: orb === 'teal' ? 7 : 0 },
      uLean: { value: new THREE.Vector3() },
      uStretch: { value: 1 },
      uGreen: { value: 0 },
      uFade: { value: 1 },
      uCore: { value: core },
      uBody: { value: body },
      uTip: { value: tip },
      uGreenCore: { value: greenCore },
      uGreenBody: { value: greenBody },
      uGreenTip: { value: greenTip },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    fog: false,
  });
  sharedMaterials.set(orb, markSharedMaterial(material));
  return material;
}

/** One flame's per-instance uniform values (copied into the shared material
 *  right before its draw). */
interface FlameUniformValues {
  time: number;
  lean: THREE.Vector3;
  stretch: number;
  green: number;
  fade: number;
}

interface OrbFlame {
  orb: Orb;
  bone: THREE.Object3D;
  mesh: THREE.Mesh;
  values: FlameUniformValues;
  motion: SpriteFlameState;
}

interface SpritesBuddyFlameState {
  flames: OrbFlame[];
  /** The gold shell ring a quarter turn from the seam (goldFlameGreen). */
  greenRing: THREE.Object3D | null;
  reducedMotion: () => boolean;
  time: number;
  /** The renderer frame last stepped, and when (performance.now ms). */
  frame: number;
  at: number;
}

/** A longer gap than this between draws (the buddy was out of the scene, or
 *  the tab was hidden) re-primes the springs instead of reading the whole
 *  gap's travel as one frame of motion. */
const MAX_FRAME_GAP_S = 0.25;

const scratchPos = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const centres = { gold: new THREE.Vector3(), teal: new THREE.Vector3() };
const radii = { gold: 0, teal: 0 };

/** Step a rig's flames once per rendered frame, at its first flame's draw:
 *  the bones' world matrices are this frame's by then. */
function stepFlames(state: SpritesBuddyFlameState, frame: number): void {
  if (state.frame === frame) return;
  state.frame = frame;
  const now = performance.now();
  let dt = (now - state.at) / 1000;
  state.at = now;
  // A second render in the same tick under a coarse clock is not a step: skip
  // it rather than re-priming, or a flame drawn twice a frame never leans.
  if (!(dt > 0)) return;
  if (dt > MAX_FRAME_GAP_S) {
    // Back from out of the scene (or a hidden tab): start upright again rather
    // than springing back from wherever it was leaning when it left.
    for (const flame of state.flames) flame.motion = createSpriteFlameState();
    dt = 0;
  }
  if (!state.reducedMotion()) state.time += dt;
  for (const flame of state.flames) {
    flame.bone.matrixWorld.decompose(scratchPos, scratchQuat, scratchScale);
    centres[flame.orb].copy(scratchPos);
    radii[flame.orb] = (R * (scratchScale.x + scratchScale.y + scratchScale.z)) / 3;
    stepSpriteFlame(flame.motion, scratchPos.x, scratchPos.y, scratchPos.z, dt);
    // The lean is a world-space tilt; the shader bends in bone space.
    const v = flame.values;
    v.lean.set(flame.motion.leanX, 0, flame.motion.leanZ).applyQuaternion(scratchQuat.invert());
    v.stretch = flame.motion.stretch;
    v.time = state.time;
  }
  const depth = spriteMergeDepth(
    centres.gold.x,
    centres.gold.y,
    centres.gold.z,
    radii.gold,
    centres.teal.x,
    centres.teal.y,
    centres.teal.z,
    radii.teal,
  );
  const green = state.greenRing ? goldFlameGreen(state.greenRing.scale.x) : 0;
  for (const flame of state.flames) {
    flame.values.green = flame.orb === 'gold' ? green : 0;
    flame.values.fade = flame.orb === 'teal' ? tealFlameFade(depth) : 1;
    // Gold's flame never hides, so its draw keeps stepping teal's.
    flame.mesh.visible = flame.values.fade > 0.001;
  }
}

/** Each flame mesh's rig state, kept off userData (a cycle there would break
 *  any clone or toJSON of a live buddy root). */
const FLAME_RIGS = new WeakMap<THREE.Object3D, SpritesBuddyFlameState>();

function drawFlame(this: THREE.Mesh, renderer: THREE.WebGLRenderer): void {
  const rig = FLAME_RIGS.get(this);
  if (rig) stepFlames(rig, renderer.info.render.frame);
  const values = this.userData.flameUniforms as FlameUniformValues;
  const material = this.material as THREE.ShaderMaterial;
  const u = material.uniforms;
  u.uTime.value = values.time;
  (u.uLean.value as THREE.Vector3).copy(values.lean);
  u.uStretch.value = values.stretch;
  u.uGreen.value = values.green;
  u.uFade.value = values.fade;
  material.uniformsNeedUpdate = true;
}

/** Attach a flame to each orb of a sprite buddy rig. Idempotent: a pooled
 *  visual coming back keeps the flames it already has. Returns false when the
 *  rig has no sprite orb bones. The flames step themselves as they draw (no
 *  per-frame call), so a buddy out of the scene costs nothing. */
export function attachSpritesBuddyFlame(
  root: THREE.Object3D,
  reducedMotion: () => boolean,
): boolean {
  if (root.userData[STATE_KEY]) return true;
  const state: SpritesBuddyFlameState = {
    flames: [],
    greenRing: root.getObjectByName('gold_merged_12') ?? null,
    reducedMotion,
    time: Math.random() * 100,
    frame: -1,
    at: performance.now(),
  };
  for (const orb of ORBS) {
    const bone = root.getObjectByName(`${orb}_squash`);
    if (!bone) return false;
    const values: FlameUniformValues = {
      time: 0,
      lean: new THREE.Vector3(),
      stretch: 1,
      green: 0,
      fade: 1,
    };
    const mesh = markRigFx(new THREE.Mesh(flameGeometry(), flameMaterial(orb)));
    mesh.name = `${FLAME_NAME}_${orb}`;
    mesh.userData.flameUniforms = values;
    FLAME_RIGS.set(mesh, state);
    mesh.onBeforeRender = drawFlame;
    // Never culled on the bind-pose bounds of a mesh whose top bends.
    mesh.frustumCulled = false;
    state.flames.push({ orb, bone, mesh, values, motion: createSpriteFlameState() });
  }
  for (const flame of state.flames) flame.bone.add(flame.mesh);
  root.userData[STATE_KEY] = state;
  return true;
}
