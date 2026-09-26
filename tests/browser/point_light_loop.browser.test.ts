// Real-WebGL pin for the point-light loop in point_light_shader_core.ts. The
// Node suite pins the chunk TEXT; only a real driver can say the loop arm
// preprocesses, compiles and links under the configuration every game program
// has (USE_SHADOWMAP defined by a casting sun, no point shadow), and that it
// lights a fragment exactly like the unrolled form it replaces.
//
// The unrolled baseline is the same patched chunk with its point-shadow arm
// forced on, which the Node suite pins as the previous guarded unrolled block,
// drawn with the scattered lights three gathers directly (dark slots between
// live ones, as the game's pads and idle pulses sat). The loop arm breaks at
// the first black slot, so it draws the same lights through the carriers
// (point_light_carriers.ts), which pack the live ones first.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installPbrPointLightShaderPruning } from '../../src/render/pbr_fragment_shader';
import { attachPointLightCarriers } from '../../src/render/point_light_carriers';
import { markPointLightSource } from '../../src/render/point_light_carriers_core';
import { isSoftwareRendererName } from '../../src/render/software_renderer';

interface ChunkOverride {
  key: string;
  chunk: string;
}

type Kind = 'standard' | 'lambert' | 'phong' | 'toon';
type Lighting = 'direct' | 'carriers';

interface MintedProgram {
  cacheKey: string;
  type: string;
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
}

const KINDS: readonly Kind[] = ['standard', 'lambert', 'phong', 'toon'];
const POINT_LIGHT_COUNT = 10;
const LIVE_SLOTS = new Set([0, 3, 6, 9]);
const WIDTH = 128;
const HEIGHT = 32;
const PARITY_TOLERANCE = 1e-4;
const BREAK_FLOOR = 10 * PARITY_TOLERANCE;
const SPACING = 3.6;
const UNROLLED_KEY = 'point-light-loop-test:unrolled';
const SHADOW_ARM_OPEN =
  '\t#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0\n\t#pragma unroll_loop_start\n';
const LOOP_MARKER_LINE = '\t// WOC_POINT_LIGHT_LOOP';
const LOOP_HEAD_LINKED =
  'for ( int i = 0; i < 10; i ++ ) {\n\n\t\t#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )\n\t\tif ( pointLights[ i ].color == vec3( 0.0 ) ) break;\n\t\t#endif\n\t\tpointLight = pointLights[ i ];';

let renderer: THREE.WebGLRenderer;
let shaderErrors: string[] = [];
let unrolledChunk = '';

beforeAll(() => {
  expect(THREE.ShaderChunk.lights_fragment_begin).not.toContain('WOC_SKIP_ZERO_POINT_LIGHT');
  expect(installPbrPointLightShaderPruning()).toBe(true);
  const loopChunk = THREE.ShaderChunk.lights_fragment_begin;
  expect(loopChunk.split(SHADOW_ARM_OPEN)).toHaveLength(2);
  unrolledChunk = loopChunk.replace(SHADOW_ARM_OPEN, '\t#if 1\n\t#pragma unroll_loop_start\n');

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    shaderErrors.push(
      `${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertexShader)} ${gl.getShaderInfoLog(
        fragmentShader,
      )}`,
    );
  };
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const unmasked = String(
    dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  console.log(
    `[point_light_loop.browser] adapter: ${unmasked} (software: ${isSoftwareRendererName(unmasked)})`,
  );
});

afterAll(() => {
  renderer.dispose();
  renderer.forceContextLoss();
});

function material(kind: Kind, override: ChunkOverride | null): THREE.Material {
  const color = { standard: 0x9a8a70, lambert: 0x6f8f5a, phong: 0x5a6f9a, toon: 0xa06a6a }[kind];
  const made =
    kind === 'standard'
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 })
      : kind === 'lambert'
        ? new THREE.MeshLambertMaterial({ color })
        : kind === 'phong'
          ? new THREE.MeshPhongMaterial({ color, shininess: 40 })
          : new THREE.MeshToonMaterial({ color });
  if (override) {
    made.customProgramCacheKey = () => override.key;
    made.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        override.chunk,
      );
    };
  }
  return made;
}

function pointLights(live: boolean): THREE.PointLight[] {
  const colors = [0xff8844, 0x44aaff, 0xaaff66, 0xffffff];
  return Array.from({ length: POINT_LIGHT_COUNT }, (_, slot) => {
    if (!LIVE_SLOTS.has(slot)) return new THREE.PointLight(0xffffff, 0, 0, 2);
    const k = [...LIVE_SLOTS].indexOf(slot);
    const light = new THREE.PointLight(colors[k], live ? 6 : 0, k === 1 ? 2.2 : 9, 2);
    light.position.set((k - 1.5) * SPACING, 0.6 + (k % 2) * 0.8, 1.6);
    return light;
  });
}

function buildScene(
  override: ChunkOverride | null,
  liveLights: boolean,
  kinds: readonly Kind[] = KINDS,
  lighting: Lighting = 'direct',
): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x332211, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(2, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(256, 256);
  scene.add(sun);
  const sources = pointLights(liveLights);
  if (lighting === 'carriers') {
    attachPointLightCarriers(scene, POINT_LIGHT_COUNT, [() => sources]);
    for (const light of sources) markPointLightSource(light);
  }
  for (const light of sources) scene.add(light);
  kinds.forEach((kind, k) => {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.2, 24, 16), material(kind, override));
    sphere.position.set((k - 1.5) * SPACING, 0, 0);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    scene.add(sphere);
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), material('lambert', override));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  ground.receiveShadow = true;
  scene.add(ground);
  return scene;
}

function renderFloat(scene: THREE.Scene): Float32Array {
  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 0.1, 100);
  camera.position.set(0, 0.8, 6.8);
  camera.lookAt(0, 0, 0);
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    depthBuffer: true,
    type: THREE.FloatType,
  });
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  const out = new Float32Array(WIDTH * HEIGHT * 4);
  renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, out);
  renderer.setRenderTarget(null);
  target.dispose();
  return out;
}

function lightPrograms(): MintedProgram[] {
  return ((renderer.info.programs ?? []) as unknown as MintedProgram[]).filter((program) =>
    /^Mesh(?:Standard|Lambert|Phong|Toon)Material$/.test(program.type),
  );
}

/** The point lights three gathers for a default-layer camera, in slot order. */
function gatheredPointLights(scene: THREE.Scene): THREE.PointLight[] {
  const cameraLayers = new THREE.Layers();
  const out: THREE.PointLight[] = [];
  scene.traverseVisible((object) => {
    if ((object as THREE.PointLight).isPointLight && object.layers.test(cameraLayers)) {
      out.push(object as THREE.PointLight);
    }
  });
  return out;
}

function maxAbsDiff(a: Float32Array, b: Float32Array, column?: number): number {
  let max = 0;
  const band = WIDTH / KINDS.length;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (column !== undefined && Math.floor(x / band) !== column) continue;
      const i = (y * WIDTH + x) * 4;
      for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(a[i + c] - b[i + c]));
    }
  }
  return max;
}

describe('the point-light loop on a real WebGL2 driver', () => {
  it('links Standard, Lambert, Phong and Toon as one loop and, through the carriers, lights them like the unrolled form', () => {
    const carrierScene = buildScene(null, true, KINDS, 'carriers');
    expect(gatheredPointLights(carrierScene)).toHaveLength(POINT_LIGHT_COUNT);
    expect(
      gatheredPointLights(carrierScene).every((light) =>
        light.name.startsWith('point-light-carrier-'),
      ),
    ).toBe(true);
    const loopPixels = renderFloat(carrierScene);
    const unrolledPixels = renderFloat(
      buildScene({ key: UNROLLED_KEY, chunk: unrolledChunk }, true),
    );
    expect(shaderErrors).toEqual([]);
    expect(renderer.getContext().getError()).toBe(0);

    const gl = renderer.getContext();
    const programs = lightPrograms();
    expect(programs).toHaveLength(KINDS.length * 2);
    for (const program of programs) {
      const unrolled = program.cacheKey.includes(UNROLLED_KEY);
      const fragment = gl.getShaderSource(program.fragmentShader) ?? '';
      expect(gl.getProgramParameter(program.program, gl.LINK_STATUS), program.type).toBe(true);
      expect(fragment, program.type).toContain('#define USE_SHADOWMAP');
      expect(fragment, program.type).toContain('#if defined( USE_SHADOWMAP ) && 0 > 0\n');
      expect(fragment, program.type).toContain(`pointLights[ ${POINT_LIGHT_COUNT - 1} ]`);
      expect(fragment, program.type).toContain(LOOP_HEAD_LINKED);
      expect(fragment.includes('\t#if 1\n'), program.type).toBe(unrolled);
    }

    const darkPixels = renderFloat(buildScene(null, false, KINDS, 'carriers'));
    KINDS.forEach((kind, column) => {
      expect(
        maxAbsDiff(loopPixels, darkPixels, column),
        `${kind} is lit by points`,
      ).toBeGreaterThan(0.05);
    });
    expect(maxAbsDiff(loopPixels, unrolledPixels)).toBeLessThanOrEqual(PARITY_TOLERANCE);

    // The control: the same scattered lights gathered directly. The guarded
    // materials stop at the first dark slot and lose every later light.
    const scatteredPixels = renderFloat(buildScene(null, true));
    KINDS.forEach((kind, column) => {
      if (kind === 'toon') return;
      expect(
        maxAbsDiff(scatteredPixels, unrolledPixels, column),
        `${kind} breaks at the first dark slot`,
      ).toBeGreaterThan(BREAK_FLOOR);
    });
    expect(lightPrograms()).toHaveLength(KINDS.length * 2);
    expect(shaderErrors).toEqual([]);
  });

  it('selects the loop arm under a casting sun: poison in the unrolled arm links, in the loop arm it fails', () => {
    const loopChunk = THREE.ShaderChunk.lights_fragment_begin;
    expect(loopChunk.split(LOOP_MARKER_LINE)).toHaveLength(2);
    const unrolledPoisoned = loopChunk.replace(
      SHADOW_ARM_OPEN,
      SHADOW_ARM_OPEN.replace('\t#pragma', '\t#error woc-unrolled-arm-compiled\n\t#pragma'),
    );
    const loopPoisoned = loopChunk.replace(
      LOOP_MARKER_LINE,
      `\t#error woc-loop-arm-compiled\n${LOOP_MARKER_LINE}`,
    );
    expect(unrolledPoisoned).not.toBe(loopChunk);
    expect(loopPoisoned).not.toBe(loopChunk);

    shaderErrors = [];
    renderFloat(
      buildScene(
        { key: 'point-light-loop-test:unrolled-poisoned', chunk: unrolledPoisoned },
        true,
        ['standard'],
      ),
    );
    expect(shaderErrors).toEqual([]);

    renderFloat(
      buildScene({ key: 'point-light-loop-test:loop-poisoned', chunk: loopPoisoned }, true, [
        'standard',
      ]),
    );
    expect(shaderErrors.length).toBeGreaterThan(0);
    expect(shaderErrors.join('\n')).toContain('woc-loop-arm-compiled');
    shaderErrors = [];
  });
});
