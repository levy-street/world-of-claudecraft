// The Smith's Seal Gate, the Gravewyrm Sanctum's world entrance (door (0, 858),
// Thornpeak Heights): the three Blender GLBs (the gate and its tunnel, the plaza
// props, the far ice tongue on the ridge) seated on the door's terrain height,
// plus its cosmetic layer: the faint blue rune light (the one point light, a
// fire-light sink source), the cold mist film across the tunnel mouth (the
// door's portal look; the door body itself is only the invisible click box,
// see doorArchAuthoredElsewhere in door_portal.ts), the rime fan on the plaza
// and one instanced draw of cold mist pouring out along the ground (thinned
// by the static effects tier). Pure placement and flow math lives in
// sanctum_seal_gate_core.ts; what collides is src/sim/sanctum_seal_gate.ts.
//
// Built once at boot as a static zone feature (static_world_features.ts), so it
// attaches through the renderer's gated attach (its programs link before its
// first visible frame), freezes its matrices and culls with the fog sweep. The
// mist moves on the shared uTime clock in its vertex shader: no per-frame CPU.
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { DUNGEONS } from '../sim/data';
import { SANCTUM_SEAL_GATE_DUNGEON_ID } from '../sim/sanctum_seal_gate';
import { terrainHeight } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { GFX, sharedUniforms, surfaceMat } from './gfx';
import { decorateMistMaterial, mistNoiseTexture } from './ignivar_mist_gate';
import {
  rimeFanAlpha,
  rimeFanVertex,
  SANCTUM_MIST_FILM,
  SANCTUM_MIST_FLOW,
  SANCTUM_RIME_FAN,
  SANCTUM_RUNE_LIGHT,
  type SealGateEffectsTier,
  sanctumMistPuff,
  sanctumMistPuffCount,
} from './sanctum_seal_gate_core';
import { sealGateSurfaceMaterial, setSealSurfaceOrigin } from './sanctum_seal_gate_surface';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const GATE_URL = '/models/props/sanctum_seal_gate.glb';
const PROPS_URL = '/models/props/sanctum_seal_gate_props.glb';
const ICE_URL = '/models/props/sanctum_seal_gate_ice.glb';
const sources = new Map<string, THREE.Group>();
if (typeof window !== 'undefined') {
  for (const url of [GATE_URL, PROPS_URL, ICE_URL]) {
    registerDeferredPreload(() =>
      loadGltf(url).then((gltf) => {
        sources.set(url, gltf.scene);
      }),
    );
  }
}
export const sanctumSealGatePreloadInternalsForTest = { urls: [GATE_URL, PROPS_URL, ICE_URL] };

export const SANCTUM_MIST_PROGRAM_CACHE_KEY = 'sanctum-cold-mist-v1';

export interface SanctumSealGateView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  cullGroups: THREE.Group[];
}

// ---- materials (module-lifetime, shared) ------------------------------------------

let runeMat: THREE.MeshBasicMaterial | null = null;

/** The Blender nodes whose KitStone is the MOUNTAIN's rock (the spur the
 *  tunnel is cut into, the ice tongue's cheeks), not the Smith's masonry. */
const MOUNTAIN_ROCK_NODES = new Set(['Entrance_Tunnel', 'Entrance_IceTongue']);

/** The lit slots go through surfaceMat every time (it caches per graphics
 *  tier, so a live profile switch gets the new tier's material); the runes
 *  are unlit on every tier. The mountain rock and the glacier ice take the
 *  Thornpeak surfaces (sanctum_seal_gate_surface.ts, cached per tier too). */
function kitMaterial(name: string, node = ''): THREE.Material {
  if (name === 'KitGlow') {
    if (!runeMat) {
      // The Smith's runes: unlit, a faint clean blue, low like embers.
      const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      glow.color.setScalar(0.72);
      glow.name = 'SanctumSealGateRunes';
      runeMat = markSharedMaterial(glow);
    }
    return runeMat;
  }
  if (name === 'KitIce') return sealGateSurfaceMaterial('ice');
  if (MOUNTAIN_ROCK_NODES.has(node)) return sealGateSurfaceMaterial('rock');
  return surfaceMat({ vertexColors: true, roughness: 0.9 });
}

/** The mountain-rock piece a mesh belongs to, if any: the loader names a
 *  one-primitive node's mesh after the node, and parents a multi-primitive
 *  node's meshes under a group that carries it. */
function entrancePiece(node: THREE.Object3D): string {
  for (let o: THREE.Object3D | null = node; o; o = o.parent) {
    if (MOUNTAIN_ROCK_NODES.has(o.name)) return o.name;
  }
  return node.name;
}

function seat(source: THREE.Group, castShadow: boolean): THREE.Group {
  const model = source.clone(true);
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    markSharedGeometry(node.geometry);
    const piece = entrancePiece(node);
    const swap = (m: THREE.Material) => kitMaterial(m.name, piece);
    node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
    node.castShadow = castShadow;
    node.receiveShadow = true;
  });
  return model;
}

/** Pre-load and headless stand-in: the pylons and the lintel as plain blocks,
 *  so the colliders are never invisible walls if the GLB is missing. */
function fallbackGate(): THREE.Group {
  const root = new THREE.Group();
  const stone = surfaceMat({ color: 0x23262c, roughness: 0.9 });
  const box = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
  for (const [x, y, z, w, h, d] of [
    [3.65, 6.95, 0.3, 3.3, 13.9, 4.1],
    [-3.65, 6.95, 0.3, 3.3, 13.9, 4.1],
    [0, 12.1, 0.55, 16, 2.4, 3.9],
  ] as const) {
    const mesh = new THREE.Mesh(box, stone);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    root.add(mesh);
  }
  return root;
}

let filmGeo: THREE.BufferGeometry | null = null;
let filmHaze: THREE.MeshBasicMaterial | null = null;
let filmGlow: THREE.MeshBasicMaterial | null = null;

function mistFilm(): THREE.Group {
  filmGeo ??= markSharedGeometry(new THREE.PlaneGeometry(1, 1));
  // The mist gate family's own drifting sheet (one shared program), in the
  // Quench's colours: a pale cold haze and a faint rune-blue breath over it.
  filmHaze ??= markSharedMaterial(
    decorateMistMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x8aa3b4,
        map: mistNoiseTexture() ?? undefined,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      0.18,
    ),
  );
  if (!filmGlow) {
    const glow = new THREE.MeshBasicMaterial({
      color: 0x5ab8ff,
      map: mistNoiseTexture() ?? undefined,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // additive sheets may only fade toward black: no fog-coloured light
      fog: false,
    });
    filmGlow = markSharedMaterial(decorateMistMaterial(glow, 0.45));
  }
  const film = new THREE.Group();
  film.name = 'sanctumMistFilm';
  const f = SANCTUM_MIST_FILM;
  for (const [material, dz] of [
    [filmHaze, 0],
    [filmGlow, -0.05],
  ] as const) {
    const sheet = new THREE.Mesh(filmGeo, material);
    sheet.scale.set(f.width, f.height, 1);
    sheet.position.set(0, f.centerY, f.lz + dz);
    film.add(sheet);
  }
  return film;
}

// ---- the cold mist pouring out of the mouth (one instanced draw) ---------------------

let puffTex: THREE.CanvasTexture | null = null;
let mistMat: THREE.MeshBasicMaterial | null = null;

function puffTexture(): THREE.CanvasTexture | null {
  if (puffTex) return puffTex;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  puffTex = new THREE.CanvasTexture(canvas);
  return puffTex;
}

// The vertex stage mirrors sanctumMistPose (sanctum_seal_gate_core.ts): the
// puff's centre flows out of the mouth and widens, the quad faces the camera.
const f = SANCTUM_MIST_FLOW;
const MIST_VERTEX = `float sT = fract(aPuff.x + uTime * aPuff.y);
vec3 sCenter = vec3(
  aPuff.z * (0.8 + sT * ${f.spread.toFixed(2)}) + sin(uTime * 0.3 + aPuff.x * 6.2831853) * 0.6,
  ${f.startY.toFixed(2)} + (${f.endY.toFixed(2)} - ${f.startY.toFixed(2)}) * sT,
  ${f.startLz.toFixed(2)} + (${f.endLz.toFixed(2)} - ${f.startLz.toFixed(2)}) * sT);
float sScale = (1.6 + sT * 3.4) * aPuff.w;
vec4 mvPosition = modelViewMatrix * vec4(sCenter, 1.0);
mvPosition.xy += position.xy * vec2(sScale, sScale * 0.5);
vPuffAlpha = smoothstep(0.0, 0.15, sT) * (1.0 - smoothstep(0.65, 1.0, sT));
gl_Position = projectionMatrix * mvPosition;`;

function coldMistMaterial(): THREE.MeshBasicMaterial {
  if (mistMat) return mistMat;
  const material = new THREE.MeshBasicMaterial({
    color: 0xb4c6d3,
    map: puffTexture() ?? undefined,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aPuff;\nuniform float uTime;\nvarying float vPuffAlpha;',
      )
      .replace('#include <project_vertex>', MIST_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPuffAlpha;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vPuffAlpha;');
  };
  material.customProgramCacheKey = () => SANCTUM_MIST_PROGRAM_CACHE_KEY;
  material.name = 'SanctumColdMist';
  mistMat = markSharedMaterial(material);
  return mistMat;
}

function coldMist(tier: SealGateEffectsTier): THREE.InstancedMesh {
  const count = sanctumMistPuffCount(tier);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const puffs = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const p = sanctumMistPuff(i, count);
    puffs.set([p.phase, p.speed, p.lane, p.size], i * 4);
  }
  geometry.setAttribute('aPuff', new THREE.InstancedBufferAttribute(puffs, 4));
  const mesh = new THREE.InstancedMesh(geometry, coldMistMaterial(), count);
  // The shader ignores these matrices; they are seeded across the flow's
  // envelope (each puff at mid-flow on its lane) so the fog sweep's footprint
  // measurement at attach sees the whole spread.
  const m = new THREE.Matrix4();
  const flow = SANCTUM_MIST_FLOW;
  for (let i = 0; i < count; i++) {
    const p = sanctumMistPuff(i, count);
    const t = (i + 0.5) / count;
    m.makeTranslation(
      p.lane * (0.8 + t * flow.spread),
      flow.startY + (flow.endY - flow.startY) * t,
      flow.startLz + (flow.endLz - flow.startLz) * t,
    );
    mesh.setMatrixAt(i, m);
  }
  // Every puff travels the whole flow in the shader, away from its seeded
  // matrix: frustum culling would drop puffs still on screen. The gate's cull
  // group (the fog sweep) still sheds it with the rest of the set piece.
  mesh.frustumCulled = false;
  mesh.renderOrder = floorVfxRenderOrder('ground', 1);
  mesh.name = 'sanctumColdMist';
  return mesh;
}

// ---- the rime fan, draped on the sim's own terrain -----------------------------------

// Keyed by the tier's material family, so a live graphics-profile switch
// builds the other family instead of keeping the first build's.
const rimeMats = new Map<boolean, THREE.Material>();

function rimeMaterial(): THREE.Material {
  const cached = rimeMats.get(GFX.standardMaterials);
  if (cached) return cached;
  const opts = {
    color: 0xeef6fa,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  };
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ ...opts, roughness: 0.55 })
    : new THREE.MeshLambertMaterial(opts);
  material.name = 'SanctumRimeFan';
  rimeMats.set(GFX.standardMaterials, markSharedMaterial(material));
  return material;
}

function rimeFan(door: { x: number; z: number }, base: number, seed: number): THREE.Mesh {
  const fan = SANCTUM_RIME_FAN;
  const positions: number[] = [];
  const colors: number[] = [];
  for (let row = 0; row <= fan.rows; row++) {
    for (let col = 0; col <= fan.cols; col++) {
      const { lx, lz } = rimeFanVertex(row, col);
      positions.push(lx, terrainHeight(door.x + lx, door.z + lz, seed) - base + fan.lift, lz);
      colors.push(1, 1, 1, rimeFanAlpha(row, col));
    }
  }
  const index: number[] = [];
  const stride = fan.cols + 1;
  for (let row = 0; row < fan.rows; row++) {
    for (let col = 0; col < fan.cols; col++) {
      const a = row * stride + col;
      index.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, rimeMaterial());
  mesh.receiveShadow = true;
  mesh.renderOrder = floorVfxRenderOrder('ground', 0);
  mesh.name = 'sanctumRimeFan';
  return mesh;
}

/** Build the Seal Gate (world coordinates). */
export function buildSanctumSealGate(seed: number): SanctumSealGateView {
  const door = DUNGEONS[SANCTUM_SEAL_GATE_DUNGEON_ID].doorPos;
  const base = terrainHeight(door.x, door.z, seed);
  setSealSurfaceOrigin(door.x, base, door.z);
  const group = new THREE.Group();
  group.name = 'sanctumSealGate';
  const gate = new THREE.Group();
  gate.name = 'sanctumSealGateBody';
  gate.position.set(door.x, base, door.z);
  const gateSource = sources.get(GATE_URL);
  gate.add(gateSource ? seat(gateSource, true) : fallbackGate());
  const propsSource = sources.get(PROPS_URL);
  if (propsSource) gate.add(seat(propsSource, true));
  gate.add(mistFilm());
  gate.add(rimeFan(door, base, seed));
  const fx = resolveUiEffectsProfile({
    presetLabel: GFX.tier,
    effectsQuality: 1,
    reduceMotion: false,
  });
  gate.add(coldMist(fx.tier));
  group.add(gate);
  // The ice tongue hangs 50 yd up the ridge: its own cull group, so it stays on
  // the skyline while the gate itself is still beyond the fog.
  const ice = new THREE.Group();
  ice.name = 'sanctumIceTongue';
  ice.position.copy(gate.position);
  const iceSource = sources.get(ICE_URL);
  if (iceSource) ice.add(seat(iceSource, false));
  group.add(ice);
  const light = new THREE.PointLight(
    SANCTUM_RUNE_LIGHT.color,
    SANCTUM_RUNE_LIGHT.intensity,
    SANCTUM_RUNE_LIGHT.distance,
    2,
  );
  light.position.set(
    door.x + SANCTUM_RUNE_LIGHT.lx,
    base + SANCTUM_RUNE_LIGHT.y,
    door.z + SANCTUM_RUNE_LIGHT.lz,
  );
  group.add(light);
  return { group, glowLights: [light], cullGroups: [gate, ice] };
}

export const sanctumSealGateInternalsForTest = {
  kitMaterial,
  coldMistMaterial,
  mistVertex: MIST_VERTEX,
  rimeMaterial,
  resetCaches(): void {
    rimeMats.clear();
    filmGeo = filmHaze = filmGlow = mistMat = runeMat = null;
    puffTex = null;
  },
};
