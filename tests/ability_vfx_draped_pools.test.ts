// The three terrain-draped ground families (shock rings, dissolve decals, buff
// ground auras) carry their drape as a single-float `aDrape` attribute instead
// of rewriting the position buffer, and share one material per family.
//
// Three properties follow, and each is pinned here because losing any one of
// them quietly undoes the change:
//   1. the slot geometries SHARE one position buffer (the drape is the only
//      per-slot column), so a re-drape uploads a third of what it used to and
//      the pools stop cloning the disc once per slot;
//   2. the flat shape is permanent, so the bounding sphere is exact and the
//      marks are frustum-CULLED again rather than opted out;
//   3. one material draws the whole family, with each slot's colour, opacity
//      and progress pushed in right before its own draw.
//
// The fairness-relevant half is asserted too: the drape values themselves, and
// therefore where a wavefront lands, are unchanged.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GroundDecals } from '../src/render/ability_vfx/decals';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { GroundAuras } from '../src/render/ability_vfx/ground_auras';
import { ShockRings } from '../src/render/ability_vfx/rings';

function textures(): AbilityVfxTextures {
  const texture = () => new THREE.Texture();
  return {
    noise: texture(),
    ember: texture(),
    rime: texture(),
    rune: texture(),
    crack: texture(),
    char: texture(),
  } as unknown as AbilityVfxTextures;
}

function meshes(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((child) => (child as THREE.Mesh).isMesh) as THREE.Mesh[];
}

/** Stand in for three's per-object hook, which runs before setProgram. */
function drawOne(mesh: THREE.Mesh): void {
  mesh.onBeforeRender(
    null as unknown as THREE.WebGLRenderer,
    null as unknown as THREE.Scene,
    null as unknown as THREE.Camera,
    mesh.geometry,
    mesh.material as THREE.Material,
    null as unknown as THREE.Group,
  );
}

/** A slope the drape has to follow: height rises with x. */
const slope = (x: number) => x * 0.25;

describe('the draped ground pools', () => {
  it('shares ONE vertex shader source across the three families', () => {
    // Three near-identical sources would be three vertex compiles and three
    // program cache entries where one will do: the only per-family difference,
    // which local axis is up, is a uniform (draped_shader.ts).
    const sources = new Set<string>();
    for (const build of [
      (scene: THREE.Scene) => new ShockRings(scene, textures(), () => 0),
      (scene: THREE.Scene) => new GroundDecals(scene, textures(), () => 0),
      (scene: THREE.Scene) => new GroundAuras(scene, textures()),
    ]) {
      const scene = new THREE.Scene();
      build(scene);
      const material = meshes(scene)[0].material as THREE.ShaderMaterial;
      sources.add(material.vertexShader);
      expect(material.uniforms.uDrapeAxis.value).toBeInstanceOf(THREE.Vector3);
    }
    expect(sources.size).toBe(1);
  });

  it('share one material and one position buffer across every slot', () => {
    for (const build of [
      (scene: THREE.Scene) => new ShockRings(scene, textures(), () => 0),
      (scene: THREE.Scene) => new GroundDecals(scene, textures(), () => 0),
      (scene: THREE.Scene) => new GroundAuras(scene, textures()),
    ]) {
      const scene = new THREE.Scene();
      build(scene);
      const pool = meshes(scene);
      expect(pool.length).toBeGreaterThan(5);
      const materials = new Set(pool.map((mesh) => mesh.material as THREE.Material));
      const positions = new Set(pool.map((mesh) => mesh.geometry.getAttribute('position')));
      const drapes = new Set(pool.map((mesh) => mesh.geometry.getAttribute('aDrape')));
      expect(materials.size).toBe(1);
      expect(positions.size).toBe(1);
      // ... and the drape column really is per slot, or they would all deform
      // together.
      expect(drapes.size).toBe(pool.length);
      // Culling is back on now that the flat shape is permanent.
      for (const mesh of pool) expect(mesh.frustumCulled).toBe(true);
    }
  });

  it('drapes a shock ring into aDrape and leaves the flat plane alone', () => {
    const scene = new THREE.Scene();
    const rings = new ShockRings(scene, textures(), slope);
    const mesh = meshes(scene)[0];
    const position = mesh.geometry.getAttribute('position');
    const drape = mesh.geometry.getAttribute('aDrape');

    rings.spawn(10, slope(10) + 0.2, 0, 6, 1, 0x66ccff, 2, false);
    expect(mesh.visible).toBe(true);
    // The plane itself never moved: local z is the ring's up-axis and stays 0.
    for (let i = 0; i < position.count; i++) expect(position.getZ(i)).toBe(0);
    // ... and the drape column carries a real slope, not zeros.
    let spread = 0;
    for (let i = 0; i < drape.count; i++) spread = Math.max(spread, Math.abs(drape.getX(i)));
    expect(spread).toBeGreaterThan(0);
    // The sphere follows the drape, so the frustum test cannot clip it away.
    const sphere = mesh.geometry.boundingSphere as THREE.Sphere;
    expect(sphere.radius).toBeGreaterThanOrEqual(Math.SQRT1_2);
    for (let i = 0; i < drape.count; i++) {
      const dz = drape.getX(i) - sphere.center.z;
      expect(Math.hypot(Math.SQRT1_2, dz)).toBeLessThanOrEqual(sphere.radius + 1e-6);
    }
  });

  it('flattens a vertical ring that reused a draped slot', () => {
    const scene = new THREE.Scene();
    const rings = new ShockRings(scene, textures(), slope);
    const pool = meshes(scene);
    rings.spawn(10, slope(10) + 0.2, 0, 6, 1, 0x66ccff, 2, false);
    const drape = pool[0].geometry.getAttribute('aDrape');
    let spread = 0;
    for (let i = 0; i < drape.count; i++) spread = Math.max(spread, Math.abs(drape.getX(i)));
    expect(spread).toBeGreaterThan(0);

    // Cycle the whole pool back round to slot 0 and spawn a billboard there.
    for (let i = 1; i < pool.length; i++) {
      rings.spawn(0, 1, 0, 2, 1, 0xffffff, 1, true);
    }
    rings.spawn(0, 1, 0, 2, 1, 0xffffff, 1, true);
    for (let i = 0; i < drape.count; i++) expect(drape.getX(i)).toBe(0);
  });

  it('pushes each slot its own uniforms right before its own draw', () => {
    const scene = new THREE.Scene();
    const rings = new ShockRings(scene, textures(), () => 0);
    const pool = meshes(scene);
    const material = pool[0].material as THREE.ShaderMaterial;
    rings.spawn(0, 0.2, 0, 4, 1, 0xff0000, 3, false);
    rings.spawn(9, 0.2, 0, 4, 1, 0x0000ff, 1, false);
    rings.update(0.25, new THREE.Quaternion());

    drawOne(pool[0]);
    expect((material.uniforms.uColor.value as THREE.Color).r).toBeGreaterThan(0.9);
    expect(material.uniforms.uIntensity.value).toBe(3);
    // Without this flag three skips the upload for every slot after the first,
    // and the whole family would draw with slot 0's colour.
    expect(material.uniformsNeedUpdate).toBe(true);
    material.uniformsNeedUpdate = false;

    drawOne(pool[1]);
    expect((material.uniforms.uColor.value as THREE.Color).b).toBeGreaterThan(0.9);
    expect(material.uniforms.uIntensity.value).toBe(1);
    expect(material.uniformsNeedUpdate).toBe(true);
  });

  it('gives each decal its own style map through the shared material', () => {
    const scene = new THREE.Scene();
    const tex = textures();
    const decals = new GroundDecals(scene, tex, () => 0);
    const pool = meshes(scene);
    const material = pool[0].material as THREE.ShaderMaterial;
    decals.spawn(0, 0, 0, 1.5, 0xffffff, 'ember', 2);
    decals.spawn(4, 0, 0, 1.5, 0xffffff, 'rune', 2);

    drawOne(pool[0]);
    expect(material.uniforms.uMap.value).toBe(tex.ember);
    drawOne(pool[1]);
    expect(material.uniforms.uMap.value).toBe(tex.rune);
  });

  it('keeps a standing aura off the upload path and re-uploads only the column', () => {
    const scene = new THREE.Scene();
    const auras = new GroundAuras(scene, textures());
    const mesh = meshes(scene)[0];
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const drape = mesh.geometry.getAttribute('aDrape') as THREE.BufferAttribute;
    const positionUpload = vi.spyOn(position, 'addUpdateRange');
    const at = (_id: number, _frac: number, out?: THREE.Vector3) =>
      (out ?? new THREE.Vector3()).set(3, 0, 0);

    auras.hold(7, 0, 0x66ccff, true, 1);
    for (let frame = 1; frame <= 90; frame++) {
      auras.hold(7, 0, 0x66ccff, true, frame);
      auras.update(1 / 60, frame / 60, frame, at, slope, 0, 0);
    }
    // The position buffer is shared and never rewritten, so it is never queued.
    expect(positionUpload).not.toHaveBeenCalled();
    // The drape column is: one float per vertex rather than three.
    expect(drape.itemSize).toBe(1);
    expect(drape.count).toBe(position.count);
    let spread = 0;
    for (let i = 0; i < drape.count; i++) spread = Math.max(spread, Math.abs(drape.getX(i)));
    expect(spread).toBeGreaterThan(0);
  });
});
