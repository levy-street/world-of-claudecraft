// Real-Chromium coverage for the in-place WebGL context restore (issue 3846).
// The pure suites (context_restore_core, environment_map_restore_core,
// grass_ground_bake, foliage_impostor_restore) own the sequencing laws; this
// suite proves the mechanism they exist for against REAL three r165 and a
// real lost-and-restored context: a render target the renderer only samples
// reads BLACK after the restore (three re-creates nothing for it), and the
// producer's re-bake into the SAME target brings the pixels back without any
// material rebinding.
//
// Lives under tests/browser/** and ends in .browser.test.ts, so a bare
// `vitest run` skips it; `npm run test:browser` (chromium) runs it. The
// `?gfx=high` force is the sanctioned tier override so the sprite arm engages
// on SwiftShader too.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createImpostorSession,
  impostorsActive,
  rebakeImpostorAtlas,
} from '../../src/render/foliage_impostor';
import { initGfxTier } from '../../src/render/gfx';
import {
  bakeGrassGroundTexture,
  rebakeGrassGroundTexture,
  setGrassGroundBake,
} from '../../src/render/grass_ground_bake';

let renderer: THREE.WebGLRenderer;

beforeEach(() => {
  history.replaceState(null, '', '?gfx=high');
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  initGfxTier(renderer);
});

afterEach(() => {
  setGrassGroundBake(null);
  renderer.dispose();
  renderer.domElement.remove();
  history.replaceState(null, '', window.location.pathname);
});

/** Lose and restore the renderer's context the way a driver reset does:
 *  in place, same canvas, same context object, three's own listeners doing
 *  their preventDefault and initGLContext before this resolves. */
async function loseAndRestoreContext(): Promise<void> {
  const canvas = renderer.domElement;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) throw new Error('WEBGL_lose_context is unavailable in this browser');
  const lost = new Promise<void>((resolve) => {
    canvas.addEventListener('webglcontextlost', () => resolve(), { once: true });
  });
  const restored = new Promise<void>((resolve) => {
    canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true });
  });
  ext.loseContext();
  await lost;
  // Chromium ignores restoreContext() while it is still dispatching the loss.
  await new Promise((resolve) => setTimeout(resolve, 0));
  ext.restoreContext();
  await restored;
  expect(gl.isContextLost()).toBe(false);
}

/** Sample a texture through a tiny fresh target and return RGBA bytes. A
 *  fresh target is minted per read so the read itself never re-binds the
 *  texture under test as a render target. */
function sampleTexture(texture: THREE.Texture, size: number): Uint8Array {
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false });
  const scene = new THREE.Scene();
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    blending: THREE.NoBlending,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  const out = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, out);
  renderer.setRenderTarget(prev);
  rt.dispose();
  mat.dispose();
  return out;
}

function litTexels(pixels: Uint8Array): number {
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 16) lit++;
  }
  return lit;
}

function conePart() {
  const geometry = new THREE.ConeGeometry(1.6, 7, 8);
  geometry.translate(0, 3.5, 0);
  const material = new THREE.MeshStandardMaterial({ color: 0x2f6b2f });
  return [{ geometry, material: material as THREE.Material, isLeaf: false }];
}

describe('in-place WebGL context restore in real Chromium', () => {
  it('the grass ground bake reads black after a restore and comes back through its re-bake into the same target', async () => {
    const bake = bakeGrassGroundTexture(renderer, 20061);
    setGrassGroundBake(bake);
    const texture = bake.texture;
    const before = litTexels(sampleTexture(texture, 32));
    // Greyscale strokes over a soil floor: the bake is never black.
    expect(before).toBeGreaterThan(200);

    await loseAndRestoreContext();

    // The bug: three re-allocates nothing for a target that is only sampled,
    // so the identical texture object now reads black.
    expect(litTexels(sampleTexture(texture, 32))).toBe(0);

    expect(rebakeGrassGroundTexture(renderer)).toBe(true);

    // The fix: same texture object (no material rebinding), pixels back.
    expect(bake.texture).toBe(texture);
    expect(litTexels(sampleTexture(texture, 32))).toBeGreaterThan(200);
  });

  it('the impostor atlas reads black after a restore and comes back through its re-bake into the live target', async () => {
    expect(impostorsActive()).toBe(true);
    const session = createImpostorSession();
    expect(session).not.toBeNull();
    if (!session) return;
    const pine = session.registerArchetype('tree', 'restore:pine', conePart());
    session.bucket('tree', 0, 0, 400).add(pine, 10, 2, 20, 0.4, 1.5, 1, new THREE.Color(1, 1, 1));
    const parent = new THREE.Group();
    const regs = session.finalize(renderer, parent, 20061);
    const material = regs[0]?.mesh.material as THREE.MeshStandardMaterial;
    const atlas = material.map as THREE.Texture;
    expect(atlas).toBeTruthy();
    expect(litTexels(sampleTexture(atlas, 64))).toBeGreaterThan(20);

    await loseAndRestoreContext();

    expect(litTexels(sampleTexture(atlas, 64))).toBe(0);

    expect(rebakeImpostorAtlas(renderer)).toBe(true);

    expect(material.map).toBe(atlas);
    expect(litTexels(sampleTexture(atlas, 64))).toBeGreaterThan(20);
  });
});
