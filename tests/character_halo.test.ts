// @vitest-environment happy-dom
// The priest's Light halo: per-visual geometry (PR: halo must not clip the
// canon mage-model hat). Pins the halo.ts cache doctrine (geometry keyed by
// radius, material keyed by color, both shared and never disposed) and the
// manifest contract: only player_priest overrides the placement, so every
// other current and future halo user gets the default constants unchanged.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildHalo, HALO_RADIUS, HALO_UP_OFFSET } from '../src/render/characters/halo';
import { VISUALS } from '../src/render/characters/manifest';

function planeSize(mesh: THREE.Mesh): { width: number; height: number } {
  const geo = mesh.geometry as THREE.PlaneGeometry;
  return { width: geo.parameters.width, height: geo.parameters.height };
}

describe('class halo geometry', () => {
  it('defaults to the historical constants when no overrides are given', () => {
    expect(HALO_RADIUS).toBe(0.5);
    expect(HALO_UP_OFFSET).toBe(1.3);
    const mesh = buildHalo(0xffffff);
    expect(mesh.name).toBe('class_halo');
    expect(mesh.position.y).toBe(HALO_UP_OFFSET);
    expect(planeSize(mesh)).toEqual({ width: HALO_RADIUS * 2, height: HALO_RADIUS * 2 });
  });

  it('applies per-visual upOffset and radius overrides', () => {
    const mesh = buildHalo(0xffffff, 1.55, 0.8);
    expect(mesh.position.y).toBe(1.55);
    expect(planeSize(mesh)).toEqual({ width: 1.6, height: 1.6 });
  });

  it('caches geometry by radius and material by color, shared across builds', () => {
    const a = buildHalo(0xffffff, 1.0, 0.6);
    const b = buildHalo(0xff0000, 2.0, 0.6);
    const c = buildHalo(0xffffff, 1.0, 0.7);
    // same radius shares one geometry even across colors/offsets
    expect(a.geometry).toBe(b.geometry);
    // a different radius gets its own geometry
    expect(c.geometry).not.toBe(a.geometry);
    // same color shares one material even across radii
    expect(a.material).toBe(c.material);
    expect(a.material).not.toBe(b.material);
    // default-radius builds keep sharing too (the pre-override singleton path)
    expect(buildHalo(0x123456).geometry).toBe(buildHalo(0x654321).geometry);
  });

  it('wires the manifest overrides through CharacterVisual to the halo mesh', async () => {
    // Full-construction check on the real code path (visual.ts must pass the
    // def overrides into buildHalo; dropping an argument there leaves every
    // buildHalo-only test green). Mocked loader serves a minimal rig with a
    // head bone for every URL, so the priest def resolves without assets.
    vi.resetModules();
    const stubGltf = () => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
      mesh.name = 'body';
      scene.add(mesh);
      const head = new THREE.Group();
      head.name = 'head';
      scene.add(head);
      return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
    };
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));
    const { charactersReady } = await import('../src/render/characters/assets');
    await charactersReady();
    const { CharacterVisual } = await import('../src/render/characters/visual');
    const visual = new CharacterVisual('player_priest', 0xffffff, 0);
    const halo = visual.root.getObjectByName('class_halo') as THREE.Mesh;
    expect(halo).toBeDefined();
    expect(halo.position.y).toBe(1.45);
    // no radius override: the priest rides the shared default-size geometry
    expect((halo.geometry as THREE.PlaneGeometry).parameters.width).toBeCloseTo(1.0);
    // the caster sweeps must not overwrite buildHalo's castShadow = false
    expect(halo.castShadow).toBe(false);

    // the rebuildCasters arm has the same two obligations: after a model-graph
    // change re-lists the casters with shadows on, the halo stays out of the
    // caster list, and its material stays in the ghost-restore snapshot
    const originalMat = halo.material;
    type MaterialPassPeek = { applyVisualMaterials(): void };
    const materialPass = vi.spyOn(visual as unknown as MaterialPassPeek, 'applyVisualMaterials');
    visual.setGhost(false);
    visual.setGhost(false);
    expect(materialPass).not.toHaveBeenCalled();
    visual.setGhost(true);
    visual.setGhost(true);
    visual.setGhost(false);
    visual.setGhost(false);
    expect(materialPass).toHaveBeenCalledTimes(2);
    expect(halo.material).toBe(originalMat);
    materialPass.mockRestore();

    visual.setShadow(true);
    expect(halo.castShadow).toBe(false);
    visual.setWeapon('bogoak_staff');
    expect(halo.castShadow).toBe(false);
    visual.setShadow(false);
    visual.setShadow(true);
    expect(halo.castShadow).toBe(false);
    visual.setGhost(true);
    expect(halo.material).not.toBe(originalMat);
    visual.setGhost(false);
    expect(halo.material).toBe(originalMat);

    // a swap DURING an active overlay must not capture the overlay clone as
    // the halo's "original" (Shadowform is the priest's everyday overlay:
    // equip something while shadowformed, then drop the form)
    visual.setShadowform(true);
    expect(halo.material).not.toBe(originalMat);
    visual.setWeapon('cinderglass_wand');
    visual.setShadowform(false);
    expect(halo.material).toBe(originalMat);
    // same via the body-skin swap path, mid-ghost
    visual.setGhost(true);
    visual.setSkin(1);
    visual.setGhost(false);
    expect(halo.material).toBe(originalMat);

    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });

  it('gives the priest hat clearance and leaves every other visual on defaults', () => {
    const priest = VISUALS.player_priest;
    expect(priest.halo).toBe(0xffd766);
    // Screenshot-tuned against the mage.glb hat cone; see the manifest comment.
    // Raise-only: the default-size ring clears the cone at tip height, and
    // staying below the hat's bounding-box top keeps portrait framing
    // untouched for priests.
    expect(priest.haloUpOffset).toBe(1.45);
    expect(priest.haloRadius).toBeUndefined();
    for (const [key, def] of Object.entries(VISUALS)) {
      if (key === 'player_priest') continue;
      // placement overrides are meaningless without a halo; a future second
      // haloed visual may legitimately set all three
      if (def.halo === undefined) {
        expect(def.haloUpOffset, key).toBeUndefined();
        expect(def.haloRadius, key).toBeUndefined();
      }
    }
  });
});
