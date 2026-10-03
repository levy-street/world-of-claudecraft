// The Calving Face, the Sanctum's showpiece (design section 3): the front
// wall of the Quench past the lake's north shore, a hundred yards of glacier
// ice, and inside it, behind a clear shell, Korzul coiled in the hollow with
// the shard beating slow and warm in his chest and feeding the aurora. It
// cracks as the run advances: five render stages read ONLY from the run's
// story markers (sanctum_story_core.ts, sanctumFaceStage), each a staged
// swap of the kit's pieces plus a short one-shot when the stage rises (a
// plate shearing off into the lake with a ripple over the ice, a crack racing
// from each chain's entry, the great split, the face calving off his head and
// one eye opening, the collapse). Never simulated; full detail on every
// preset (story, not a telegraph); it stands beyond the lake's shelf, so
// nothing here ever covers an arena.
//
// Geometry: the kit's face frame pieces (Kit_CalvingFace, Kit_FaceCalved,
// Kit_FaceCrack_*, Kit_FacePlateFallen, Kit_FaceChunk*), placed with ONE
// transform (FACE_ORIGIN, a half turn); a procedural stand-in face from the
// same shape functions if the kit is missing. The wyrm is the frozen Korzul
// (FROZEN_WYRM_URL, the swap seam), else the kit's Kit_WyrmSilhouette. Every
// material is built here with the interior (linked by its compile gate) and
// stays in use from the first frame, so no stage swap links a program.

import * as THREE from 'three';
import { loadGltf, releaseGltf } from '../assets/loader';
import { sharedUniforms } from '../gfx';
import { markSharedGeometry, markSharedTexture } from '../shared_resource';
import { radialGlowTexture } from '../textures';
import { CHAIN_FALL_ORDER, planChainRuns } from './sanctum_chains_core';
import {
  auroraLevel,
  CALVED_C,
  calvedR,
  calveProgress,
  chainSpray,
  chunkFlight,
  collapsePose,
  crackReveal,
  eyeOpen,
  FACE_BURST_AT,
  FACE_CHAIN_ENTRIES,
  FACE_EVENT_SECONDS,
  FACE_FRONT_Z,
  FACE_HALF,
  FACE_ORIGIN,
  FROZEN_WYRM,
  FROZEN_WYRM_URL,
  faceBaseY,
  faceChainEntries,
  faceTop,
  faceY,
  frozenWyrmShown,
  heartGlow,
  plateFallPose,
  SCAR,
  WYRM_EYE,
  WYRM_HEAD,
  WYRM_HEART,
  windowR,
} from './sanctum_face_core';
import { SANCTUM_SLOTS, sanctumKitPiece, sanctumSlotMaterial } from './sanctum_kit';
import { triggerSanctumLakeRipple } from './sanctum_lake';
import { SANCTUM_PALETTE, sanctumLinear } from './sanctum_plan_core';
import { newSanctumStoryView, sanctumSlotKey, sanctumStoryView } from './sanctum_story_core';

/** The shard's light as the whole cirque sees it: the aurora's level and the
 *  heartbeat, written by the face's frame driver, read by the sky dome. */
export const SANCTUM_SHARD_UNIFORMS = {
  uAurora: { value: 0.62 },
  uBeat: { value: 0 },
};

// ---- the frozen Korzul (the swap seam) ----------------------------------------------

interface FrozenParts {
  geometries: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[];
  source: THREE.MeshStandardMaterial | null;
}

let frozen: FrozenParts | null = null;
let frozenLoading: Promise<void> | null = null;
const FROZEN_WAIT_MS = 9000;

/** Fetch the frozen Korzul once (awaited by the interior, capped). Never
 *  rejects: a failed load keeps the kit's silhouette. */
export function ensureFrozenWyrm(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  frozenLoading ??= loadGltf(FROZEN_WYRM_URL)
    .then((gltf) => {
      gltf.scene.updateWorldMatrix(true, true);
      const parts: FrozenParts = { geometries: [], source: null };
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        parts.geometries.push({
          geometry: markSharedGeometry(mesh.geometry),
          matrix: mesh.matrixWorld.clone(),
        });
        const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!parts.source && m instanceof THREE.MeshStandardMaterial) parts.source = m;
      });
      for (const t of [
        parts.source?.map,
        parts.source?.normalMap,
        parts.source?.roughnessMap,
        parts.source?.emissiveMap,
      ]) {
        if (t) markSharedTexture(t);
      }
      frozen = parts.geometries.length > 0 ? parts : null;
      releaseGltf(FROZEN_WYRM_URL);
    })
    .catch(() => undefined);
  return Promise.race([
    frozenLoading,
    new Promise<void>((resolve) => setTimeout(resolve, FROZEN_WAIT_MS)),
  ]);
}

/** Has the frozen Korzul landed? */
export function frozenWyrmLoaded(): boolean {
  return frozen !== null;
}

// ---- shaders ------------------------------------------------------------------------

const ICE_LIN = sanctumLinear(SANCTUM_PALETTE.deepIce);
const _GLACIER_LIN = sanctumLinear(SANCTUM_PALETTE.glacier);
const SHARD_LIN = sanctumLinear(SANCTUM_PALETTE.shard);
const TEAL_LIN = sanctumLinear(SANCTUM_PALETTE.teal);

interface FaceUniforms {
  uHeartPos: { value: THREE.Vector3 };
  uHeart: { value: number };
}

/** The ice of the face: the kit's vertex paint lit like ice, plus the light
 *  the shard throws through it (a warm bloom round the heart, a cool blue
 *  scattering wider) so the whole wall glows faintly from within. */
function faceMaterial(u: FaceUniforms, name: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.0,
    name,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHeartPos = u.uHeartPos;
    shader.uniforms.uHeart = u.uHeart;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSWorld;\nuniform vec3 uHeartPos;\nuniform float uHeart;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 dH = vSWorld - uHeartPos;
          float d2 = dot(dH, dH);
          float warm = exp(-d2 / 900.0);
          float cool = exp(-d2 / 6400.0);
          totalEmissiveRadiance += vec3(${SHARD_LIN.map((v) => v.toFixed(3)).join(', ')}) * warm * uHeart * 0.3;
          totalEmissiveRadiance += vec3(${TEAL_LIN.map((v) => (v * 0.6).toFixed(3)).join(', ')}) * cool * uHeart * 0.12 * (0.4 + diffuseColor.b);
          // The face's own grain, in the world (the kit is vertex paint
          // only): wandering annual bands, old blue fracture planes, snow on
          // every ledge that faces the sky.
          {
            float band = sin(vSWorld.y * 0.55 + sin(vSWorld.x * 0.05) * 2.5 + sin(vSWorld.x * 0.013) * 6.0);
            float bands = smoothstep(0.7, 1.0, band) * 0.18;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.12, 1.05), bands);
          }
          // The ice is lit a little from within everywhere (deep transmission).
          totalEmissiveRadiance += diffuseColor.rgb * vec3(0.02, 0.04, 0.07);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'gravewyrmSanctumFaceIce';
  return m;
}

const SHELL_VERT = /* glsl */ `
attribute vec3 color;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vCol;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vCol = color;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uHeartPos;
uniform float uHeart;
uniform vec3 uKeyDir;
uniform float uOpacity;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vCol;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  float ndv = abs(dot(N, V));
  float fres = pow(max(1.0 - ndv, 0.0), 3.0);
  // Layers inside the ice, seen at depth along the view: frozen bubble
  // streams and old fracture planes, faint (the wyrm must read through it).
  float inner = 0.0;
  for (int i = 0; i < 3; i++) {
    float d = 3.0 + float(i) * 7.0;
    vec3 q = vWorld - V * d;
    float plane = smoothstep(0.9, 0.99, noise(q.xz * 0.05 + q.y * 0.03 + float(i) * 7.0));
    float bubbles = step(0.992, hash(floor(q.xy * 2.2) + float(i))) * step(0.6, noise(q.xy * 0.08));
    inner += (plane * 0.6 + bubbles * 0.8) / (1.0 + float(i));
  }
  vec3 deep = vec3(${ICE_LIN.map((v) => v.toFixed(3)).join(', ')});
  vec3 col = mix(deep * 0.22, vCol * 0.42, 0.25 + 0.5 * fres);
  // The cold sky on its surface.
  float lit = max(0.0, dot(N, normalize(uKeyDir)));
  col += vec3(0.25, 0.32, 0.45) * lit * 0.16;
  col += vec3(0.55, 0.72, 0.85) * inner * 0.18;
  // The shard's light, scattered forward through the shell.
  vec3 dH = vWorld - uHeartPos;
  float warm = exp(-dot(dH, dH) / 500.0);
  float halo = exp(-dot(dH, dH) / 2600.0);
  col += vec3(${SHARD_LIN.map((v) => v.toFixed(3)).join(', ')}) * warm * uHeart * 0.55;
  col += vec3(${TEAL_LIN.map((v) => v.toFixed(3)).join(', ')}) * halo * uHeart * 0.08;
  // The shell's own skin: soft drifts of hoarfrost over the clear ice, the
  // cold sky's sharp glint on its wet face.
  float fr = noise(vWorld.xy * 0.035 + vec2(vWorld.z * 0.02)) * 0.6 + noise(vWorld.xy * 0.09) * 0.4;
  float frost = smoothstep(0.5, 0.85, fr);
  vec3 H = normalize(normalize(uKeyDir) + V);
  float spec = pow(max(0.0, dot(N, H)), 90.0);
  col = mix(col, vec3(0.5, 0.62, 0.76), frost * 0.25);
  col += vec3(0.8, 0.88, 1.0) * (spec * 0.9 + fres * 0.14);
  float a = clamp(uOpacity + fres * 0.42 + frost * 0.2 + spec * 0.4 + inner * 0.05, 0.0, 0.88);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function shellMaterial(_u: FaceUniforms, keyDir: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'gravewyrmSanctumShell',
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uKeyDir: { value: keyDir }, uOpacity: { value: 0.36 } },
    ]) as Record<string, THREE.IUniform>,
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Korzul in the ice: his own baked paint, absorbed into blue the deeper he
 *  lies behind the front (so the shell has thickness), rimed, his shard and
 *  eyes beating through it (emissive, driven per frame). Once the face has
 *  calved, his head and neck stand bare (no absorption round the head). */
function wyrmMaterial(
  src: THREE.MeshStandardMaterial | null,
  u: { uFrontZ: { value: number }; uHeadPos: { value: THREE.Vector3 }; uCalved: { value: number } },
): THREE.MeshStandardMaterial {
  const m = src
    ? new THREE.MeshStandardMaterial({
        map: src.map,
        normalMap: src.normalMap,
        roughnessMap: src.roughnessMap,
        metalnessMap: src.metalnessMap,
        emissiveMap: src.emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 1,
        roughness: 1,
        metalness: 1,
        side: THREE.DoubleSide,
        name: 'gravewyrmSanctumFrozenWyrm',
      })
    : new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        metalness: 0,
        name: 'gravewyrmSanctumWyrmSilhouette',
      });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFrontZ = u.uFrontZ;
    shader.uniforms.uHeadPos = u.uHeadPos;
    shader.uniforms.uCalved = u.uCalved;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSWorld;\nuniform float uFrontZ;\nuniform vec3 uHeadPos;\nuniform float uCalved;',
      )
      // Right after the stock final write (and its NaN guard), before tone
      // mapping: gl_FragColor.rgb is outgoingLight there, so the grade reads
      // the same lit colour without replacing the guarded write.
      .replace(
        '#include <tonemapping_fragment>',
        `{
          float depthIce = max(0.0, vSWorld.z - uFrontZ);
          float bare = (1.0 - smoothstep(9.0, 16.0, length(vSWorld - uHeadPos))) * uCalved;
          float absorb = (1.0 - exp(-depthIce / 11.0)) * (1.0 - bare);
          vec3 ice = vec3(${ICE_LIN.map((v) => (v * 1.4).toFixed(3)).join(', ')});
          vec3 lit = gl_FragColor.rgb - totalEmissiveRadiance;
          // Rime on every surface that faces the sky.
          lit = mix(lit, lit + ice * 0.12, 0.5);
          lit = mix(lit, ice * (0.18 + 0.3 * exp(-depthIce / 30.0)), absorb * 0.84);
          gl_FragColor.rgb = lit + totalEmissiveRadiance * mix(1.0, 0.6, absorb);
        }
        #include <tonemapping_fragment>`,
      );
  };
  m.customProgramCacheKey = () => (src ? 'gravewyrmSanctumWyrm' : 'gravewyrmSanctumWyrmFallback');
  return m;
}

/** The light in a crack: the kit's glow strips, revealed racing out from the
 *  crack's start (`uOrigin`) as `uReach` grows, their colour scaled by the
 *  shard's beat. One material per crack (same program). */
function crackMaterial(origin: THREE.Vector3, tint: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    name: 'gravewyrmSanctumCrackLight',
  });
  m.color.setScalar(tint);
  const reach = { value: 0 };
  m.userData.reach = reach;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOrigin = { value: origin };
    shader.uniforms.uReach = reach;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSLocal;\nuniform vec3 uOrigin;\nuniform float uReach;',
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float dc = length(vSLocal - uOrigin);
        if (dc > uReach) discard;
        // The racing tip burns white-hot for a moment.
        float tip = smoothstep(uReach - 6.0, uReach, dc) * step(uReach, 140.0);
        gl_FragColor.rgb += vec3(0.9, 0.95, 1.0) * tip * 1.4;`,
      );
  };
  m.customProgramCacheKey = () => 'gravewyrmSanctumCrack';
  return m;
}

/** A burst of snow and ice powder: billowing cards round a point, expanding
 *  and rising, fading out (one instanced draw per burst; `uT` < 0 hides it). */
const BURST_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uT;
uniform float uDur;
uniform float uScale;
uniform vec3 uOrigin;
uniform vec3 uDir;
varying float vA;
varying vec2 vUv;
void main() {
  float k = clamp(uT / uDur, 0.0, 1.0);
  float live = step(0.0, uT) * step(uT, uDur);
  vec3 dir = normalize(vec3(aSeed.x - 0.5, aSeed.y * 0.8, aSeed.z - 0.5) + uDir * 0.9);
  float reach = (1.0 - (1.0 - k) * (1.0 - k)) * uScale * (0.4 + aSeed.w);
  vec3 c = uOrigin + dir * reach + vec3(0.0, k * uScale * 0.35 * aSeed.y - k * k * uScale * 0.25 * (1.0 - aSeed.y), 0.0);
  vec4 wp = modelMatrix * vec4(c, 1.0);
  float size = uScale * (0.18 + 0.45 * k) * (0.5 + aSeed.w);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  wp.xyz += (right * position.x + up * position.y) * size * live;
  vA = (1.0 - k) * smoothstep(0.0, 0.08, k) * live;
  vUv = position.xy + 0.5;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BURST_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, r) * vA * 0.55;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

let burstGeometry: THREE.InstancedBufferGeometry | null = null;

function burstGeo(): THREE.InstancedBufferGeometry {
  if (burstGeometry) return burstGeometry;
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index;
  g.setAttribute('position', quad.getAttribute('position'));
  const n = 48;
  const seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const h = (k: number) => {
      const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    seed.set([h(1), h(2), h(3), h(4)], i * 4);
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = n;
  quad.dispose();
  burstGeometry = markSharedGeometry(g);
  return g;
}

interface Burst {
  mesh: THREE.Mesh;
  u: { uT: { value: number }; uOrigin: { value: THREE.Vector3 } };
}

function burst(origin: THREE.Vector3, scale: number, dur: number, dir: THREE.Vector3): Burst {
  const u = {
    uT: { value: -1 },
    uDur: { value: dur },
    uScale: { value: scale },
    uOrigin: { value: origin },
    uDir: { value: dir },
    uColor: { value: new THREE.Color(0.86, 0.93, 1.0) },
  };
  const mesh = new THREE.Mesh(
    burstGeo(),
    new THREE.ShaderMaterial({
      name: 'gravewyrmSanctumIceBurst',
      uniforms: u,
      vertexShader: BURST_VERT,
      fragmentShader: BURST_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'gravewyrmSanctumIceBurst';
  return { mesh, u };
}

// ---- the procedural stand-in face ----------------------------------------------------

function standInFace(): { stone: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const cell = 2.4;
  const nx = Math.round((FACE_HALF * 2) / cell);
  const nz = 44;
  const stone: number[] = [];
  const stoneCol: number[] = [];
  const glass: number[] = [];
  const glassCol: number[] = [];
  // Kit frame after the glTF export: x, height up (y), the lake toward +z.
  const at = (i: number, j: number): [number, number, number] => {
    const x = -FACE_HALF + i * cell;
    const z = faceTop(x) * (j / nz);
    return [x, z, -faceY(x, z)];
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const cx = (a[0] + c[0]) / 2;
      const cz = (a[1] + c[1]) / 2;
      const inWindow = windowR(cx, cz) < 1;
      const pos = inWindow ? glass : stone;
      const col = inWindow ? glassCol : stoneCol;
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      const top = cz / Math.max(1, faceTop(cx));
      const shade = 0.82 + 0.18 * Math.sin(cx * 0.42) ** 8;
      const base = inWindow
        ? [0.12, 0.3, 0.46]
        : [0.18 + top * 0.45, 0.42 + top * 0.38, 0.62 + top * 0.26].map((v) => v * shade);
      for (let k = 0; k < 6; k++) col.push(base[0], base[1], base[2]);
    }
  }
  const make = (p: number[], c: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  };
  return { stone: make(stone, stoneCol), glass: make(glass, glassCol) };
}

// ---- the split's light ---------------------------------------------------------------

const SPLIT_VERT = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = aUv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SPLIT_FRAG = /* glsl */ `
uniform float uReveal;
uniform float uGlow;
uniform float uTime;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  // u across the split (0 at its line), v from the crest (0) to the foot (1).
  if (vUv.y > uReveal) discard;
  float core = exp(-vUv.x * vUv.x * 14.0);
  float flick = 0.85 + 0.15 * sin(uTime * 2.1 + vUv.y * 9.0);
  vec3 col = mix(vec3(0.9, 0.42, 0.16), vec3(1.0, 0.78, 0.52), core * core);
  gl_FragColor = vec4(col * core * uGlow * flick, 1.0);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function splitGlow(): {
  mesh: THREE.Mesh;
  u: { uReveal: { value: number }; uGlow: { value: number } };
} {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = 40;
  const x0 = 10;
  const z0 = faceTop(10) - 1;
  for (let i = 0; i <= n; i++) {
    const v = i / n;
    const x = x0 + (-4 - x0) * v + Math.sin(v * 17.0) * 1.6 + Math.sin(v * 41.0) * 0.6;
    const z = z0 + (0.5 - z0) * v;
    const w = 5 + 3 * Math.sin(v * Math.PI);
    for (const side of [-1, 1]) {
      const px = x + side * w;
      // Kit frame after the export: x, height, toward the lake (+z).
      pos.push(px, z, -faceY(px, z) + 0.9);
      uv.push(side, v);
    }
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const u = { uReveal: { value: 0 }, uGlow: { value: 0.6 }, uTime: sharedUniforms.uTime };
  const mesh = new THREE.Mesh(
    g,
    new THREE.ShaderMaterial({
      name: 'gravewyrmSanctumSplitGlow',
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]) as Record<
        string,
        THREE.IUniform
      >,
      vertexShader: SPLIT_VERT,
      fragmentShader: SPLIT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  const mat = mesh.material as THREE.ShaderMaterial;
  mat.uniforms.uReveal = u.uReveal;
  mat.uniforms.uGlow = u.uGlow;
  mat.uniforms.uTime = u.uTime;
  mesh.name = 'gravewyrmSanctumSplitGlow';
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  return { mesh, u };
}

// ---- the painter ----------------------------------------------------------------------

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  glowTex ??= markSharedTexture(radialGlowTexture());
  return glowTex;
}

interface PieceMeshes {
  group: THREE.Group;
  stone: THREE.Mesh | null;
  glass: THREE.Mesh | null;
  glow: THREE.Mesh | null;
}

const CRACKS = [
  'Kit_FaceCrack_0',
  'Kit_FaceCrack_1',
  'Kit_FaceCrack_2a',
  'Kit_FaceCrack_2b',
  'Kit_FaceCrack_2c',
  'Kit_FaceCrack_2d',
  'Kit_FaceCrack_3',
];

/** Where each crack races from, in the kit frame after the glTF export (x,
 *  height, toward the lake). */
function crackOrigin(name: string): THREE.Vector3 {
  const kitPoint = (x: number, z: number) => new THREE.Vector3(x, z, -faceY(x, z));
  if (name === 'Kit_FaceCrack_0') return kitPoint(-8, 60);
  if (name === 'Kit_FaceCrack_1') return kitPoint(SCAR[0], SCAR[1]);
  if (name === 'Kit_FaceCrack_3') return kitPoint(10, faceTop(10) - 1);
  const i = 'abcd'.indexOf(name.slice(-1));
  const [x, z] = FACE_CHAIN_ENTRIES[Math.max(0, i)];
  return kitPoint(x, z);
}

/**
 * Build the Calving Face for the slot anchored at (ox, oz), instance-local.
 * Returns the group and its per-frame driver (the sky dome calls it every
 * frame, so the face's story runs even while the face is off screen).
 */
export function buildSanctumFace(
  ox: number,
  oz: number,
  keyDir: THREE.Vector3,
): { group: THREE.Group; update: () => void } {
  const key = sanctumSlotKey(ox, oz);
  const root = new THREE.Group();
  root.name = 'gravewyrmSanctumCalvingFace';
  const heartWorld = new THREE.Vector3(ox + WYRM_HEART[0], WYRM_HEART[1], oz + WYRM_HEART[2]);
  const faceU: FaceUniforms = { uHeartPos: { value: heartWorld }, uHeart: { value: 0.6 } };
  const iceMat = faceMaterial(faceU, 'gravewyrmSanctumFaceIce');
  const shellMat = shellMaterial(faceU, keyDir);
  shellMat.uniforms.uHeartPos = faceU.uHeartPos;
  shellMat.uniforms.uHeart = faceU.uHeart;
  shellMat.uniforms.uTime = sharedUniforms.uTime;

  // The face frame: the kit's pieces in their glTF frame, turned to face south.
  const frame = new THREE.Group();
  frame.name = 'faceFrame';
  frame.position.set(FACE_ORIGIN.x, FACE_ORIGIN.y, FACE_ORIGIN.z);
  frame.rotation.y = Math.PI;
  root.add(frame);

  const piece = (name: string, glowMat?: THREE.Material): PieceMeshes | null => {
    const geo = sanctumKitPiece(name);
    if (!geo) return null;
    const group = new THREE.Group();
    group.name = name;
    const out: PieceMeshes = { group, stone: null, glass: null, glow: null };
    for (const slot of SANCTUM_SLOTS) {
      const g = geo[slot];
      if (!g) continue;
      const mat =
        slot === 'stone'
          ? iceMat
          : slot === 'glass'
            ? shellMat
            : (glowMat ?? sanctumSlotMaterial('glow'));
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `${name}:${slot}`;
      mesh.renderOrder = slot === 'glass' ? 3 : 0;
      out[slot] = mesh;
      group.add(mesh);
    }
    frame.add(group);
    return out;
  };

  // The face (stages 0 to 3) and its calved form (stage 4).
  let face = piece('Kit_CalvingFace');
  if (!face) {
    const s = standInFace();
    const group = new THREE.Group();
    group.name = 'standInFace';
    const stone = new THREE.Mesh(markSharedGeometry(s.stone), iceMat);
    const glass = new THREE.Mesh(markSharedGeometry(s.glass), shellMat);
    glass.renderOrder = 3;
    group.add(stone, glass);
    frame.add(group);
    face = { group, stone, glass, glow: null };
  }
  const calved = piece('Kit_FaceCalved');

  // The cracks: the kit's overlays, each racing from its start.
  const cracks = new Map<string, { p: PieceMeshes; mat: THREE.MeshBasicMaterial }>();
  for (const name of CRACKS) {
    const tint = name === 'Kit_FaceCrack_3' ? 0.62 : 1;
    const mat = crackMaterial(crackOrigin(name), tint);
    const p = piece(name, mat);
    if (p) cracks.set(name, { p, mat });
  }

  // The stage-1 plate, lying in the lake at rest; it falls into that rest pose.
  const plate = piece('Kit_FacePlateFallen');
  const plateRest = new THREE.Vector3();
  if (plate) {
    // Pivot it round the scar's foot so the fall can pitch it out of the face.
    const pivot = new THREE.Vector3(SCAR[0], 0, -faceBaseY(SCAR[0]) + 6);
    plate.group.position.copy(pivot);
    for (const m of [plate.stone, plate.glass, plate.glow]) m?.position.sub(pivot);
    plateRest.copy(pivot);
  }

  // The collapse's debris: chunks thrown from the face into the lake.
  const chunks: { mesh: THREE.Group; from: THREE.Vector3 }[] = [];
  const chunkNames = ['Kit_FaceChunkA', 'Kit_FaceChunkB', 'Kit_FaceChunkC'];
  for (let i = 0; i < 12; i++) {
    const name = chunkNames[i % 3];
    const p = piece(name);
    if (!p) break;
    const x = -60 + ((i * 41) % 120);
    const z = 18 + ((i * 29) % 60);
    const from = new THREE.Vector3(x, z, -faceY(x, z) + 2);
    p.group.position.copy(from);
    p.group.visible = false;
    chunks.push({ mesh: p.group, from });
  }

  // The wyrm: the frozen Korzul, else the kit's silhouette.
  const wyrmU = {
    uFrontZ: { value: FACE_FRONT_Z },
    uHeadPos: { value: new THREE.Vector3(ox + WYRM_HEAD[0], WYRM_HEAD[1], oz + WYRM_HEAD[2]) },
    uCalved: { value: 0 },
  };
  // (The front plane is world z: the slot's origin rides on it.)
  wyrmU.uFrontZ.value = oz + FACE_FRONT_Z;
  const wyrm = new THREE.Group();
  wyrm.name = 'gravewyrmSanctumFrozenWyrm';
  let wyrmMat: THREE.MeshStandardMaterial;
  if (frozen) {
    wyrmMat = wyrmMaterial(frozen.source, wyrmU);
    wyrm.position.set(FROZEN_WYRM.x, FROZEN_WYRM.y, FROZEN_WYRM.z);
    wyrm.rotation.y = FROZEN_WYRM.yaw;
    wyrm.scale.setScalar(FROZEN_WYRM.scale);
    for (const part of frozen.geometries) {
      const mesh = new THREE.Mesh(part.geometry, wyrmMat);
      mesh.applyMatrix4(part.matrix);
      mesh.name = 'frozenKorzul';
      wyrm.add(mesh);
    }
    root.add(wyrm);
  } else {
    wyrmMat = wyrmMaterial(null, wyrmU);
    const sil = sanctumKitPiece('Kit_WyrmSilhouette');
    if (sil?.stone) {
      const mesh = new THREE.Mesh(sil.stone, wyrmMat);
      mesh.name = 'Kit_WyrmSilhouette';
      wyrm.add(mesh);
      frame.add(wyrm);
    }
    const heart = piece('Kit_WyrmHeart');
    if (heart) wyrm.add(heart.group);
  }

  // The shard's light bleeding out through the ice, and his eye.
  const tex = glowTexture();
  const haloMat = new THREE.SpriteMaterial({
    map: tex,
    color: SANCTUM_PALETTE.shard,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    name: 'gravewyrmSanctumShardHalo',
  });
  const halo = new THREE.Sprite(haloMat);
  halo.position.set(WYRM_HEART[0], WYRM_HEART[1], WYRM_HEART[2] - 6);
  halo.scale.set(34, 30, 1);
  halo.renderOrder = 2;
  const wideMat = haloMat.clone();
  wideMat.color.set(SANCTUM_PALETTE.teal);
  wideMat.name = 'gravewyrmSanctumShardScatter';
  const wide = new THREE.Sprite(wideMat);
  wide.position.set(WYRM_HEART[0], WYRM_HEART[1] + 6, WYRM_HEART[2] - 10);
  wide.scale.set(110, 80, 1);
  wide.renderOrder = 2;
  const eyeMat = haloMat.clone();
  eyeMat.color.set(0xffc35a);
  eyeMat.name = 'gravewyrmSanctumEye';
  eyeMat.depthTest = true;
  const eye = new THREE.Sprite(eyeMat);
  eye.position.set(WYRM_EYE[0], WYRM_EYE[1], WYRM_EYE[2] - 1.2);
  eye.scale.set(0.01, 0.01, 1);
  eye.renderOrder = 4;
  root.add(halo, wide, eye);
  // The great split's light deep in the ice (stage 3): a soft warm ribbon
  // down the split's line behind the kit's thin glowing strokes, revealed
  // from the crest down as the split runs.
  const split = splitGlow();
  frame.add(split.mesh);

  // One-shot bursts: the plate's landing, each chain tearing out, the
  // calving, the collapse.
  const toGame = (fx: number, fz: number, fyOff = 0) =>
    new THREE.Vector3(
      FACE_ORIGIN.x - fx,
      FACE_ORIGIN.y + fz,
      FACE_ORIGIN.z + faceY(fx, fz) + fyOff,
    );
  const plateDust = burst(toGame(SCAR[0], 2, -8), 22, 5, new THREE.Vector3(0, 0.3, -1));
  const entries = faceChainEntries();
  const sprays = entries.map((e) =>
    burst(new THREE.Vector3(e[0], e[1], e[2] - 1), 9, 2.4, new THREE.Vector3(0, -0.2, -1)),
  );
  const calveDust = burst(
    toGame(CALVED_C[0], CALVED_C[1], -4),
    30,
    6,
    new THREE.Vector3(0, -0.4, -1),
  );
  const collapseDust = burst(
    new THREE.Vector3(0, 18, FACE_ORIGIN.z - 12),
    90,
    8,
    new THREE.Vector3(0, 0.6, -1),
  );
  const bursts = [plateDust, ...sprays, calveDust, collapseDust];
  for (const b of bursts) root.add(b.mesh);

  // The chains' order: which crack belongs to the c-th chain to fall.
  const runs = planChainRuns();
  const crackOfFall = CHAIN_FALL_ORDER.map((p) => `Kit_FaceCrack_2${'abcd'[runs[p].crack]}`);

  const view = newSanctumStoryView();
  const crackList = [...cracks.entries()];
  let rippled1 = false;
  let rippled5 = false;
  let stamp = Number.NaN;
  const update = (): void => {
    const t = sharedUniforms.uTime.value;
    if (t === stamp) return;
    stamp = t;
    const v = sanctumStoryView(key, t, view);
    const stage = v.stage;
    // The heart and the aurora.
    const glow = heartGlow(stage, t, v.since);
    faceU.uHeart.value = glow;
    SANCTUM_SHARD_UNIFORMS.uAurora.value = auroraLevel(stage, t, v.since);
    SANCTUM_SHARD_UNIFORMS.uBeat.value = glow;
    wyrmMat.emissiveIntensity = 0.35 + glow * 0.9;
    haloMat.opacity = Math.min(1, 0.18 + glow * 0.42);
    wideMat.opacity = Math.min(0.5, 0.05 + glow * 0.12);
    // Stage 4+: the face calved; 5: torn free and collapsing.
    const s4 = v.stageSince[4];
    const s5 = v.stageSince[5];
    const isCalved = stage >= 4 && calved !== null;
    face.group.visible = !isCalved;
    if (calved) calved.group.visible = isCalved;
    wyrmU.uCalved.value = stage >= 4 ? Math.min(1, calveProgress(s4) * 1.6) : 0;
    const open = eyeOpen(stage, s4);
    eye.scale.set(2.6 * (0.4 + 0.6 * open), 2.6 * open + 0.01, 1);
    eyeMat.opacity = open * (0.75 + 0.25 * Math.sin(t * 2.3));
    // The cracks: each shown from its stage (or its chain), racing out.
    for (const [name, c] of crackList) {
      let since = -1;
      if (name === 'Kit_FaceCrack_0') since = v.stageSince[0];
      else if (name === 'Kit_FaceCrack_1') since = v.stageSince[1];
      else if (name === 'Kit_FaceCrack_3') since = v.stageSince[3];
      else {
        const fall = crackOfFall.indexOf(name);
        since = fall >= 0 ? v.chainSince[fall] : -1;
      }
      const shown = since >= 0 && !isCalved;
      c.p.group.visible = shown;
      if (!shown) continue;
      const k = crackReveal(
        since,
        name === 'Kit_FaceCrack_3' ? FACE_EVENT_SECONDS.split : undefined,
      );
      (c.mat.userData.reach as { value: number }).value = k >= 1 ? 1e4 : 4 + k * 120;
      // The cold cracks hold a deep blue light; the great split the shard's
      // warmth, held below the face's own white (the kit's glow is bright).
      if (name === 'Kit_FaceCrack_3') {
        const k = 0.32 + glow * 0.22;
        c.mat.color.setRGB(k, k * 0.78, k * 0.62);
      } else {
        const k = 0.42 + glow * 0.12;
        c.mat.color.setRGB(k * 0.5, k * 0.78, k);
      }
    }
    // The split's light: from stage 3, gone with the calving.
    const s3 = v.stageSince[3];
    split.mesh.visible = s3 >= 0 && !isCalved;
    if (s3 >= 0) {
      split.u.uReveal.value = crackReveal(s3, FACE_EVENT_SECONDS.split);
      split.u.uGlow.value = 0.35 + glow * 0.35;
    }
    // The plate: falls into its rest pose when stage 1 rises.
    if (plate) {
      const s1 = v.stageSince[1];
      plate.group.visible = s1 >= 0;
      if (s1 >= 0) {
        const pose = plateFallPose(s1);
        plate.group.position.set(plateRest.x, plateRest.y + pose.drop, plateRest.z + pose.out);
        plate.group.rotation.x = pose.pitch;
        plateDust.u.uT.value = pose.landed ? s1 - FACE_EVENT_SECONDS.plateFall * 0.8 : -1;
        if (pose.landed && !rippled1 && s1 < FACE_EVENT_SECONDS.plateFall * 2) {
          rippled1 = true;
          const o = toGame(SCAR[0], 0, -10);
          triggerSanctumLakeRipple(o.x, o.z, t);
        }
      }
    }
    // The chains tearing out of the ice: a spray of frost at each entry.
    for (let c = 0; c < 4; c++) {
      const run = runs[CHAIN_FALL_ORDER[c]];
      const since = v.chainSince[c];
      sprays[run.crack].u.uT.value = since >= 0 && chainSpray(since) > 0 ? since : -1;
    }
    // The calving: chunks of the shell over the head fall into the lake.
    calveDust.u.uT.value = s4 >= 0 && s4 < 8 ? s4 : -1;
    // An idle burst is never drawn (its program linked with the interior).
    for (const b of bursts) b.mesh.visible = b.u.uT.value >= 0;
    // The collapse.
    if (s5 >= 0) {
      const pose = collapsePose(s5);
      frame.position.y = FACE_ORIGIN.y - pose.drop;
      frame.rotation.x = -pose.pitch;
      // The frozen wyrm is gone the frame the live Korzul bursts out at the
      // face's foot (Break Free's beat): never two of him, never a gap.
      const held = frozenWyrmShown(s5);
      const sinceBurst = s5 - FACE_BURST_AT;
      wyrm.visible = held;
      halo.visible = s5 < FACE_BURST_AT + 0.4;
      wide.visible = pose.k < 0.6;
      eye.visible = held;
      collapseDust.u.uT.value = sinceBurst >= 0 && sinceBurst < 8 ? sinceBurst : -1;
      if (!rippled5 && pose.k > 0.4 && s5 < 20) {
        rippled5 = true;
        triggerSanctumLakeRipple(0, FACE_ORIGIN.z - 20, t);
      }
      chunks.forEach((ch, i) => {
        const f = chunkFlight(i, s5, FACE_BURST_AT - 0.1 + (i % 5) * 0.2);
        ch.mesh.visible = f.visible;
        // Kit frame: the lake is +z, height is y; rest on the apron.
        ch.mesh.position.set(ch.from.x + f.x, Math.max(1.5, ch.from.y + f.y), ch.from.z - f.z);
        ch.mesh.rotation.set(f.spin, f.spin * 0.7, 0);
      });
    } else {
      frame.position.y = FACE_ORIGIN.y;
      frame.rotation.x = 0;
      frame.visible = true;
      wyrm.visible = true;
      halo.visible = true;
      wide.visible = true;
      eye.visible = true;
      collapseDust.u.uT.value = -1;
      for (const ch of chunks) ch.mesh.visible = false;
      rippled5 = false;
    }
    if (v.stageSince[1] < 0) rippled1 = false;
  };
  update();
  return { group: root, update };
}

/** The face's stand-in markers for tests: how many kit pieces it draws. */
export function faceKitPiecesForTest(): string[] {
  return ['Kit_CalvingFace', 'Kit_FaceCalved', ...CRACKS, 'Kit_FacePlateFallen'];
}

/** Whether a kit-frame point (x, height) lies in the calved hole (tests). */
export function inCalvedHole(x: number, z: number): boolean {
  return calvedR(x, z) < 1;
}
