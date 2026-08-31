// Physical perimeter moat for Ignivar's arena. The authoritative footprint and
// burn live in sim/ignivar_arena; this module only makes that same footprint
// legible. Its project-owned texture was generated from the owner's Drive lava
// reference without redistributing that licensed reference asset.

import * as THREE from 'three';
import {
  IGNIVAR_ARENA_SHELL_POLYGON,
  IGNIVAR_LAVA_BRIDGE_HALF_WIDTH,
  IGNIVAR_LAVA_BRIDGE_INNER_Z,
  IGNIVAR_LAVA_MOAT_DEPTH,
  IGNIVAR_PLAYABLE_FLOOR_POLYGON,
  ignivarArenaPointInLava,
} from '../sim/ignivar_arena';
import { loadTexture } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { sharedUniforms } from './gfx';
import { markSharedGeometry, markSharedMaterial, markSharedTexture } from './shared_resource';

export const IGNIVAR_LAVA_MOAT_NAME = 'ignivarLavaMoat';
export const IGNIVAR_LAVA_COLOR_URL = '/textures/encounters/ignivar/ignivar_lava_original.webp';

export interface IgnivarLavaMoatTextures {
  color: THREE.Texture;
}

export interface IgnivarLavaMoatOptions {
  lowGfx: boolean;
  /** Test/lookdev seam. Production uses ensureIgnivarLavaMoatAssets(). */
  textures?: IgnivarLavaMoatTextures;
}

let assets: IgnivarLavaMoatTextures | null = null;
let assetTask: Promise<IgnivarLavaMoatTextures> | null = null;

export function ensureIgnivarLavaMoatAssets(): Promise<IgnivarLavaMoatTextures> {
  if (assets) return Promise.resolve(assets);
  assetTask ??= loadTexture(IGNIVAR_LAVA_COLOR_URL, { srgb: true, repeat: true })
    .then((color) => {
      assets = { color: markSharedTexture(color) };
      return assets;
    })
    .catch((error: unknown) => {
      // A transient fetch/decode failure must not poison every later room entry.
      assetTask = null;
      throw error;
    });
  return assetTask;
}

if (typeof window !== 'undefined') {
  registerDeferredPreload(() => ensureIgnivarLavaMoatAssets());
}

let lavaGeometry: THREE.ShapeGeometry | null = null;
function sharedLavaGeometry(): THREE.ShapeGeometry {
  if (lavaGeometry) return lavaGeometry;
  const outer = new THREE.Shape();
  outer.moveTo(IGNIVAR_ARENA_SHELL_POLYGON[0].x, IGNIVAR_ARENA_SHELL_POLYGON[0].z);
  for (let index = 1; index < IGNIVAR_ARENA_SHELL_POLYGON.length; index++) {
    outer.lineTo(IGNIVAR_ARENA_SHELL_POLYGON[index].x, IGNIVAR_ARENA_SHELL_POLYGON[index].z);
  }
  outer.closePath();
  // The lava spans the whole shell underneath the opaque floor tiles. That
  // makes every skipped stair-step cell visibly molten while the retained tile
  // union and exact bridge decks cover it at y=0, matching the sim footprint.
  lavaGeometry = markSharedGeometry(new THREE.ShapeGeometry(outer).rotateX(-Math.PI / 2));
  lavaGeometry.computeVertexNormals();
  return lavaGeometry;
}

const lavaMaterials = new Map<string, THREE.ShaderMaterial>();
function lavaMaterial(textures: IgnivarLavaMoatTextures, lowGfx: boolean): THREE.ShaderMaterial {
  const key = `${textures.color.uuid}:${lowGfx ? 'low' : 'high'}`;
  const cached = lavaMaterials.get(key);
  if (cached) return cached;
  const material = markSharedMaterial(
    new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
        uColorMap: { value: textures.color },
        uIntensity: { value: lowGfx ? 1.04 : 1.24 },
        uFlowStrength: { value: lowGfx ? 0.055 : 0.095 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vLavaUv;
        varying vec3 vWorldPosition;
        #include <fog_pars_vertex>
        void main() {
          vec3 pos = position;
          float ripple = sin(position.x * 0.38 + uTime * 0.9)
            * cos(position.z * 0.31 - uTime * 0.72);
          pos.y += ripple * 0.025;
          // ShapeGeometry UVs are authored in room units. Keep roughly four
          // lava tiles across the 66u arena instead of producing a tiny
          // orange checkerboard at the perimeter.
          vLavaUv = position.xz * 0.065;
          vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
          vWorldPosition = worldPosition.xyz;
          vec4 mvPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uColorMap;
        uniform float uIntensity;
        uniform float uFlowStrength;
        varying vec2 vLavaUv;
        varying vec3 vWorldPosition;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec2 flowA = vec2(uTime * 0.018, -uTime * 0.009);
          vec2 flowB = vec2(-uTime * 0.011, uTime * 0.015);
          vec3 colorA = texture2D(uColorMap, vLavaUv + flowA).rgb;
          vec3 colorB = texture2D(uColorMap, vLavaUv.yx * 0.83 + flowB).rgb;
          float flowNoise = 0.5 + 0.5 * sin(
            vWorldPosition.x * 0.22 - vWorldPosition.z * 0.17 + uTime * 1.35
          );
          vec3 base = mix(colorA, colorB, 0.12 + flowNoise * 0.08);
          // The authored albedo already separates black volcanic plates from
          // yellow-white cracks. Key heat from green luminance so those plates
          // stay dark instead of the whole moat collapsing into flat orange.
          float hot = smoothstep(0.16, 0.58, base.g);
          float flowRelief = clamp(length(colorA - colorB) * 0.5, 0.0, 1.0);
          float shimmer = 0.86 + flowRelief * uFlowStrength + flowNoise * 0.14;
          vec3 ember = vec3(1.0, 0.15, 0.012);
          vec3 core = vec3(1.0, 0.68, 0.08);
          vec3 crust = base * vec3(0.74, 0.58, 0.5);
          vec3 molten = base * vec3(1.22, 0.9, 0.58) + mix(ember, core, hot) * hot * 0.48;
          vec3 color = mix(crust, molten, hot);
          color *= shimmer * uIntensity;
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      fog: true,
      side: THREE.DoubleSide,
      depthWrite: true,
      toneMapped: true,
    }),
  );
  material.userData.sharedTimeUniform = sharedUniforms.uTime;
  material.userData.source = 'project-generated:drive-referenced-lava';
  lavaMaterials.set(key, material);
  return material;
}

interface Segment {
  a: { x: number; z: number };
  b: { x: number; z: number };
}

function innerLipSegments(): Segment[] {
  const out: Segment[] = [];
  for (let index = 0; index < IGNIVAR_PLAYABLE_FLOOR_POLYGON.length; index++) {
    const a = IGNIVAR_PLAYABLE_FLOOR_POLYGON[index];
    const b = IGNIVAR_PLAYABLE_FLOOR_POLYGON[(index + 1) % IGNIVAR_PLAYABLE_FLOOR_POLYGON.length];
    if (a.z === b.z && Math.abs(a.z) === 29) {
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      out.push(
        { a: left, b: { x: -IGNIVAR_LAVA_BRIDGE_HALF_WIDTH, z: left.z } },
        { a: { x: IGNIVAR_LAVA_BRIDGE_HALF_WIDTH, z: right.z }, b: right },
      );
      continue;
    }
    out.push({ a, b });
  }
  return out;
}

let innerLipGeometry: THREE.BufferGeometry | null = null;
function sharedInnerLipGeometry(): THREE.BufferGeometry {
  if (innerLipGeometry) return innerLipGeometry;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const segment of innerLipSegments()) {
    const base = positions.length / 3;
    positions.push(
      segment.a.x,
      0.02,
      segment.a.z,
      segment.b.x,
      0.02,
      segment.b.z,
      segment.b.x,
      -IGNIVAR_LAVA_MOAT_DEPTH,
      segment.b.z,
      segment.a.x,
      -IGNIVAR_LAVA_MOAT_DEPTH,
      segment.a.z,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  innerLipGeometry = markSharedGeometry(new THREE.BufferGeometry());
  innerLipGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  innerLipGeometry.setIndex(indices);
  innerLipGeometry.computeVertexNormals();
  return innerLipGeometry;
}

let lipMaterial: THREE.MeshStandardMaterial | null = null;
function sharedLipMaterial(): THREE.MeshStandardMaterial {
  lipMaterial ??= markSharedMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x1b1010,
      emissive: 0x4f0b02,
      emissiveIntensity: 0.34,
      roughness: 0.94,
      metalness: 0.08,
      side: THREE.DoubleSide,
    }),
  );
  return lipMaterial;
}

let bridgeGeometry: THREE.BoxGeometry | null = null;
let bridgeMaterial: THREE.MeshStandardMaterial | null = null;
function bridges(): THREE.InstancedMesh {
  bridgeGeometry ??= markSharedGeometry(
    new THREE.BoxGeometry(IGNIVAR_LAVA_BRIDGE_HALF_WIDTH * 2, 0.32, 5.5),
  );
  bridgeMaterial ??= markSharedMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x332526,
      emissive: 0x40150b,
      emissiveIntensity: 0.2,
      roughness: 0.82,
      metalness: 0.18,
    }),
  );
  const mesh = new THREE.InstancedMesh(bridgeGeometry, bridgeMaterial, 2);
  mesh.name = 'ignivarLavaBridges';
  const matrix = new THREE.Matrix4();
  const center = (IGNIVAR_LAVA_BRIDGE_INNER_Z + 33) / 2;
  matrix.makeTranslation(0, -0.14, -center);
  mesh.setMatrixAt(0, matrix);
  matrix.makeTranslation(0, -0.14, center);
  mesh.setMatrixAt(1, matrix);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.collision = 'heightfield';
  mesh.userData.actionable = true;
  mesh.userData.bridgeCount = 2;
  mesh.userData.halfWidth = IGNIVAR_LAVA_BRIDGE_HALF_WIDTH;
  return mesh;
}

const emberGeometries = new Map<'low' | 'high', THREE.BufferGeometry>();
function emberGeometry(tier: 'low' | 'high'): THREE.BufferGeometry {
  const cached = emberGeometries.get(tier);
  if (cached) return cached;
  const count = tier === 'low' ? 20 : 56;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  let seed = tier === 'low' ? 0x1a7a : 0xf043;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let index = 0; index < count; ) {
    const x = (random() * 2 - 1) * 33;
    const z = (random() * 2 - 1) * 33;
    if (!ignivarArenaPointInLava(x, z)) continue;
    positions[index * 3] = x;
    positions[index * 3 + 1] = -IGNIVAR_LAVA_MOAT_DEPTH + 0.08 + random() * 0.16;
    positions[index * 3 + 2] = z;
    phases[index] = random();
    index++;
  }
  const geometry = markSharedGeometry(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();
  emberGeometries.set(tier, geometry);
  return geometry;
}

const emberMaterials = new Map<'low' | 'high', THREE.ShaderMaterial>();
function emberMaterial(tier: 'low' | 'high'): THREE.ShaderMaterial {
  const cached = emberMaterials.get(tier);
  if (cached) return cached;
  const material = markSharedMaterial(
    new THREE.ShaderMaterial({
      uniforms: { uTime: sharedUniforms.uTime, uAlpha: { value: tier === 'low' ? 0.54 : 0.78 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        attribute float aPhase;
        varying float vLife;
        void main() {
          vec3 pos = position;
          float life = fract(aPhase + uTime * 0.21);
          pos.y += life * 1.7;
          pos.x += sin(aPhase * 37.0 + uTime * 1.7) * 0.18;
          pos.z += cos(aPhase * 41.0 + uTime * 1.4) * 0.18;
          vLife = 1.0 - life;
          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = (3.0 + vLife * 5.0) * clamp(90.0 / -mvPosition.z, 0.6, 2.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vLife;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float glow = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(mix(vec3(1.0, 0.12, 0.01), vec3(1.0, 0.72, 0.12), glow), glow * vLife * uAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  emberMaterials.set(tier, material);
  return material;
}

export function buildIgnivarLavaMoat(options: IgnivarLavaMoatOptions): THREE.Group {
  const textures = options.textures ?? assets;
  if (!textures) {
    throw new Error('Ignivar lava assets must be prepared before building the arena');
  }
  const tier = options.lowGfx ? 'low' : 'high';
  const root = new THREE.Group();
  root.name = IGNIVAR_LAVA_MOAT_NAME;
  root.userData.renderCategory = 'dungeon';
  root.userData.semanticLayer = 'encounter-hazard';
  root.userData.collision = 'heightfield';
  root.userData.actionable = true;
  root.userData.hazard = 'lava';
  root.userData.depth = IGNIVAR_LAVA_MOAT_DEPTH;
  root.userData.source = 'project-generated:drive-referenced-lava';
  root.userData.tier = tier;

  const surface = new THREE.Mesh(sharedLavaGeometry(), lavaMaterial(textures, options.lowGfx));
  surface.name = 'ignivarLavaSurface';
  surface.position.y = -IGNIVAR_LAVA_MOAT_DEPTH + 0.03;
  surface.renderOrder = 1;
  surface.userData.source = 'project-generated:drive-referenced-lava';
  surface.userData.actionable = true;
  surface.userData.hazard = 'lava';

  const lip = new THREE.Mesh(sharedInnerLipGeometry(), sharedLipMaterial());
  lip.name = 'ignivarLavaInnerLip';
  lip.userData.collision = 'heightfield';
  lip.userData.actionable = true;

  const embers = new THREE.Points(emberGeometry(tier), emberMaterial(tier));
  embers.name = 'ignivarLavaEmbers';
  embers.frustumCulled = false;
  embers.renderOrder = 2;
  embers.userData.collision = 'none';
  embers.userData.actionable = false;

  root.add(surface, lip, bridges(), embers);
  return root;
}
