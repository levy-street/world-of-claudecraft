// Real-WebGL pin for the cel-shading R&D light ramp (cel_shading_core.ts). The
// Node suite pins the chunk TEXT; only a real driver can say the patched
// directional loop preprocesses, compiles and links under every lit material
// kind with a casting sun (USE_SHADOWMAP defined), and that it bands the light:
// in the stock chunk a face at NL 0.9 and one at NL 0.5 differ, under the ramp
// they read the same lit level, and a face past the terminator gets no sun.

import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { CEL_SHADING_DEFAULTS } from '../../src/render/cel_shading_core';
import { OutputGradePass } from '../../src/render/post_output_grade';

type Kind = 'standard' | 'lambert' | 'phong' | 'toon';
const KINDS: readonly Kind[] = ['standard', 'lambert', 'phong', 'toon'];
// Read BEFORE cel_shading.ts loads. Since the genshin overhaul (8bff2cec638)
// the look is on by default (`?cel=off` opts out), and the module installs the
// ramp at import, so a static import would hand this file a patched "stock"
// chunk. Nothing imported above patches either chunk.
const STOCK_CHUNK = THREE.ShaderChunk.lights_fragment_begin;
const STOCK_OPAQUE = THREE.ShaderChunk.opaque_fragment;
const { installCelShading, syncCelMaterialInk } = await import('../../src/render/cel_shading');
const DEFAULT_INSTALL_CHUNK = THREE.ShaderChunk.lights_fragment_begin;
const SIZE = 8;

afterAll(() => {
  THREE.ShaderChunk.lights_fragment_begin = STOCK_CHUNK;
  THREE.ShaderChunk.opaque_fragment = STOCK_OPAQUE;
});

function makeRenderer(errors: string[]): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    errors.push(
      `${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`,
    );
  };
  return renderer;
}

function material(kind: Kind): THREE.Material {
  if (kind === 'standard') return new THREE.MeshStandardMaterial({ roughness: 0.6 });
  if (kind === 'phong') return new THREE.MeshPhongMaterial({ shininess: 20 });
  if (kind === 'toon') return new THREE.MeshToonMaterial();
  return new THREE.MeshLambertMaterial();
}

/** Linear red of a white Lambert quad facing the camera, lit by a white sun at
 *  intensity PI (so stock lambert reads exactly NL), with no fill light. */
function lambertLevel(renderer: THREE.WebGLRenderer, nl: number): number {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
  // The quad's normal is +Z; tilt the sun off it so dot(N, L) = nl.
  sun.position.set(Math.sqrt(1 - nl * nl), 0, nl).multiplyScalar(10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(64, 64);
  scene.add(sun);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshLambertMaterial());
  quad.receiveShadow = true;
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 5;
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(4);
  renderer.readRenderTargetPixels(target, SIZE / 2, SIZE / 2, 1, 1, px);
  renderer.setRenderTarget(null);
  target.dispose();
  return px[0];
}

function compileAll(renderer: THREE.WebGLRenderer): void {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x332211, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(2, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(64, 64);
  scene.add(sun);
  const point = new THREE.PointLight(0xff8844, 4, 6, 2);
  point.position.set(0, 1, 2);
  scene.add(point);
  KINDS.forEach((kind, i) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), material(kind));
    mesh.position.x = (i - 1.5) * 0.9;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
  camera.position.set(0, 0, 4);
  renderer.render(scene, camera);
}

describe('cel light ramp on a real WebGL context', () => {
  it('installs the ramp by default on a page with no cel flag', () => {
    expect(DEFAULT_INSTALL_CHUNK).not.toBe(STOCK_CHUNK);
  });

  it('bands the sun where the stock chunk falls off with NL', () => {
    // Measure the stock look on the stock chunk, then install the ramp anew.
    THREE.ShaderChunk.lights_fragment_begin = STOCK_CHUNK;
    const stockErrors: string[] = [];
    const stock = makeRenderer(stockErrors);
    const stockHigh = lambertLevel(stock, 0.9);
    const stockMid = lambertLevel(stock, 0.5);
    stock.dispose();
    expect(stockErrors).toEqual([]);
    expect(stockHigh).toBeCloseTo(0.9, 2);
    expect(stockMid).toBeCloseTo(0.5, 2);

    expect(installCelShading(CEL_SHADING_DEFAULTS)).toBe(true);
    const celErrors: string[] = [];
    const cel = makeRenderer(celErrors);
    const celHigh = lambertLevel(cel, 0.9);
    const celMid = lambertLevel(cel, 0.5);
    const celGrazing = lambertLevel(cel, 0.05);
    compileAll(cel);
    cel.dispose();
    expect(celErrors).toEqual([]);
    expect(celHigh).toBeCloseTo(CEL_SHADING_DEFAULTS.lit, 2);
    expect(celMid).toBeCloseTo(CEL_SHADING_DEFAULTS.lit, 2);
    expect(celGrazing).toBeCloseTo(0, 3);
  });
});

describe('cel outlines compile on a real WebGL context', () => {
  it('material ink (Low, iPhone) links under every lit material kind', () => {
    expect(syncCelMaterialInk(true, CEL_SHADING_DEFAULTS)).toBe(true);
    const errors: string[] = [];
    const renderer = makeRenderer(errors);
    compileAll(renderer);
    renderer.dispose();
    expect(syncCelMaterialInk(false, CEL_SHADING_DEFAULTS)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('the grade ink arm (Medium and up) links and reads a depth texture', () => {
    const errors: string[] = [];
    const renderer = makeRenderer(errors);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
    camera.position.set(0, 0, 3);
    const read = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(SIZE, SIZE),
    });
    const write = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType });
    renderer.setRenderTarget(read);
    renderer.render(scene, camera);
    const grade = new OutputGradePass({ value: 0 }, null, {
      celInk: { depthTarget: () => read, camera, ink: 0.85, saturation: 1.12, inkWidth: 1 },
    });
    grade.render(renderer, write, read);
    grade.dispose();
    read.dispose();
    write.dispose();
    renderer.dispose();
    expect(errors).toEqual([]);
  });
});
