// Cosmetic forge atmosphere for Ignivar's flat octagonal raid room. Every
// layer is floor-thin or particle-only, lives outside the central fighting
// radius, and carries no collision or actionable encounter meaning.

import * as THREE from 'three';
import { EMISSIVE_TINT, sharedUniforms, surfaceMat } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

export const IGNIVAR_ARENA_ATMOSPHERE_NAME = 'ignivarArenaAtmosphere';
export const IGNIVAR_RUNIC_INLAYS_NAME = 'ignivarRunicOuterInlays';
export const IGNIVAR_FORGE_VENTS_NAME = 'ignivarForgeVents';
export const IGNIVAR_AMBIENT_PARTICLES_NAME = 'ignivarAmbientEmbers';

/** No arena-atmosphere geometry enters this central combat radius. */
export const IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS = 18;

/** Static grade consumed by the renderer while the Ignivar interior is active.
 *  Sunset-in-a-forge, the shared vibe of all three raid rooms (the room set
 *  and its rationale live in ignivar_raid_environment.ts): a warm amber key
 *  bright enough to read by, lifted smoke fog, near-floor IBL so the daylight
 *  environment map cannot frost the rigs blue, and an ember-tinted rim. */
export const IGNIVAR_ARENA_LIGHTING = Object.freeze({
  fogColor: 0x391408,
  fogNear: 34,
  fogFar: 112,
  sunColor: 0xff9d48,
  // Room-light lift: the ambient legs (key, hemisphere, IBL) run 30% over
  // the first sunset-forge grade (0.98 / 0.43 / 0.1), matching the approach
  // hall's lift; torches and fog stay authored.
  sunIntensity: 1.27,
  hemiSkyColor: 0x93422a,
  hemiGroundColor: 0x280d06,
  hemiIntensity: 0.56,
  envIntensity: 0.13,
  rimIntensity: 1.05,
  rimColor: 0xffa45c,
  forgeLightColor: 0xff6a24,
  emberLightColor: 0xffb15a,
} as const);

export function applyIgnivarArenaFog(fog: Pick<THREE.Fog, 'color' | 'near' | 'far'>): void {
  fog.color.setHex(IGNIVAR_ARENA_LIGHTING.fogColor);
  fog.near = IGNIVAR_ARENA_LIGHTING.fogNear;
  fog.far = IGNIVAR_ARENA_LIGHTING.fogFar;
}

export function applyIgnivarArenaLighting(target: {
  sun: Pick<THREE.DirectionalLight, 'color' | 'intensity'>;
  hemi: Pick<THREE.HemisphereLight, 'color' | 'groundColor' | 'intensity'>;
  scene: { environmentIntensity: number };
  rim: { value: number };
  rimColor: { value: { setHex(value: number): unknown } };
}): void {
  target.sun.color.setHex(IGNIVAR_ARENA_LIGHTING.sunColor);
  target.sun.intensity = IGNIVAR_ARENA_LIGHTING.sunIntensity;
  target.hemi.color.setHex(IGNIVAR_ARENA_LIGHTING.hemiSkyColor);
  target.hemi.groundColor.setHex(IGNIVAR_ARENA_LIGHTING.hemiGroundColor);
  target.hemi.intensity = IGNIVAR_ARENA_LIGHTING.hemiIntensity;
  target.scene.environmentIntensity = IGNIVAR_ARENA_LIGHTING.envIntensity;
  target.rim.value = IGNIVAR_ARENA_LIGHTING.rimIntensity;
  target.rimColor.value.setHex(IGNIVAR_ARENA_LIGHTING.rimColor);
}

export interface IgnivarArenaAtmosphereOptions {
  lowGfx: boolean;
}

type Tier = 'low' | 'high';

const RUNE_RADIUS = 23.25;
const VENT_RADIUS = 28;
const CONDUIT_CLEAR_RADIUS = 4.5;

let runeGeometry: THREE.BoxGeometry | null = null;
let ventBaseGeometry: THREE.CylinderGeometry | null = null;
let ventCoreGeometry: THREE.CircleGeometry | null = null;
const particleGeometries = new Map<Tier, THREE.BufferGeometry>();
const particleMaterials = new Map<Tier, THREE.ShaderMaterial>();

function sharedMaterial(options: Parameters<typeof surfaceMat>[0]): THREE.Material {
  return markSharedMaterial(surfaceMat(options));
}

function markLayer<T extends THREE.Object3D>(
  layer: T,
  name: string,
  minRadius: number,
  maxRadius: number,
): T {
  layer.name = name;
  layer.userData.semanticLayer = name;
  layer.userData.minRadius = minRadius;
  layer.userData.maxRadius = maxRadius;
  layer.userData.collision = 'none';
  layer.userData.actionable = false;
  layer.userData.telegraph = false;
  return layer;
}

function runicInlays(tier: Tier): THREE.InstancedMesh {
  runeGeometry ??= markSharedGeometry(new THREE.BoxGeometry(0.16, 0.018, 4.2));
  const count = tier === 'low' ? 8 : 12;
  const emissiveIntensity = tier === 'low' ? EMISSIVE_TINT * 0.7 : EMISSIVE_TINT * 1.35;
  const material = sharedMaterial({
    color: 0x5b2b20,
    roughness: 0.78,
    metalness: 0.2,
    emissive: 0x8a2b16,
    emissiveIntensity,
  });
  const mesh = markLayer(
    new THREE.InstancedMesh(runeGeometry, material, count),
    IGNIVAR_RUNIC_INLAYS_NAME,
    RUNE_RADIUS - 2.1,
    RUNE_RADIUS + 2.1,
  );
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2;
    rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
    matrix.compose(
      new THREE.Vector3(Math.sin(angle) * RUNE_RADIUS, 0.065, Math.cos(angle) * RUNE_RADIUS),
      rotation,
      scale,
    );
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.emissiveIntensity = emissiveIntensity;
  mesh.userData.runeCount = count;
  mesh.userData.pattern = 'broken-radial';
  return mesh;
}

function forgeVents(tier: Tier): THREE.Group {
  ventBaseGeometry ??= markSharedGeometry(new THREE.CylinderGeometry(1.5, 1.62, 0.12, 16));
  ventCoreGeometry ??= markSharedGeometry(new THREE.CircleGeometry(1.08, 16).rotateX(-Math.PI / 2));
  const baseMaterial = sharedMaterial({
    color: 0x272021,
    roughness: 0.9,
    metalness: 0.22,
  });
  const coreIntensity = tier === 'low' ? 0.62 : 1.12;
  const coreMaterial = sharedMaterial({
    color: 0x522016,
    roughness: 0.72,
    emissive: 0xd94716,
    emissiveIntensity: coreIntensity,
  });
  const group = markLayer(
    new THREE.Group(),
    IGNIVAR_FORGE_VENTS_NAME,
    VENT_RADIUS - 1.62,
    VENT_RADIUS + 1.62,
  );
  const bases = new THREE.InstancedMesh(ventBaseGeometry, baseMaterial, 4);
  bases.name = 'ignivarForgeVentCasings';
  const cores = new THREE.InstancedMesh(ventCoreGeometry, coreMaterial, 4);
  cores.name = 'ignivarForgeVentCores';
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3(1, 1, 1);
  const rotation = new THREE.Quaternion();
  for (let index = 0; index < 4; index++) {
    const angle = (index / 4) * Math.PI * 2;
    const position = new THREE.Vector3(
      Math.sin(angle) * VENT_RADIUS,
      0.09,
      Math.cos(angle) * VENT_RADIUS,
    );
    matrix.compose(position, rotation, scale);
    bases.setMatrixAt(index, matrix);
    position.y = 0.16;
    matrix.compose(position, rotation, scale);
    cores.setMatrixAt(index, matrix);
  }
  bases.instanceMatrix.needsUpdate = true;
  cores.instanceMatrix.needsUpdate = true;
  group.userData.emissiveIntensity = coreIntensity;
  group.userData.ventCount = 4;
  group.add(bases, cores);
  return group;
}

function hash(index: number, salt: number): number {
  const value = Math.sin(index * 91.731 + salt * 47.113) * 43758.5453;
  return value - Math.floor(value);
}

function particleGeometry(tier: Tier): THREE.BufferGeometry {
  const cached = particleGeometries.get(tier);
  if (cached) return cached;
  const count = tier === 'low' ? 32 : 96;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const kinds = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const vent = index % 4;
    const angle = (vent / 4) * Math.PI * 2;
    const tangent = (hash(index, 1) - 0.5) * 4.2;
    const radial = VENT_RADIUS + (hash(index, 2) - 0.5) * 1.2;
    const radialX = Math.sin(angle);
    const radialZ = Math.cos(angle);
    const tangentX = Math.cos(angle);
    const tangentZ = -Math.sin(angle);
    positions[index * 3] = radialX * radial + tangentX * tangent;
    positions[index * 3 + 1] = 0.25 + hash(index, 3) * 1.8;
    positions[index * 3 + 2] = radialZ * radial + tangentZ * tangent;
    phases[index] = hash(index, 4);
    kinds[index] = tier === 'high' && index % 5 === 0 ? 1 : 0;
  }
  const geometry = markSharedGeometry(new THREE.BufferGeometry());
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  geometry.computeBoundingSphere();
  particleGeometries.set(tier, geometry);
  return geometry;
}

function particleMaterial(tier: Tier): THREE.ShaderMaterial {
  const cached = particleMaterials.get(tier);
  if (cached) return cached;
  const material = markSharedMaterial(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uIntensity: { value: tier === 'low' ? 0.64 : 1 },
      },
      vertexShader: `
        uniform float uTime;
        attribute float aPhase;
        attribute float aKind;
        varying float vKind;
        varying float vPulse;
        void main() {
          vKind = aKind;
          float speed = mix(0.52, 0.16, aKind);
          float rise = mod(aPhase * 5.2 + uTime * speed, 5.2);
          vec3 animated = position;
          animated.y += rise;
          float drift = mix(0.18, 0.62, aKind);
          animated.x += sin(uTime * 0.55 + aPhase * 19.0) * drift;
          animated.z += cos(uTime * 0.47 + aPhase * 17.0) * drift;
          vPulse = 0.72 + 0.28 * sin(uTime * 3.1 + aPhase * 31.0);
          vec4 mvPosition = modelViewMatrix * vec4(animated, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = mix(4.5, 13.0, aKind) * clamp(110.0 / -mvPosition.z, 0.55, 2.2);
        }
      `,
      fragmentShader: `
        uniform float uIntensity;
        varying float vKind;
        varying float vPulse;
        void main() {
          float radius = length(gl_PointCoord - vec2(0.5));
          if (radius > 0.5) discard;
          float edge = smoothstep(0.5, 0.08, radius);
          vec3 ember = mix(vec3(1.0, 0.16, 0.025), vec3(1.0, 0.58, 0.12), edge);
          vec3 smoke = vec3(0.16, 0.09, 0.07);
          vec3 color = mix(ember, smoke, vKind);
          float alpha = mix(0.48 * vPulse, 0.1, vKind) * edge * uIntensity;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    }),
  );
  material.userData.sharedTimeUniform = sharedUniforms.uTime;
  material.userData.maxOpacity = tier === 'low' ? 0.31 : 0.48;
  particleMaterials.set(tier, material);
  return material;
}

function ambientParticles(tier: Tier): THREE.Points {
  const geometry = particleGeometry(tier);
  const points = markLayer(
    new THREE.Points(geometry, particleMaterial(tier)),
    IGNIVAR_AMBIENT_PARTICLES_NAME,
    VENT_RADIUS - 2.8,
    VENT_RADIUS + 2.8,
  );
  points.frustumCulled = false;
  points.renderOrder = 1;
  points.userData.particleCount = geometry.getAttribute('position').count;
  points.userData.smokeParticleCount =
    tier === 'low' ? 0 : Math.ceil(points.userData.particleCount / 5);
  points.userData.outerBandOnly = true;
  return points;
}

/** Build local-space atmosphere for the IGNIVAR_LAYOUT interior root. */
export function buildIgnivarArenaAtmosphere(options: IgnivarArenaAtmosphereOptions): THREE.Group {
  const tier: Tier = options.lowGfx ? 'low' : 'high';
  const root = new THREE.Group();
  root.name = IGNIVAR_ARENA_ATMOSPHERE_NAME;
  root.userData.renderCategory = 'dungeon';
  root.userData.floorClearRadius = IGNIVAR_ARENA_FLOOR_CLEAR_RADIUS;
  root.userData.conduitClearRadius = CONDUIT_CLEAR_RADIUS;
  root.userData.collision = 'none';
  root.userData.actionable = false;
  root.userData.telegraph = false;
  root.userData.tier = tier;
  root.add(runicInlays(tier), forgeVents(tier), ambientParticles(tier));
  return root;
}
