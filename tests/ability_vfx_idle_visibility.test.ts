// Idle pooled VFX surfaces must not be submitted at all.
//
// Both immediate-mode pools (the ribbon strip mesh and the overlay point cloud)
// used to sit in the scene with `visible = true` forever and only shrink their
// draw range to zero when nothing was live. Three does NOT early-out on a zero
// draw count: the object is still in the render list, so every idle frame pays
// setProgram, a VAO bind and a zero-count draw, per pool and per renderer that
// owns one (ability_vfx/fx.ts builds a ribbon pool, sentence_vfx.ts builds a
// second). These pins hold the fix: hidden while empty, visible again on the
// first emit, and visible for the FIRST submit either way so the zero-count
// draw that links the program on a profile without the prewarm entry survives.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { OverlaySprites } from '../src/render/ability_vfx/overlay_sprites';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';

/** The pools only sample `.ribbon`, `.noise` and `.overlay`, so bare textures
 *  keep this a unit test (no canvas stub, no fx_textures build). */
function textures(): AbilityVfxTextures {
  return {
    ribbon: new THREE.Texture(),
    noise: new THREE.Texture(),
    overlay: new THREE.Texture(),
  } as unknown as AbilityVfxTextures;
}

/** Stand in for one render pass over the scene: three calls onAfterRender for
 *  every object it actually submitted. */
function renderPass(scene: THREE.Scene): void {
  for (const child of scene.children) {
    if (!child.visible) continue;
    child.onAfterRender(
      null as unknown as THREE.WebGLRenderer,
      scene,
      null as unknown as THREE.Camera,
      null as unknown as THREE.BufferGeometry,
      null as unknown as THREE.Material,
      null as unknown as THREE.Group,
    );
  }
}

function drawable(scene: THREE.Scene): THREE.Mesh | THREE.Points {
  const found = scene.children.find((child) => child.userData.renderCategory === 'vfx');
  expect(found).toBeDefined();
  return found as THREE.Mesh | THREE.Points;
}

describe('AbilityVfxRibbons idle visibility', () => {
  it('submits once, then leaves the scene while no ribbon is live', () => {
    const scene = new THREE.Scene();
    const ribbons = new AbilityVfxRibbons(scene, () => null, textures());
    const mesh = drawable(scene);

    // The first frame is deliberately submitted, zero-count, so the program
    // links even where the prewarm entry never ran.
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 0));
    expect(mesh.visible).toBe(true);
    renderPass(scene);
    expect(mesh.visible).toBe(false);

    // Every further idle frame stays out of the render list.
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 0));
    expect(mesh.visible).toBe(false);
  });

  it('comes back on the first emit and leaves again when the slash expires', () => {
    const scene = new THREE.Scene();
    const ribbons = new AbilityVfxRibbons(scene, () => null, textures());
    const mesh = drawable(scene);
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 0));
    renderPass(scene);
    expect(mesh.visible).toBe(false);

    ribbons.spawnSlash({ x: 0, y: 1, z: 0 }, 0x66ccff);
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 0));
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);

    // Past the arc's life the strip empties, and the mesh leaves the scene
    // without waiting for another render pass to notice.
    ribbons.update(1, new THREE.Vector3(0, 2, 0));
    expect(mesh.geometry.drawRange.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('clear() hides the pool too', () => {
    const scene = new THREE.Scene();
    const ribbons = new AbilityVfxRibbons(scene, () => null, textures());
    const mesh = drawable(scene);
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 0));
    renderPass(scene);
    ribbons.spawnSlash({ x: 0, y: 1, z: 0 }, 0x66ccff);
    ribbons.update(1 / 60, new THREE.Vector3(0, 2, 0));
    expect(mesh.visible).toBe(true);
    ribbons.clear();
    expect(mesh.visible).toBe(false);
  });
});

describe('OverlaySprites idle visibility', () => {
  it('submits once, then leaves the scene while no sprite is pushed', () => {
    const scene = new THREE.Scene();
    const overlay = new OverlaySprites(scene, textures());
    const points = drawable(scene);

    overlay.beginFrame();
    overlay.commit();
    expect(points.visible).toBe(true);
    renderPass(scene);
    expect(points.visible).toBe(false);

    overlay.beginFrame();
    overlay.commit();
    expect(points.visible).toBe(false);
  });

  it('comes back on the first push and leaves again on the next empty frame', () => {
    const scene = new THREE.Scene();
    const overlay = new OverlaySprites(scene, textures());
    const points = drawable(scene);
    overlay.beginFrame();
    overlay.commit();
    renderPass(scene);
    expect(points.visible).toBe(false);

    overlay.beginFrame();
    overlay.push(0, 1, 0, 0x66ccff, 0.4, 0, 1);
    overlay.commit();
    expect(points.visible).toBe(true);
    expect(points.geometry.drawRange.count).toBe(1);

    overlay.beginFrame();
    overlay.commit();
    expect(points.visible).toBe(false);
    expect(points.geometry.drawRange.count).toBe(0);
  });
});
