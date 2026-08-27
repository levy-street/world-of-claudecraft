// The Ashcaller's lava VFX (Heart of the End, Ignivar's Apocalypse add): ember
// vents on the body sockets, a staff gem that drinks motes while he channels,
// and the ground nova that ends the raid. Contributor module, adapted to the
// renderer's conventions the way ignivar_model_vfx.ts was.
//
// The GLB carries five non-deforming socket bones, each placed on a glowing
// feature of the mesh and rolled so its LOCAL +Y points the way that feature
// faces. Emitters parent to the bone and inherit the skeletal animation.
//
//   vfx_core     chest hexagon core, faces forward
//   vfx_belt     molten underside of the belt, faces DOWN (the ash fall)
//   vfx_hand.r   the lava wrist of the staff hand, faces up
//   vfx_eyes     helm eye slit, faces forward
//   vfx_staff    the gem in the staff head, +Y = up the staff
//
// Everything is GPU-side: particles advect in the vertex shader off a
// per-particle seed, so update() only pushes a handful of uniforms per frame.
//
// Encounter state drives it through syncAshcallerVfx (called per frame from
// ignivar_encounter.ts): the Apocalypse channel ramps the absorb, the channel
// ending while he still lives is the wipe (nova), and death gutters the glow.

import * as THREE from 'three';
import { IGNIVAR_APOCALYPSE_CAST_ID } from '../sim/encounters/ignivar';
import { GFX, gfxTierAtLeast, sharedUniforms } from './gfx';

// three.js's GLTFLoader sanitizes node names (dots are reserved and get
// STRIPPED: 'vfx_hand.r' -> 'vfx_handr'), so every lookup matches both the raw
// glTF spelling and the sanitized one. Getting this wrong silently finds only
// some of the sockets, which reads as "the VFX half works".
export const ASHCALLER_SOCKETS = [
  'vfx_core',
  'vfx_belt',
  'vfx_hand.r',
  'vfx_eyes',
  'vfx_staff',
] as const;
const SOCKET_LOOKUP: readonly string[] = [...ASHCALLER_SOCKETS, 'vfx_handr', 'vfx_hand_r'];
/** per-socket emitter tuning: [particles, reach x, size x, spread] */
const SOCKET_TUNE: Record<string, [number, number, number, number]> = {
  vfx_core: [72, 0.78, 1.0, 1.05],
  // wide, slow, falling ash
  vfx_belt: [88, 0.62, 0.85, 1.55],
  'vfx_hand.r': [26, 0.55, 0.75, 0.7],
  vfx_handr: [26, 0.55, 0.75, 0.7],
  vfx_hand_r: [26, 0.55, 0.75, 0.7],
  vfx_eyes: [16, 0.34, 0.55, 0.45],
  vfx_staff: [56, 0.55, 0.95, 1.25],
};
/** vfx_belt points DOWN, so its embers must fall, not rise. */
const FALLING = new Set(['vfx_belt']);

const HANDLE_KEY = 'ashcallerVfx';
const STATE_KEY = 'ashcallerVfxState';

// update() runs per frame: never mint a Vector3 there.
const scaleScratch = new THREE.Vector3();

export interface AshcallerVfxOptions {
  /** global particle multiplier. 1 reads full at boss scale; 0.5 for crowds. */
  density?: number;
  /** model units an ember travels before it dies. */
  reach?: number;
  /** base emissive multiplier; the breathing pulse rides on top of this. */
  emissiveBase?: number;
  /** heat shimmer billboards, the cheapest thing to cut on low spec. */
  shimmer?: boolean;
  /** motes that spiral into the staff gem while channelling. */
  absorb?: boolean;
  /** Flickering point light on the staff gem. OFF by default: dynamic point
   *  lights ride the pad budget (point_light_budget.ts), and this module does
   *  not hold a pad lease; route it through the budget before enabling. */
  gemLight?: boolean;
}

export interface AshcallerVfxHandle {
  /** call once per frame with seconds since the last frame. */
  update(dt: number): void;
  /** Whether the emitters draw at all. The state machine and envelopes keep
   *  running either way, so a wipe that resolves off-frustum is never replayed
   *  late; only the draw waits for the body to be on screen. */
  setEmittersVisible(on: boolean): void;
  /** 0 = dormant (death), 1 = normal, >1 = enraged. Drives ember length,
   *  brightness and the emissive pulse depth together. */
  setIntensity(v: number): void;
  /** the channel: motes converge on the staff gem and it winds up white-hot. */
  setChannel(on: boolean): void;
  /** THE WIPE. Fire the frame the channel resolves: expanding ground ring +
   *  eruption pillar + a shell that washes the body. */
  nova(): void;
  /** a smaller flare, for a parried or interrupted cast. */
  pulse(): void;
  /** how far the channel has wound up, 0..1, for gating audio or a cast bar. */
  charge(): number;
  dispose(): void;
}

// ---------------------------------------------------------------- shaders

const EMBER_VERT = `
uniform float uTime;
uniform float uIntensity;
uniform float uReach;
uniform float uScale;
uniform float uSpread;
uniform float uFall;
attribute float aSeed;
attribute float aSize;
varying float vLife;
varying float vSeed;
float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }
void main() {
  vSeed = aSeed;
  float speed = 0.50 + h11(aSeed) * 0.50;
  float life  = fract(uTime * speed * 0.55 + aSeed);
  vLife = life;
  float dist = life * uReach * (0.7 + 0.6 * uIntensity) * 0.72;
  float ang    = h11(aSeed + 1.7) * 6.2831853;
  float radius = h11(aSeed + 3.1) * 0.38 * uSpread;
  float curl   = uTime * (0.7 + h11(aSeed + 5.3) * 1.5);
  float spread = 0.07 + life * 0.36;
  vec3 pos = vec3(
    cos(ang + curl) * radius * spread,
    dist,
    sin(ang + curl) * radius * spread
  );
  // per-particle turbulence: without it the plume reads as a fountain, not fire
  float turb = 0.6 + 0.8 * h11(aSeed + 7.9);
  float free = 0.25 + life;
  pos.x += sin(uTime * (6.0 + turb * 5.0) + aSeed * 61.0 + life * 9.0) * 0.05 * free * uSpread;
  pos.z += cos(uTime * (5.0 + turb * 6.0) + aSeed * 47.0 + life * 7.0) * 0.05 * free * uSpread;
  vec4 world = modelMatrix * vec4(pos, 1.0);
  // buoyancy is applied in WORLD space so embers always climb, whatever way
  // the socket bone happens to be pointing after the skeleton moves it. The
  // belt vent flips the sign (uFall) so its ash showers down instead.
  world.y += mix(1.0, -0.55, uFall) * pow(life, 1.3) * uReach * uScale * 1.15
           + sin(uTime * 7.0 + aSeed * 53.0) * 0.02 * uScale * life;
  vec4 mv = viewMatrix * world;
  float grow = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.55, 1.0, life));
  gl_PointSize = aSize * uScale * grow * (1.0 + uIntensity * 0.5) * (260.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const EMBER_FRAG = `
uniform float uIntensity;
uniform float uBurst;
varying float vLife;
varying float vSeed;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = 1.0 - smoothstep(0.0, 0.5, r);
  // real cinders run RED: a brief white flash, then a long red tail into ash
  vec3 hot  = vec3(1.00, 0.86, 0.58);
  vec3 mid  = vec3(1.00, 0.31, 0.05);
  vec3 cool = vec3(0.34, 0.04, 0.01);
  vec3 col = mix(hot, mid, smoothstep(0.0, 0.22, vLife));
  col = mix(col, cool, smoothstep(0.30, 0.82, vLife));
  float fade = 1.0 - smoothstep(0.5, 1.0, vLife);
  float alive = smoothstep(0.0, 0.3, uIntensity);
  float a = core * core * fade * (0.55 + 0.45 * uIntensity) * alive * uBurst;
  gl_FragColor = vec4(col * (1.0 + uIntensity * 0.6), a);
}
`;

// The channel absorb. Motes are born on a shell of radius uRadius and fall
// INWARD along a shortening spiral, so they streak toward the gem and wink out
// on arrival. uCharge both densifies them and tightens the shell, so the
// wind-up visibly accelerates instead of just getting brighter.
const ABSORB_VERT = `
uniform float uTime;
uniform float uCharge;
uniform float uRadius;
uniform float uScale;
attribute float aSeed;
attribute float aSize;
varying float vLife;
varying float vSeed;
float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }
void main() {
  vSeed = aSeed;
  float speed = 0.42 + h11(aSeed) * 0.40 + uCharge * 0.55;
  float life  = fract(uTime * speed + aSeed);
  vLife = life;
  float rIn  = uRadius * (0.55 + 0.45 * h11(aSeed + 2.3)) * (1.0 - 0.30 * uCharge);
  // ease-IN on the radius: slow drift far out, a hard rush at the gem
  float k = 1.0 - life;
  float rad = rIn * k * k;
  float ang  = h11(aSeed + 1.1) * 6.2831853 + life * (5.0 + 7.0 * uCharge);
  float tilt = (h11(aSeed + 4.7) - 0.5) * 3.14159;
  vec3 pos = vec3(cos(ang) * rad * cos(tilt), sin(tilt) * rad, sin(ang) * rad * cos(tilt));
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vec4 mv = viewMatrix * world;
  // motes brighten and swell as they close, then pop out in the last 8%
  float grow = smoothstep(0.0, 0.10, life) * (1.0 - smoothstep(0.92, 1.0, life));
  gl_PointSize = aSize * uScale * grow * (0.6 + 1.5 * life) * (240.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const ABSORB_FRAG = `
uniform float uCharge;
varying float vLife;
varying float vSeed;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = 1.0 - smoothstep(0.0, 0.5, r);
  vec3 far  = vec3(0.85, 0.22, 0.04);
  vec3 near = vec3(1.00, 0.78, 0.36);
  vec3 col = mix(far, near, smoothstep(0.35, 1.0, vLife));
  float a = core * core * (0.25 + 0.75 * vLife) * smoothstep(0.02, 0.35, uCharge);
  gl_FragColor = vec4(col * (1.4 + uCharge), a);
}
`;

// The nova ring: a flat disc on the GROUND (parented to the view group, not
// the skeleton, so it stays put whatever the body does) whose cracked-lava rim
// races outward. uShock 1 -> 0 drives radius, width and burn-out together.
const NOVA_VERT = `
uniform float uShock;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position * (0.10 + (1.0 - uShock) * 3.10);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const NOVA_FRAG = `
uniform float uTime;
uniform float uShock;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // vUv.x runs across the ring band, vUv.y around it
  float band = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float rim  = pow(max(band, 0.0), 1.6);
  // fractured crust: cheap value noise around the circumference
  float n = h21(floor(vec2(vUv.y * 90.0, vUv.x * 6.0)));
  float crack = smoothstep(0.35, 0.95, n * 0.6 + rim * 0.7);
  vec3 hot  = vec3(1.00, 0.88, 0.55);
  vec3 lava = vec3(1.00, 0.32, 0.04);
  vec3 char_ = vec3(0.16, 0.03, 0.01);
  vec3 col = mix(char_, lava, crack);
  col = mix(col, hot, pow(rim, 4.0));
  float a = rim * (0.35 + 0.65 * crack) * uShock;
  gl_FragColor = vec4(col * (1.0 + 2.5 * uShock), a);
}
`;

// The body shell: an expanding fresnel sphere anchored on the chest, so the
// release visibly washes past the whole silhouette rather than just glowing.
const SHELL_VERT = `
uniform float uBurst;
varying vec3 vN;
varying vec3 vV;
void main() {
  float s = 0.14 + (1.0 - uBurst) * 0.95;
  vec4 mv = modelViewMatrix * vec4(position * s, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const SHELL_FRAG = `
uniform float uBurst;
varying vec3 vN;
varying vec3 vV;
void main() {
  // max() guard: abs(dot(n1, n2)) of two normalized vectors can exceed 1.0 by
  // a rounding hair on real GPU compilers, and pow() of a negative base is
  // undefined in GLSL (NaN sparkle into the additive pass).
  float f = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 3.0);
  vec3 col = mix(vec3(1.00, 0.30, 0.04), vec3(1.00, 0.86, 0.55), f);
  float a = f * 0.55 * uBurst;
  gl_FragColor = vec4(col * (1.0 + 0.9 * uBurst), a);
}
`;

// The eruption pillar: camera-facing strips that shoot UP out of the strike
// point on the same uShock envelope, so the ring and the column read as one
// event instead of two effects that happen to overlap.
const PILLAR_VERT = `
uniform float uTime;
uniform float uShock;
uniform float uScale;
attribute float aSeed;
attribute float aT;
attribute float aSide;
varying vec2 vUv;
varying float vSeed;
float h11(float p) { return fract(sin(p * 78.233) * 43758.5453); }
void main() {
  vUv = vec2(aSide * 0.5 + 0.5, aT);
  vSeed = aSeed;
  float rise = (1.0 - uShock);
  float t = aT;
  float ang = h11(aSeed + 1.7) * 6.2831853;
  float r = (0.14 + t * 0.52) * (0.5 + h11(aSeed + 3.1));
  float wave = sin(t * 6.0 - uTime * 4.0 + aSeed * 37.0) * (0.02 + t * 0.10);
  vec3 pos = vec3(cos(ang) * r + wave, t * 1.7 * (0.35 + rise), sin(ang) * r);
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vec3 camRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  world.xyz += camRight * aSide * (0.03 + t * 0.10) * uScale;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PILLAR_FRAG = `
uniform float uTime;
uniform float uShock;
varying vec2 vUv;
varying float vSeed;
void main() {
  float edge = pow(max(1.0 - abs(vUv.x - 0.5) * 2.0, 0.0), 1.3);
  float flow = 0.55 + 0.45 * sin(vUv.y * 10.0 - uTime * 6.0 + vSeed * 41.0);
  float ends = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
  vec3 hot  = vec3(1.00, 0.90, 0.62);
  vec3 lava = vec3(1.00, 0.28, 0.04);
  vec3 col = mix(hot, lava, smoothstep(0.0, 0.5, vUv.y));
  float a = edge * ends * flow * uShock * 0.50;
  gl_FragColor = vec4(col * (1.0 + 1.1 * uShock), a);
}
`;

const SHIMMER_VERT = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vUv = uv;
  float s = 0.20 + uIntensity * 0.10;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += (position.xy) * s;
  gl_Position = projectionMatrix * mv;
}
`;

const SHIMMER_FRAG = `
uniform float uTime;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  if (r > 1.0) discard;
  float wob = sin(p.y * 24.0 + uTime * 5.0) * 0.5 + sin(p.x * 19.0 - uTime * 3.7) * 0.5;
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * 0.030 * uIntensity * (0.6 + 0.4 * wob);
  gl_FragColor = vec4(vec3(1.0, 0.62, 0.34), max(a, 0.0));
}
`;

// ---------------------------------------------------------------- attach

export function attachAshcallerVfx(
  root: THREE.Object3D,
  opts: AshcallerVfxOptions = {},
): AshcallerVfxHandle | null {
  const existing = root.userData[HANDLE_KEY] as AshcallerVfxHandle | undefined;
  if (existing) return existing;
  const sockets: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (SOCKET_LOOKUP.includes(o.name)) sockets.push(o);
  });
  // not an Ashcaller: safe to call on anything
  if (!sockets.length) return null;

  const density = opts.density ?? 1;
  const reach = opts.reach ?? 0.34;
  // matches the GLB's KHR_materials_emissive_strength
  const emissiveBase = opts.emissiveBase ?? 2.4;
  const wantShimmer = opts.shimmer ?? true;
  const wantAbsorb = opts.absorb ?? true;

  // Ancestors only: a full forced subtree walk on the attach frame is real
  // main-thread work at the mid-fight spawn, and only the root's own world
  // scale is read here.
  root.updateWorldMatrix(true, false);
  const rootScale = scaleScratch.setFromMatrixScale(root.matrixWorld).x || 1;

  const uTime = sharedUniforms.uTime;
  const uIntensity = { value: 1 };
  const uScale = { value: rootScale };
  // pulse / nova body-shell envelope
  const uBurst = { value: 0 };
  // ground ring + pillar envelope (snappier)
  const uShock = { value: 0 };
  // channel wind-up, 0..1
  const uCharge = { value: 0 };

  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const emberGeo = (count: number, sizeScale: number) => {
    const n = Math.max(4, Math.round(count * density));
    const g = track(new THREE.BufferGeometry());
    // the vertex shader places them
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i] = i / n + Math.random() * (0.5 / n);
      size[i] = (0.026 + Math.random() * 0.044) * sizeScale;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, reach * 0.5, 0), reach * 2.0);
    return g;
  };

  const emberMat = (reachX: number, spread: number, fall: boolean) =>
    track(
      new THREE.ShaderMaterial({
        uniforms: {
          uTime,
          uIntensity,
          uScale,
          uBurst: { value: 1 },
          uReach: { value: reach * reachX },
          uSpread: { value: spread },
          uFall: { value: fall ? 1 : 0 },
        },
        vertexShader: EMBER_VERT,
        fragmentShader: EMBER_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );

  const shimmerGeo = track(new THREE.PlaneGeometry(1, 1));
  const shimmerMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uTime, uIntensity },
      vertexShader: SHIMMER_VERT,
      fragmentShader: SHIMMER_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  let staffBone: THREE.Object3D | null = null;
  let chestBone: THREE.Object3D | null = null;
  const added: THREE.Object3D[] = [];
  // The always-on emitters (embers, shimmer, absorb): drawn only while the
  // body is on screen. The nova family stays envelope-driven, ANDed with the
  // same flag in update().
  const ambient: THREE.Object3D[] = [];
  let emittersOn = true;

  for (const bone of sockets) {
    const tune = SOCKET_TUNE[bone.name] ?? [48, 1, 1, 1];
    const [count, reachX, sizeX, spread] = tune;
    const fall = FALLING.has(bone.name);
    const pts = new THREE.Points(emberGeo(count, sizeX), emberMat(reachX, spread, fall));
    pts.name = `${bone.name}__ember`;
    pts.frustumCulled = false;
    pts.renderOrder = 2;
    bone.add(pts);
    added.push(pts);
    ambient.push(pts);
    if (wantShimmer && !fall) {
      const sh = new THREE.Mesh(shimmerGeo, shimmerMat);
      sh.name = `${bone.name}__shimmer`;
      sh.frustumCulled = false;
      bone.add(sh);
      added.push(sh);
      ambient.push(sh);
    }
    if (bone.name.startsWith('vfx_staff')) staffBone = bone;
    if (bone.name === 'vfx_core') chestBone = bone;
  }

  // ---- the channel absorb, on the staff gem -----------------------------
  let gemLight: THREE.PointLight | null = null;
  if (staffBone && wantAbsorb) {
    const n = Math.max(24, Math.round(220 * density));
    const g = track(new THREE.BufferGeometry());
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed[i] = i / n + Math.random() * (0.5 / n);
      size[i] = 0.03 + Math.random() * 0.052;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    // generous bound: these are born a long way out and frustumCulled is off
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3.0);
    const absorb = new THREE.Points(
      g,
      track(
        new THREE.ShaderMaterial({
          uniforms: { uTime, uCharge, uScale, uRadius: { value: 1.35 } },
          vertexShader: ABSORB_VERT,
          fragmentShader: ABSORB_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    absorb.name = 'vfx_staff__absorb';
    absorb.frustumCulled = false;
    absorb.renderOrder = 3;
    staffBone.add(absorb);
    added.push(absorb);
    ambient.push(absorb);
    if (opts.gemLight ?? false) {
      gemLight = new THREE.PointLight(0xff5a18, 0, 0, 1.7);
      gemLight.name = 'vfx_staff__light';
      staffBone.add(gemLight);
      added.push(gemLight);
    }
  }

  // ---- the nova: ring + pillar on the ROOT, shell on the chest ----------
  const ringGeo = track(new THREE.RingGeometry(0.72, 1.0, 96, 1));
  const ring = new THREE.Mesh(
    ringGeo,
    track(
      new THREE.ShaderMaterial({
        uniforms: { uTime, uShock },
        vertexShader: NOVA_VERT,
        fragmentShader: NOVA_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  ring.name = 'ashcaller__nova_ring';
  // flat on the ground
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.frustumCulled = false;
  ring.renderOrder = 2;
  ring.visible = false;
  root.add(ring);
  added.push(ring);

  // pillar strips
  const RIB = Math.max(6, Math.round(18 * density));
  const SEG = 12;
  const nv = RIB * (SEG + 1) * 2;
  const pgeo = track(new THREE.BufferGeometry());
  {
    const pos = new Float32Array(nv * 3);
    const seed = new Float32Array(nv);
    const tA = new Float32Array(nv);
    const side = new Float32Array(nv);
    const idx: number[] = [];
    let v = 0;
    for (let r = 0; r < RIB; r++) {
      const s = r / RIB + Math.random() * (0.5 / RIB);
      for (let k = 0; k <= SEG; k++) {
        const t = k / SEG;
        for (const sd of [-1, 1]) {
          seed[v] = s;
          tA[v] = t;
          side[v] = sd;
          v++;
        }
      }
      const b = r * (SEG + 1) * 2;
      for (let k = 0; k < SEG; k++) {
        const a = b + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pgeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    pgeo.setAttribute('aT', new THREE.BufferAttribute(tA, 1));
    pgeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    pgeo.setIndex(idx);
    pgeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0), 3.0);
  }
  const pillar = new THREE.Mesh(
    pgeo,
    track(
      new THREE.ShaderMaterial({
        uniforms: { uTime, uShock, uScale },
        vertexShader: PILLAR_VERT,
        fragmentShader: PILLAR_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  pillar.name = 'ashcaller__nova_pillar';
  pillar.frustumCulled = false;
  pillar.renderOrder = 3;
  pillar.visible = false;
  root.add(pillar);
  added.push(pillar);

  const shell = new THREE.Mesh(
    track(new THREE.SphereGeometry(1, 24, 16)),
    track(
      new THREE.ShaderMaterial({
        uniforms: { uBurst },
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  shell.name = 'ashcaller__shell';
  shell.frustumCulled = false;
  shell.renderOrder = 4;
  shell.visible = false;
  (chestBone ?? root).add(shell);
  added.push(shell);

  // ---- the emissive "lava breathing" pulse ------------------------------
  const pulsed: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mm of mats) {
      const s = mm as THREE.MeshStandardMaterial;
      if (s?.emissiveMap && !pulsed.includes(s)) pulsed.push(s);
    }
  });

  let t = 0;
  let target = 1;
  let chargeTarget = 0;

  const handle: AshcallerVfxHandle = {
    update(dt: number) {
      // clamp: a hitch (or a hidden tab's giant frame) must never swallow a
      // whole nova envelope in one step
      const step = Math.min(dt, 0.05);
      t += step;
      uIntensity.value += (target - uIntensity.value) * Math.min(1, step * 1.6);
      uCharge.value +=
        (chargeTarget - uCharge.value) *
        Math.min(1, step * (chargeTarget > uCharge.value ? 0.85 : 4.5));
      uBurst.value *= Math.exp(-step * 1.1);
      uShock.value *= Math.exp(-step * 1.7);
      uScale.value = scaleScratch.setFromMatrixScale(root.matrixWorld).x || rootScale;
      // two detuned sines so the glow never lands on an obvious beat
      const breathe = 0.5 + 0.28 * Math.sin(t * 1.7) + 0.22 * Math.sin(t * 2.63 + 1.1);
      const em =
        emissiveBase * (0.62 + 0.38 * breathe) * Math.max(uIntensity.value, 0.05) +
        uCharge.value * 2.4 +
        uBurst.value * 3.2;
      for (const m of pulsed) m.emissiveIntensity = em;
      if (gemLight) {
        gemLight.intensity =
          (0.25 + 2.6 * uCharge.value + 6.0 * uShock.value) * Math.max(uIntensity.value, 0.05);
        gemLight.distance = 3.0 + 5.0 * uCharge.value;
      }
      ring.visible = emittersOn && uShock.value > 0.004;
      pillar.visible = ring.visible;
      shell.visible = emittersOn && uBurst.value > 0.004;
    },
    setEmittersVisible(on: boolean) {
      if (on === emittersOn) return;
      emittersOn = on;
      for (const o of ambient) o.visible = on;
    },
    setIntensity(v: number) {
      target = Math.max(0, v);
    },
    setChannel(on: boolean) {
      chargeTarget = on ? 1 : 0;
      if (on) target = Math.max(target, 1.25);
    },
    nova() {
      uShock.value = 1;
      uBurst.value = Math.max(uBurst.value, 0.55);
      uIntensity.value = Math.max(uIntensity.value, 2.4);
      chargeTarget = 0;
      // the stored charge is SPENT, not faded
      uCharge.value = 0;
    },
    pulse() {
      uBurst.value = 1;
      uIntensity.value = Math.max(uIntensity.value, 1.8);
    },
    charge() {
      return uCharge.value;
    },
    dispose() {
      for (const o of added) o.parent?.remove(o);
      for (const d of disposables) d.dispose();
      // The pulse writes SHARED tinted-cache materials that outlive this
      // entity; leave them at the authored baseline, never a mid-gutter value
      // the next mount of the same cache entry would inherit.
      for (const m of pulsed) m.emissiveIntensity = emissiveBase;
      delete root.userData[HANDLE_KEY];
      delete root.userData[STATE_KEY];
    },
  };
  root.userData[HANDLE_KEY] = handle;
  return handle;
}

// ---------------------------------------------------------------- game glue

interface AshcallerSyncState {
  channelWas: boolean;
  deadWas: boolean;
}

export interface AshcallerVfxEntity {
  dead?: boolean;
  castingAbility?: string | null;
  channeling?: boolean;
}

/** The cosmetic lever (the weapon_vfx_shed_core shape): particle density and
 *  the shimmer follow the STATIC graphics tier, never the FPS governor. */
export function ashcallerTierOptions(): AshcallerVfxOptions {
  const high = gfxTierAtLeast(GFX.tier, 'high');
  const medium = gfxTierAtLeast(GFX.tier, 'medium');
  return {
    density: high ? 1 : medium ? 0.7 : 0.45,
    shimmer: medium && !GFX.constrainedMemory,
  };
}

/** Per-frame driver, called from ignivar_encounter.ts for the Apocalypse add's
 *  view group EVERY frame, on or off screen. Attaches lazily on the first
 *  frame the view exists (the ignivar_depths interior prewarm has already
 *  linked these programs), then follows entity state: the Apocalypse channel
 *  ramps the absorb, the channel ending while he still lives IS the wipe
 *  (nova), and death gutters the glow. `bodyOnScreen` gates only the DRAW:
 *  the state machine and envelopes always advance, so a wipe that resolves
 *  off-frustum is never replayed late when the camera swings back. */
export function syncAshcallerVfx(
  group: THREE.Object3D,
  entity: AshcallerVfxEntity,
  dt: number,
  bodyOnScreen = true,
  reducedMotion = false,
): void {
  const handle = attachAshcallerVfx(group, ashcallerTierOptions());
  if (!handle) return;
  const state = (group.userData[STATE_KEY] as AshcallerSyncState | undefined) ?? {
    channelWas: false,
    deadWas: false,
  };
  group.userData[STATE_KEY] = state;
  const channeling =
    entity.channeling === true &&
    entity.castingAbility === IGNIVAR_APOCALYPSE_CAST_ID &&
    entity.dead !== true;
  if (entity.dead === true) {
    if (!state.deadWas) handle.setIntensity(0);
    handle.setChannel(false);
  } else {
    if (state.deadWas) handle.setIntensity(1);
    handle.setChannel(channeling);
    // The channel ending while he still lives is the completed Apocalypse:
    // the sim clears the cast before dealing the wipe damage, so this edge IS
    // the staff strike. A kill ends the channel too, but arrives with dead.
    // Reduced motion trades the racing ground ring and pillar for the body
    // flash alone; the actionable warning is the sim's cast bar either way.
    if (state.channelWas && !channeling) {
      if (reducedMotion) handle.pulse();
      else handle.nova();
    }
  }
  state.channelWas = channeling;
  state.deadWas = entity.dead === true;
  handle.setEmittersVisible(bodyOnScreen);
  handle.update(dt);
}

export function disposeAshcallerVfx(group: THREE.Object3D): void {
  const handle = group.userData[HANDLE_KEY] as AshcallerVfxHandle | undefined;
  handle?.dispose();
}

/** Hidden prewarm stand-in for the ignivar_depths interior pass: a socket
 *  skeleton carrying every ShaderMaterial this module can draw, so the add's
 *  mid-fight spawn links nothing in a live frame. The returned group is kept
 *  alive (never disposed) by the pass exactly like the Varkhul prewarm
 *  visuals. */
export function buildAshcallerVfxPrewarmVisual(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ashcaller_vfx_prewarm';
  for (const name of ['vfx_core', 'vfx_belt', 'vfx_handr', 'vfx_eyes', 'vfx_staff']) {
    const bone = new THREE.Bone();
    bone.name = name;
    group.add(bone);
  }
  // Explicit full options, deliberately NOT the tier lever: the prewarm must
  // link the SUPERSET of every tier's live attach so a runtime tier change
  // never links cold.
  const handle = attachAshcallerVfx(group, { density: 1, shimmer: true });
  // Force every nova-family mesh visible so the compile pass links their
  // programs; the pass hides the whole group afterwards.
  group.traverse((o) => {
    o.visible = true;
  });
  // One settled step so the uniforms carry sane values into the link.
  handle?.update(1 / 60);
  group.traverse((o) => {
    o.visible = true;
  });
  return group;
}
