// Volumetric fire material, shared hull geometry, and scene-level lifecycle for
// the shared 3D FireSimulation, modelled on ocean/ocean_material.ts and water.ts.

import * as THREE from 'three';
import { GFX, sharedUniforms } from '../gfx';
import { hexToLinear } from '../ocean/water_character_core';
import { bindSceneSamples } from '../scene_sampling';
import { markSharedGeometry, markSharedMaterial } from '../shared_resource';
import { type FireCharacter, HEARTH_FIRE } from './fire_character_core';
import { advanceFireLiveness, createFireLiveness } from './fire_liveness_core';
import { calmFireUniforms, FireSimulation, type FireVolumeUniforms } from './fire_simulation';
import { type FirePlan, firePlanForTier, shouldUseFireVolume } from './fire_solver_core';
import {
  FIRE_HULL_HEIGHT,
  FIRE_HULL_RADIUS,
  fireSurfaceFragment,
  fireSurfaceVertex,
} from './fire_surface_glsl';

/** Dev only (?firedebug=1): write 1..4 to inspect temperature, fuel, smoke, or velocity. */
export const FIRE_DEBUG_TERM: THREE.IUniform<number> = { value: 0 };

function fireDebugRequested(): boolean {
  if (!import.meta.env?.DEV) return false;
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('firedebug') === '1';
  } catch {
    return false;
  }
}

function sceneSamplePlaceholders(): Record<string, THREE.IUniform> {
  return {
    uOpaqueColor: { value: null },
    uOpaqueDepth: { value: null },
    uSceneReady: { value: 0 },
    uSceneExtent: { value: new THREE.Vector4(1, 1, 1, 1) },
    uSceneClip: { value: new THREE.Vector2(0.1, 1000) },
  };
}

let sharedHullGeometry: THREE.CylinderGeometry | null = null;

/**
 * Shared bounding cylinder hull for volumetric fires, seated at y = 0..FIRE_HULL_HEIGHT.
 */
export function fireVolumeGeometry(): THREE.CylinderGeometry {
  if (sharedHullGeometry) return sharedHullGeometry;
  const geo = new THREE.CylinderGeometry(
    FIRE_HULL_RADIUS,
    FIRE_HULL_RADIUS,
    FIRE_HULL_HEIGHT,
    16,
    1,
    false,
  );
  geo.translate(0, FIRE_HULL_HEIGHT * 0.5, 0);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  sharedHullGeometry = markSharedGeometry(geo);
  return sharedHullGeometry;
}

export interface FireMaterialOptions {
  character?: FireCharacter;
  intensity?: number;
  plan?: FirePlan | null;
}

export function createFireVolumeMaterial(
  fire: FireVolumeUniforms,
  opts: FireMaterialOptions = {},
): THREE.ShaderMaterial {
  const char = opts.character ?? HEARTH_FIRE;
  const plan = opts.plan ?? activeFirePlan();
  const marchSteps = plan?.marchSteps ?? 16;
  const shimmer = Boolean(GFX.ao && (plan?.shimmerStrength ?? 0) > 0);
  const debugTerms = fireDebugRequested();

  const coreLin = hexToLinear(char.core);
  const midLin = hexToLinear(char.mid);
  const tipLin = hexToLinear(char.tip);
  const smokeLin = hexToLinear(char.smoke);

  const material = new THREE.ShaderMaterial({
    name: 'fire:volume',
    uniforms: {
      ...sceneSamplePlaceholders(),
      uFireVelTemp: fire.uFireVelTemp,
      uFireFuelSmoke: fire.uFireFuelSmoke,
      uFireGrid: fire.uFireGrid,
      uFireAtlasMeta: fire.uFireAtlasMeta,
      uTime: sharedUniforms.uTime,
      uFireCoreColor: { value: new THREE.Color(coreLin[0], coreLin[1], coreLin[2]) },
      uFireMidColor: { value: new THREE.Color(midLin[0], midLin[1], midLin[2]) },
      uFireTipColor: { value: new THREE.Color(tipLin[0], tipLin[1], tipLin[2]) },
      uFireSmokeColor: { value: new THREE.Color(smokeLin[0], smokeLin[1], smokeLin[2]) },
      uFireParams: {
        value: new THREE.Vector4(char.smokeDensity, char.swirl, char.draft, opts.intensity ?? 1.0),
      },
      ...(debugTerms ? { uFireDebugTerm: FIRE_DEBUG_TERM } : {}),
    },
    vertexShader: fireSurfaceVertex(),
    fragmentShader: fireSurfaceFragment({ marchSteps, shimmer, debugTerms }),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    // Premultiplied-over blending: HDR blackbody emission adds brightly for
    // bloom while the dense flame heart and light smoke wisps retain body
    // against daylight, snow and stone.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  return markSharedMaterial(material);
}

// ---------------------------------------------------------------------------
// Active scene-wide FireSimulation coordinator (mounted by post.ts on shader
// tiers, stepped only while volumetric fires are on screen).
// ---------------------------------------------------------------------------

let liveSimulation: FireSimulation | null = null;
let liveScene: THREE.Scene | null = null;
let calmFallback: FireVolumeUniforms | null = null;
let sharedVolumeMaterial: THREE.ShaderMaterial | null = null;
const liveness = createFireLiveness();
const trackedMeshes = new Set<THREE.Mesh>();
const sceneSampleReleases = new Map<THREE.Mesh, () => void>();

function activeFirePlan(): FirePlan | null {
  const tier = GFX.constrainedMemory && GFX.waterTier !== 'low' ? 'medium' : GFX.waterTier;
  return firePlanForTier(tier);
}

export function fireForSurfaces(): FireVolumeUniforms {
  if (liveSimulation?.enabled) return liveSimulation.uniforms;
  calmFallback ??= calmFireUniforms(activeFirePlan());
  return calmFallback;
}

export function isFireSimulationMounted(): boolean {
  return Boolean(liveSimulation?.enabled && GFX.standardMaterials);
}

/**
 * Mount the shared GPU 3D fire simulation for the active WebGL2 renderer and
 * scene. Safe to call repeatedly; replaces any prior instance on rebuild.
 */
export function mountFireSimulation(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  seed = 0,
): FireSimulation | null {
  disposeActiveFireSimulation();
  if (!GFX.standardMaterials) return null;
  const plan = activeFirePlan();
  if (!plan) return null;
  const sim = new FireSimulation(renderer, plan, seed);
  if (!sim.enabled) {
    sim.dispose();
    return null;
  }
  liveSimulation = sim;
  liveScene = scene;
  sharedVolumeMaterial = createFireVolumeMaterial(sim.uniforms, { plan });
  return sim;
}

function syncCaptureBindings(captureActive: boolean): void {
  if (!captureActive || !liveScene) {
    for (const release of sceneSampleReleases.values()) release();
    sceneSampleReleases.clear();
    return;
  }
  for (const mesh of trackedMeshes) {
    if (!sceneSampleReleases.has(mesh) && mesh.material instanceof THREE.ShaderMaterial) {
      sceneSampleReleases.set(
        mesh,
        bindSceneSamples(liveScene, mesh as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>),
      );
    }
  }
}

/**
 * Step the shared 3D fire simulation before the frame's scene pass when any
 * volumetric fire drew recently. Returns the number of GPU passes run.
 */
export function stepActiveFireSimulation(time: number): number {
  if (!liveSimulation?.enabled) return 0;
  const step = advanceFireLiveness(liveness, time, true);
  syncCaptureBindings(step.capture);
  if (!step.work) return 0;
  return liveSimulation.update(time);
}

export function disposeActiveFireSimulation(): void {
  for (const release of sceneSampleReleases.values()) release();
  sceneSampleReleases.clear();
  trackedMeshes.clear();
  sharedVolumeMaterial?.dispose();
  sharedVolumeMaterial = null;
  liveSimulation?.dispose();
  liveSimulation = null;
  liveScene = null;
}

interface SavedFlameRepresentation {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  baseScaleX: number;
  baseScaleY: number;
  baseScaleZ: number;
  geomScale: number;
  volumetric: boolean;
}

const savedFlames = new WeakMap<THREE.Mesh, SavedFlameRepresentation>();

/**
 * Perceptual-LOD handoff called by `scenery_flame.ts` for each campfire/brazier
 * flame mesh. When the shared 3D fire simulation is mounted and the flame's
 * projected height on screen is above `FIRE_VOLUME_ENTER_PIXELS`, switches the
 * mesh to the volumetric ray-marched hull; when it shrinks into the distance
 * below `FIRE_VOLUME_EXIT_PIXELS`, restores the cheap distant lathe.
 *
 * Returns true while the flame is in volumetric 3D mode (in which case the
 * bounding hull keeps its steady authored scale instead of pumping the mesh).
 */
export function syncFlameVolumeLod(flame: THREE.Mesh, projectedPixels: number): boolean {
  if (!isFireSimulationMounted() || !sharedVolumeMaterial) {
    const saved = savedFlames.get(flame);
    if (saved?.volumetric) restoreLatheFlame(flame, saved);
    return false;
  }

  let saved = savedFlames.get(flame);
  if (!saved) {
    flame.geometry.computeBoundingBox();
    const bb = flame.geometry.boundingBox;
    const geomHeight = bb ? Math.max(0.25, bb.max.y - bb.min.y) : 0.95;
    const geomScale = geomHeight / 0.95;
    saved = {
      geometry: flame.geometry,
      material: flame.material,
      baseScaleX: flame.scale.x || 1.15,
      baseScaleY: flame.scale.y || 1.15,
      baseScaleZ: flame.scale.z || 1.15,
      geomScale,
      volumetric: false,
    };
    savedFlames.set(flame, saved);
  }

  const wantVolume = shouldUseFireVolume(projectedPixels, saved.volumetric);
  if (wantVolume && !saved.volumetric) {
    saved.volumetric = true;
    flame.geometry = fireVolumeGeometry();
    flame.material = sharedVolumeMaterial;
    flame.scale.set(
      saved.baseScaleX * saved.geomScale,
      saved.baseScaleY * saved.geomScale,
      saved.baseScaleZ * saved.geomScale,
    );
    for (const child of flame.children) child.visible = false;
    trackedMeshes.add(flame);
    if (liveScene && !sceneSampleReleases.has(flame)) {
      sceneSampleReleases.set(
        flame,
        bindSceneSamples(
          liveScene,
          flame as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>,
        ),
      );
    }
  } else if (!wantVolume && saved.volumetric) {
    restoreLatheFlame(flame, saved);
  }
  if (saved.volumetric) {
    liveness.drawnSinceUpdate = true;
  }
  return saved.volumetric;
}

function restoreLatheFlame(flame: THREE.Mesh, saved: SavedFlameRepresentation): void {
  saved.volumetric = false;
  flame.geometry = saved.geometry;
  flame.material = saved.material;
  flame.scale.set(saved.baseScaleX, saved.baseScaleY, saved.baseScaleZ);
  for (const child of flame.children) child.visible = true;
  trackedMeshes.delete(flame);
  const release = sceneSampleReleases.get(flame);
  if (release) {
    release();
    sceneSampleReleases.delete(flame);
  }
}
