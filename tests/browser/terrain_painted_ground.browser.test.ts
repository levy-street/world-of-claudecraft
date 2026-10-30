// The built-in world's splat program, with the painted ground spliced in
// (src/render/terrain_painted_ground_core.ts: cover masks, town cobbles, the
// anti-repeat taps and the seven-lane height blend), LINKED on a real WebGL2
// context. The Node suite (tests/terrain_fragment_shader.test.ts) only reads
// the assembled text; a GLSL typo there passes every string pin and then
// fails the driver's link, which draws no terrain at all (three reports a
// failed link only under debug.checkShaderErrors, off in production). So the
// four shipped variants of the painted program link here: the no-relief and
// the full-relief ladder, each with and without the baked grass strokes.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gfxInternalsForTest } from '../../src/render/gfx';
import { setGrassGroundBake } from '../../src/render/grass_ground_bake';
import { terrainInternalsForTest } from '../../src/render/terrain';

interface MintedProgram {
  cacheKey: string;
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
}

let renderer: THREE.WebGLRenderer;
let restoreGfx: (() => void) | null = null;

beforeEach(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
});

afterEach(() => {
  restoreGfx?.();
  restoreGfx = null;
  setGrassGroundBake(null);
  renderer.dispose();
});

function terrainScene(material: THREE.Material): { scene: THREE.Scene; camera: THREE.Camera } {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8899aa, 50, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.castShadow = true;
  scene.add(sun, new THREE.HemisphereLight(0xbbddff, 0x445533, 0.6));
  const geometry = new THREE.PlaneGeometry(10, 10, 2, 2).rotateX(-Math.PI / 2);
  const n = geometry.attributes.position.count;
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.5), 3),
  );
  geometry.setAttribute(
    'aSplat',
    new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4),
  );
  geometry.setAttribute('aExtra', new THREE.Float32BufferAttribute(new Float32Array(n * 4), 4));
  geometry.setAttribute(
    'aTerrainPresenceMask',
    new THREE.Float32BufferAttribute(new Float32Array(n).fill(63), 1),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 8, 12);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

async function linkVariant(relief: number, bake: boolean): Promise<string> {
  restoreGfx = gfxInternalsForTest.overrideSettings({ terrainRelief: relief });
  setGrassGroundBake(
    bake ? { owner: renderer, texture: new THREE.Texture(), mean: [0.9, 0.9, 0.9] } : null,
  );
  const material = terrainInternalsForTest.createSplatMaterial();
  const { scene, camera } = terrainScene(material);
  const before = new Set(
    ((renderer.info.programs ?? []) as unknown as MintedProgram[]).map((p) => p.cacheKey),
  );
  await renderer.compileAsync(scene, camera);
  const gl = renderer.getContext();
  const linked = ((renderer.info.programs ?? []) as unknown as MintedProgram[]).filter(
    (p) => !before.has(p.cacheKey),
  );
  expect(linked.length).toBeGreaterThan(0);
  let painted = '';
  for (const program of linked) {
    expect(
      gl.getProgramParameter(program.program, gl.LINK_STATUS),
      `relief ${relief} bake ${bake}: ${gl.getProgramInfoLog(program.program)} fragment ${gl.getShaderInfoLog(
        program.fragmentShader,
      )}`,
    ).toBe(true);
    const fragment = gl.getShaderSource(program.fragmentShader) ?? '';
    if (fragment.includes('wocPaintedTap')) painted = fragment;
  }
  return painted;
}

describe('painted ground splat program (real WebGL2 link)', () => {
  for (const relief of [0, 3]) {
    for (const bake of [false, true]) {
      it(`links at terrain relief ${relief}, ${bake ? 'with' : 'without'} the grass bake`, async () => {
        const fragment = await linkVariant(relief, bake);
        // vacuity: the linked program really carries the painted ground
        expect(fragment).toContain('vec4 wocPaintedTap(');
        expect(fragment).toContain('uniform vec4 uCobbleTowns[');
        expect(fragment).toContain('wocHW2 = bs > 1e-5 ? b3 / bs : w3;');
        if (bake) expect(fragment).toContain('wocPGrass = wocPaintedTap(WOC_L_GRASS');
      });
    }
  }
});
