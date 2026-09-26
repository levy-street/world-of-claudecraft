// three's own program cache key for a (material, object) draw, as an oracle.
//
// Built on the pinned three's real WebGLPrograms (getParameters +
// getProgramCacheKey) over a stub renderer with one fixed scene state: no
// lights, no fog, no clipping, no shadows, the canvas target unless a key
// asks for a bound one (tone mapping and the output colour space follow it).
// Every object asked about gets the same scene state, so two draws whose keys
// differ here differ in what the MATERIAL or the OBJECT hands three, which is
// exactly the question a program-level dedupe has to answer.
//
// Blind spots, by construction: no env map (the environments stub returns
// null), no extensions, no material clipping (the clipping stub is fixed),
// and no scene variation, so a scene input changing between a compile and a
// draw is outside what this oracle can see.
//
// A transparent DoubleSide material without forceSinglePass is drawn (and
// compiled) as two single-sided passes, back then front (WebGLRenderer
// prepareMaterial / renderObject), so its program set is those two keys.

import * as THREE from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';

type ProgramsLike = {
  getParameters(
    material: THREE.Material,
    lights: unknown,
    shadows: unknown[],
    scene: THREE.Object3D,
    object: THREE.Object3D,
    lightProbeGrids: unknown[],
  ): unknown;
  getProgramCacheKey(parameters: unknown): string;
};

const lights = {
  directional: [],
  point: [],
  spot: [],
  spotLightMap: [],
  rectArea: [],
  hemi: [],
  directionalShadowMap: [],
  pointShadowMap: [],
  spotShadowMap: [],
  numSpotLightShadowsWithMaps: 0,
  numLightProbes: 0,
};

let boundTarget: THREE.WebGLRenderTarget | null = null;

const renderer = {
  getRenderTarget: () => boundTarget,
  state: { buffers: { depth: { getReversed: () => false } } },
  toneMapping: THREE.ACESFilmicToneMapping,
  outputColorSpace: THREE.SRGBColorSpace,
  shadowMap: { enabled: false, type: THREE.PCFShadowMap },
};

const programs = new (WebGLPrograms as unknown as new (...args: unknown[]) => ProgramsLike)(
  renderer,
  { get: () => null },
  { has: () => false },
  { logarithmicDepthBuffer: false, precision: 'highp', getMaxPrecision: (p: string) => p },
  {},
  { numPlanes: 0, numIntersection: 0 },
);

// One instance, because its shader cache hands out the custom shader ids a
// ShaderMaterial key carries. But three keeps the last material.precision in
// that instance's closure, so one lowp material would re-key every later
// draw: each key first resets it with a highp probe.
const highpProbe = new THREE.MeshBasicMaterial();
highpProbe.precision = 'highp';

const scene = new THREE.Scene();
const probeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), highpProbe);

function keyAt(material: THREE.Material, object: THREE.Object3D): string {
  programs.getParameters(highpProbe, lights, [], scene, probeMesh, []);
  return programs.getProgramCacheKey(
    programs.getParameters(material, lights, [], scene, object, []),
  );
}

/** The program keys three links for this material on this object, in pass
 *  order, joined: one key, or the back and front keys of a two-pass draw. */
export function threeProgramKeys(
  material: THREE.Material,
  object: THREE.Object3D,
  target: THREE.WebGLRenderTarget | null = null,
): string {
  boundTarget = target;
  if (
    material.transparent === true &&
    material.side === THREE.DoubleSide &&
    material.forceSinglePass === false
  ) {
    material.side = THREE.BackSide;
    const back = keyAt(material, object);
    material.side = THREE.FrontSide;
    const front = keyAt(material, object);
    material.side = THREE.DoubleSide;
    return `${back}\n${front}`;
  }
  return keyAt(material, object);
}

/** Every (object, material) draw under `root` whose object carries a material. */
export function drawsUnder(
  root: THREE.Object3D,
): Array<{ object: THREE.Object3D; material: THREE.Material }> {
  const draws: Array<{ object: THREE.Object3D; material: THREE.Material }> = [];
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      draws.push({ object, material: entry });
    }
  });
  return draws;
}
