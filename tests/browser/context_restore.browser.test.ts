// Real Chromium coverage for an in-place WebGL context loss and restore
// (src/render/context_restore.ts): a real WEBGL_lose_context loss and restore
// against a real three renderer. The render targets a restore gives back
// EMPTY (the prefiltered environment map, the grass ground bake, the foliage
// impostor atlas) are drawn again, read back by pixel; and the visible scene
// links under the restore hold, so the first frame drawn after it links
// nothing.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackgroundGpuQueue } from '../../src/render/background_gpu_queue';
import { type CompileArmHost, linkColorPrograms } from '../../src/render/compile_arms';
import { ContextRestoreHost, type ContextRestoreSurface } from '../../src/render/context_restore';
import {
  contextRestoreDrawHeld,
  onContextRestoreHoldChange,
} from '../../src/render/context_restore_hold';
import { createImpostorSession } from '../../src/render/foliage_impostor';
import { initGfxTier } from '../../src/render/gfx';
import { bakeGrassGroundTexture, setGrassGroundBake } from '../../src/render/grass_ground_bake';

let renderer: THREE.WebGLRenderer;
let host: ContextRestoreHost | null = null;
let links = 0;
const originalLink = WebGL2RenderingContext.prototype.linkProgram;

beforeEach(() => {
  history.replaceState(null, '', '?gfx=high');
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(64, 64, false);
  initGfxTier(renderer);
  links = 0;
  WebGL2RenderingContext.prototype.linkProgram = function (program) {
    links++;
    return originalLink.call(this, program);
  };
});

afterEach(() => {
  WebGL2RenderingContext.prototype.linkProgram = originalLink;
  host?.dispose();
  host = null;
  setGrassGroundBake(null);
  renderer.forceContextLoss();
  renderer.dispose();
  renderer.domElement.remove();
  history.replaceState(null, '', window.location.pathname);
});

/** Sum of the RGB channels over a render target's corner (0: empty). */
function targetSum(target: THREE.WebGLRenderTarget, halfFloat = false): number {
  const w = Math.min(16, target.width);
  const h = Math.min(16, target.height);
  const buffer = halfFloat ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(target, 0, 0, w, h, buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 4) sum += buffer[i] + buffer[i + 1] + buffer[i + 2];
  return sum;
}

function brightEquirect(): THREE.DataTexture {
  const w = 64;
  const h = 32;
  const data = new Uint8Array(w * h * 4).fill(200);
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return texture;
}

function arms(scene: THREE.Scene, camera: THREE.Camera): CompileArmHost {
  return {
    webgl: () => renderer,
    camera: () => camera,
    scene: () => scene,
    shadowCamera: () => camera,
    offscreen: () => false,
    offscreenTarget: () => new THREE.WebGLRenderTarget(8, 8),
    depthMaterials: () => new Map(),
    shadowArm: () => false,
  };
}

function attachHost(overrides: Partial<ContextRestoreSurface>): void {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const armHost = arms(scene, camera);
  host = new ContextRestoreHost({
    webgl: () => renderer,
    queue: createBackgroundGpuQueue(),
    isShutdown: () => false,
    rebindContextReaders: () => {},
    scene: () => scene,
    player: () => ({ x: 0, z: 0 }),
    arms: null,
    compileColor: (root) => linkColorPrograms(armHost, root, false),
    compileShadow: async () => {},
    tail: () => ({ settle: async () => ({}), touch: async () => 0, timeoutMs: 1 }),
    textureInFlight: new WeakMap(),
    compileBatchRoots: 4,
    zoneProgramRecords: () => [],
    prewarmZone: async () => {},
    presentationPrewarm: () => false,
    castVfxUnits: () => [],
    selfSpirit: () => ({ observe: () => {} }),
    environment: () => null,
    ...overrides,
  } as ContextRestoreSurface);
}

/** Lose the context, give it back, and wait for the restore hold to end. */
async function loseAndRestore(atRelease?: () => void): Promise<void> {
  // Called synchronously on the hold's release: before the debt resume runs,
  // so what it sees is what the hold itself prepared.
  const unsubscribe = atRelease
    ? onContextRestoreHoldChange((held) => {
        if (!held) atRelease();
      })
    : () => {};
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_lose_context');
  expect(ext).not.toBeNull();
  const lost = new Promise((resolve) =>
    renderer.domElement.addEventListener('webglcontextlost', resolve, { once: true }),
  );
  ext?.loseContext();
  await lost;
  // Chromium ignores restoreContext() while it is still dispatching the loss.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const restored = new Promise((resolve) =>
    renderer.domElement.addEventListener('webglcontextrestored', resolve, { once: true }),
  );
  ext?.restoreContext();
  await restored;
  const deadline = performance.now() + 5000;
  while (contextRestoreDrawHeld() && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(contextRestoreDrawHeld()).toBe(false);
  unsubscribe();
  // Let the queued re-bakes and debt settle.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe('an in-place WebGL context restore in a real browser', () => {
  it('draws the prefiltered environment map again into its own target', async () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const source = brightEquirect();
    const target = pmrem.fromEquirectangular(source);
    expect(targetSum(target, true)).toBeGreaterThan(0);
    attachHost({
      environment: () => ({
        targets: new Map([['vale', target]]),
        source: () => source,
        pmrem: () => pmrem,
        drop: () => {},
        dome: () => new THREE.Object3D(),
      }),
    });
    await loseAndRestore();
    expect(targetSum(target, true)).toBeGreaterThan(0);
  });

  it('proves the class is real: without the re-bake the same target comes back empty', async () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(brightEquirect());
    expect(targetSum(target, true)).toBeGreaterThan(0);
    attachHost({});
    await loseAndRestore();
    expect(targetSum(target, true)).toBe(0);
  });

  it('bakes the grass ground texture again', async () => {
    const bake = bakeGrassGroundTexture(renderer, 7);
    setGrassGroundBake(bake);
    const target = bake.texture.renderTarget as THREE.WebGLRenderTarget;
    const before = targetSum(target);
    expect(before).toBeGreaterThan(0);
    attachHost({});
    await loseAndRestore();
    expect(targetSum(target)).toBe(before);
  });

  it('bakes the foliage impostor atlas again', async () => {
    const created = createImpostorSession();
    expect(created).not.toBeNull();
    if (!created) return;
    const session = created;
    const geometry = new THREE.ConeGeometry(1.6, 7, 8);
    geometry.translate(0, 3.5, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0x2f6b2f });
    const archetype = session.registerArchetype('tree', 'cone', [
      { geometry, material, isLeaf: false },
    ]);
    session.bucket('tree', 0, 0, 50).add(archetype, 0, 0, 0, 0, 1, 1, new THREE.Color(1, 1, 1));
    const registrations = session.finalize(renderer, new THREE.Group(), 1);
    expect(registrations.length).toBeGreaterThan(0);
    const mesh = registrations[0].mesh as THREE.Mesh;
    const atlas = (mesh.material as THREE.MeshStandardMaterial).map as THREE.Texture;
    const target = atlas.renderTarget as THREE.WebGLRenderTarget;
    expect(target).toBeDefined();
    const alpha = (): number => {
      const buffer = new Uint8Array(target.width * target.height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, buffer);
      let sum = 0;
      for (let i = 3; i < buffer.length; i += 4) sum += buffer[i];
      return sum;
    };
    const before = alpha();
    expect(before).toBeGreaterThan(0);
    attachHost({});
    await loseAndRestore();
    expect(alpha()).toBe(before);
  });

  function litCubes(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x203040);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50);
    camera.position.set(0, 0, 4);
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    [0xff0000, 0x00ff00, 0x0000ff].forEach((color, index) => {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        // Three distinct programs: sidedness and flat shading are key inputs.
        new THREE.MeshStandardMaterial({
          color,
          side: index === 1 ? THREE.DoubleSide : THREE.FrontSide,
          flatShading: index === 2,
        }),
      );
      cube.position.x = index - 1;
      scene.add(cube);
    });
    return { scene, camera };
  }

  function centrePixel(): number[] {
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
  }

  it('links the visible scene under the hold, so the first frame after it links nothing', async () => {
    const { scene, camera } = litCubes();
    const initial = links;
    renderer.render(scene, camera);
    // Positive control: this scene does link programs on a cold context.
    expect(links - initial).toBeGreaterThan(0);
    const armHost = arms(scene, camera);
    attachHost({
      scene: () => scene,
      compileColor: (root) => linkColorPrograms(armHost, root, false),
    });
    let firstFrameLinks = -1;
    await loseAndRestore(() => {
      const before = links;
      renderer.render(scene, camera);
      firstFrameLinks = links - before;
    });
    expect(firstFrameLinks).toBe(0);
    renderer.render(scene, camera);
    // The centre cube (green) is drawn, not the background.
    const [r, g, b] = centrePixel();
    expect(g).toBeGreaterThan(r + 40);
    expect(g).toBeGreaterThan(b + 40);
  });

  it('without the restore host linking the scene, the same first frame links its programs again', async () => {
    const { scene, camera } = litCubes();
    renderer.render(scene, camera);
    attachHost({ scene: () => new THREE.Scene() });
    let firstFrameLinks = -1;
    await loseAndRestore(() => {
      const before = links;
      renderer.render(scene, camera);
      firstFrameLinks = links - before;
    });
    expect(firstFrameLinks).toBeGreaterThan(0);
  });
});
