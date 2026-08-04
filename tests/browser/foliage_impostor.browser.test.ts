// Real-WebGL regression for the far-field painter path: the pure suites
// (foliage_impostor_core, far_terrain_core, far_terrain_view) own the laws,
// but the #2793 review's coverage gap was exactly the half a fake cannot
// exercise: createImpostorSession().finalize() against a REAL renderer (new
// render targets, shader compilation, GL state restoration) and
// buildFarTerrain() streaming real geometry in Chromium. This suite runs
// both, end to end, and reads the baked atlas's PIXELS back.
//
// It lives under tests/browser/** and ends in .browser.test.ts, so a bare
// `vitest run` skips it; `npm run test:browser` (chromium) runs it. The
// `?gfx=high` force is the sanctioned tier override and holds even on
// SwiftShader, so the sprite arm engages in headless CI.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFarTerrain } from '../../src/render/far_terrain';
import type { FarVistaPlan } from '../../src/render/far_terrain_core';
import { createImpostorSession, impostorsActive } from '../../src/render/foliage_impostor';
import { initGfxTier } from '../../src/render/gfx';

let renderer: THREE.WebGLRenderer;

beforeEach(() => {
  history.replaceState(null, '', '?gfx=high');
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  initGfxTier(renderer);
});

afterEach(() => {
  renderer.dispose();
  history.replaceState(null, '', window.location.pathname);
});

function conePart() {
  const geometry = new THREE.ConeGeometry(1.6, 7, 8);
  geometry.translate(0, 3.5, 0);
  const material = new THREE.MeshStandardMaterial({ color: 0x2f6b2f });
  return [{ geometry, material: material as THREE.Material, isLeaf: false }];
}

function boxPart() {
  const geometry = new THREE.BoxGeometry(4, 5, 4);
  geometry.translate(0, 2.5, 0);
  const material = new THREE.MeshStandardMaterial({ color: 0x8a7f70 });
  return [{ geometry, material: material as THREE.Material, isLeaf: false }];
}

/** Sample the live atlas texture through a tiny RT and return RGBA bytes. */
function readAtlas(texture: THREE.Texture, size: number): Uint8Array {
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

describe('createImpostorSession in real Chromium WebGL', () => {
  it('finalizes a real bake: carved atlas pixels, correct meshes, restored GL state', () => {
    expect(impostorsActive()).toBe(true);
    const session = createImpostorSession();
    expect(session).not.toBeNull();
    if (!session) return;

    const pine = session.registerArchetype('tree', 'browser:pine', conePart());
    const snag = session.registerArchetype('tree', 'browser:snag', conePart(), 0);
    const house = session.registerArchetype('building', 'browser:house', boxPart());

    const trees = session.bucket('tree', 0, 0, 400);
    trees.add(pine, 10, 2, 20, 0.4, 1.5, 1, new THREE.Color(1, 1, 1));
    trees.add(snag, -30, 1, 40, 1.2, 2, 1, new THREE.Color(1, 1, 1));
    const town = session.bucket('building', 0, 0, 400);
    town.add(house, 60, 3, -80, 0, 1, 1, new THREE.Color(1, 1, 1));

    // sentinel GL state the bake MUST restore whatever happens inside
    renderer.setClearColor(0x123456, 0.25);
    renderer.autoClear = true;

    const parent = new THREE.Group();
    const regs = session.finalize(renderer, parent, 20061);

    // one merged InstancedMesh per category used
    expect(regs.map((r) => r.category).sort()).toEqual(['building', 'tree']);
    const treeReg = regs.find((r) => r.category === 'tree');
    const buildingReg = regs.find((r) => r.category === 'building');
    expect(treeReg?.mesh.count).toBe(2);
    expect(buildingReg?.mesh.count).toBe(1);
    expect(parent.children).toHaveLength(2);

    // per-archetype wind: the dead snag's instance carries HARD ZERO where
    // the living pine keeps its scale amplitude (the attribute is
    // windScale * windMul, in bucket-add order)
    const windAttr = treeReg?.mesh.geometry.getAttribute('aImpostorWind');
    expect(Array.from(windAttr?.array as Float32Array)).toEqual([1.5, 0]);

    // the baked atlas has INK (alpha near 1 inside sprites) AND CARVED
    // background (alpha 0): the historic OPAQUE-define blit regression
    // stamped the whole atlas alpha 1 and turned every sprite into a
    // rectangle
    const mat = treeReg?.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeTruthy();
    const pixels = readAtlas(mat.map as THREE.Texture, 128);
    let ink = 0;
    let carved = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 200) ink++;
      else if (pixels[i] < 30) carved++;
    }
    expect(ink).toBeGreaterThan(50);
    expect(carved).toBeGreaterThan(50);

    // GL state restored for the live frame loop
    const clear = new THREE.Color();
    renderer.getClearColor(clear);
    expect(clear.getHex()).toBe(0x123456);
    expect(renderer.getClearAlpha()).toBeCloseTo(0.25, 5);
    expect(renderer.autoClear).toBe(true);
    expect(renderer.getRenderTarget()).toBeNull();

    // and the sprite programs actually COMPILE and draw against the real GL
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    scene.add(parent);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.2, 4000);
    cam.position.set(0, 8, 400);
    cam.lookAt(10, 2, 20);
    renderer.render(scene, cam);
    expect(renderer.getContext().getError()).toBe(0);
  });
});

describe('buildFarTerrain in real Chromium', () => {
  // coarse spacing keeps the whole grid a quick build; the LAW under test
  // is streaming-to-ready and teardown, not sampling cost
  const plan: FarVistaPlan = { enabled: true, spacing: 96, envelopeFar: 3200, cameraFar: 3600 };

  it('streams every tile to readiness and draws them', async () => {
    const view = buildFarTerrain(20061, plan, { x: 0, z: 0 });
    const deadline = Date.now() + 15_000;
    while (view.builtTileCount() < view.plannedTileCount()) {
      if (Date.now() > deadline) throw new Error('far tiles never finished building');
      await new Promise((r) => setTimeout(r, 25));
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    scene.add(view.group);
    view.update(0, 0, 700, 3200, true);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.2, 4000);
    cam.position.set(0, 60, 0);
    cam.lookAt(500, 0, 500);
    renderer.render(scene, cam);
    expect(renderer.getContext().getError()).toBe(0);
    expect(renderer.info.render.triangles).toBeGreaterThan(0);
    view.dispose();
  });

  it('teardown mid-stream goes quiet without attaching further tiles', async () => {
    const view = buildFarTerrain(20061, plan, { x: 0, z: 0 });
    view.cancelStreaming();
    const frozen = view.builtTileCount();
    await new Promise((r) => setTimeout(r, 400));
    expect(view.builtTileCount()).toBe(frozen);
    view.dispose();
  });
});
