import * as THREE from 'three';
import { sharedUniforms } from './gfx';

export const EASTBROOK_CIVIC_MASK_ATTRIBUTE = 'eastbrookCivicMask';

const PROGRAM_CACHE_KEY = 'eastbrook-civic-beacon-v1';
const COMMON_CHUNK = '#include <common>';
const BEGIN_NORMAL_CHUNK = '#include <beginnormal_vertex>';
const BEGIN_VERTEX_CHUNK = '#include <begin_vertex>';
const EMISSIVE_CHUNK = '#include <emissivemap_fragment>';
const decoratedMaterials = new WeakSet<THREE.Material>();

export interface EastbrookCivicBeaconState {
  readonly pivot: { value: THREE.Vector2 };
  readonly reducedMotion: { value: number };
}

function replaceRequired(source: string, chunk: string, replacement: string): string {
  if (!source.includes(chunk)) {
    throw new Error(`Eastbrook civic beacon shader is missing ${chunk}`);
  }
  return source.replace(chunk, replacement);
}

export function createEastbrookCivicBeaconState(
  pivotX: number,
  pivotZ: number,
): EastbrookCivicBeaconState {
  return {
    pivot: { value: new THREE.Vector2(pivotX, pivotZ) },
    reducedMotion: { value: 0 },
  };
}

/**
 * Give every vertex in one merged micro-emissive part an exact one-byte civic
 * selection. The GPU normalizes 255 to 1 and leaves every other part at 0.
 */
export function setEastbrookCivicMask(
  geometry: THREE.BufferGeometry,
  selected: boolean,
): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error('Eastbrook civic mask geometry has no positions');
  const values = new Uint8Array(position.count);
  if (selected) values.fill(255);
  geometry.setAttribute(
    EASTBROOK_CIVIC_MASK_ATTRIBUTE,
    new THREE.Uint8BufferAttribute(values, 1, true),
  );
  return geometry;
}

/** Set the already-bound scalar without allocating in the frame update. */
export function updateEastbrookCivicBeaconMotion(
  state: EastbrookCivicBeaconState,
  reducedMotion: boolean,
): EastbrookCivicBeaconState {
  state.reducedMotion.value = reducedMotion ? 1 : 0;
  return state;
}

/**
 * Animate only civic-mask vertices inside the existing micro-emissive draw.
 * Position and normal use the same Y rotation. Reduced motion retains a steady
 * emissive crystal while removing rotation, bob, and pulse.
 */
export function decorateEastbrookCivicBeaconMaterial<T extends THREE.Material>(
  material: T,
  state: EastbrookCivicBeaconState,
): T {
  if (decoratedMaterials.has(material)) return material;
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uEastbrookCivicPivot = state.pivot;
    shader.uniforms.uEastbrookCivicReducedMotion = state.reducedMotion;
    shader.vertexShader = replaceRequired(
      shader.vertexShader,
      COMMON_CHUNK,
      `${COMMON_CHUNK}
attribute float ${EASTBROOK_CIVIC_MASK_ATTRIBUTE};
varying float vEastbrookCivicMask;
uniform float uTime;
uniform vec2 uEastbrookCivicPivot;
uniform float uEastbrookCivicReducedMotion;`,
    );
    shader.vertexShader = replaceRequired(
      shader.vertexShader,
      BEGIN_NORMAL_CHUNK,
      `${BEGIN_NORMAL_CHUNK}
float eastbrookCivicMotion = 1.0 - uEastbrookCivicReducedMotion;
float eastbrookCivicAngle = uTime * 0.28 * eastbrookCivicMotion;
float eastbrookCivicCos = cos(eastbrookCivicAngle);
float eastbrookCivicSin = sin(eastbrookCivicAngle);
vec3 eastbrookCivicRotatedNormal = vec3(
  objectNormal.x * eastbrookCivicCos + objectNormal.z * eastbrookCivicSin,
  objectNormal.y,
  -objectNormal.x * eastbrookCivicSin + objectNormal.z * eastbrookCivicCos
);
objectNormal = mix(
  objectNormal,
  eastbrookCivicRotatedNormal,
  ${EASTBROOK_CIVIC_MASK_ATTRIBUTE}
);`,
    );
    shader.vertexShader = replaceRequired(
      shader.vertexShader,
      BEGIN_VERTEX_CHUNK,
      `${BEGIN_VERTEX_CHUNK}
vec3 eastbrookCivicOffset = vec3(
  transformed.x - uEastbrookCivicPivot.x,
  transformed.y,
  transformed.z - uEastbrookCivicPivot.y
);
vec3 eastbrookCivicAnimated = vec3(
  eastbrookCivicOffset.x * eastbrookCivicCos + eastbrookCivicOffset.z * eastbrookCivicSin +
    uEastbrookCivicPivot.x,
  eastbrookCivicOffset.y + sin(uTime * 0.85) * 0.04 * eastbrookCivicMotion,
  -eastbrookCivicOffset.x * eastbrookCivicSin + eastbrookCivicOffset.z * eastbrookCivicCos +
    uEastbrookCivicPivot.y
);
transformed = mix(
  transformed,
  eastbrookCivicAnimated,
  ${EASTBROOK_CIVIC_MASK_ATTRIBUTE}
);
vEastbrookCivicMask = ${EASTBROOK_CIVIC_MASK_ATTRIBUTE};`,
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      COMMON_CHUNK,
      `${COMMON_CHUNK}
varying float vEastbrookCivicMask;
uniform float uTime;
uniform float uEastbrookCivicReducedMotion;`,
    );
    shader.fragmentShader = replaceRequired(
      shader.fragmentShader,
      EMISSIVE_CHUNK,
      `${EMISSIVE_CHUNK}
float eastbrookCivicPulse = 1.0 + sin(uTime * 1.3) * 0.08;
float eastbrookCivicAnimatedGlow = mix(
  1.0,
  eastbrookCivicPulse,
  1.0 - uEastbrookCivicReducedMotion
);
float eastbrookCivicGlow = mix(1.0, eastbrookCivicAnimatedGlow, vEastbrookCivicMask);
totalEmissiveRadiance *= eastbrookCivicGlow;`,
    );
  };
  material.customProgramCacheKey = () => `${previousCacheKey()}|${PROGRAM_CACHE_KEY}`;
  material.userData.eastbrookCivicBeacon = {
    maskAttribute: EASTBROOK_CIVIC_MASK_ATTRIBUTE,
    programCacheKey: PROGRAM_CACHE_KEY,
  };
  decoratedMaterials.add(material);
  material.needsUpdate = true;
  return material;
}

export const eastbrookCivicBeaconInternalsForTest = {
  programCacheKey: PROGRAM_CACHE_KEY,
};
