import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyMaterials, tintedMaterial } from '../src/render/characters/assets';
import type { VisualDef } from '../src/render/characters/manifest';
import { gfxInternalsForTest } from '../src/render/gfx';
import { createWeaponVfx, type WeaponVfxSpec } from '../src/render/weapon_vfx';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(() => new Promise(() => undefined)),
  loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
  loadTexture: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

describe('tinted character materials', () => {
  it('returns a colorless shader material as-is and continues the material traversal', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const shader = new THREE.ShaderMaterial();
      expect((shader as THREE.ShaderMaterial & { color?: THREE.Color }).color).toBeUndefined();
      const colored = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const shaderMesh = new THREE.Mesh(new THREE.BufferGeometry(), shader);
      const coloredMesh = new THREE.Mesh(new THREE.BufferGeometry(), colored);
      const root = new THREE.Group();
      root.add(shaderMesh, coloredMesh);

      // tintStrength is pinned in the def so the 0.4 handed to tintedMaterial
      // below is coupled locally, not to DEFAULT_TINT_STRENGTH in assets.ts.
      const def = { tint: 0x336699, tintStrength: 0.4 } as VisualDef;
      expect(() => applyMaterials(root, def, 0xffffff)).not.toThrow();

      // The colorless source comes back unchanged: no clone (a clone detaches
      // live uniform handles) and no cache entry (repeat calls keep returning
      // the source itself, never a stored copy).
      expect(shaderMesh.material).toBe(shader);
      expect(tintedMaterial(shader, 0x336699, 0.4)).toBe(shader);
      expect(tintedMaterial(shader, 0x336699, 0.4)).toBe(shader);
      // The colored sibling still takes the shared tinted clone.
      expect(coloredMesh.material).not.toBe(colored);
      expect((coloredMesh.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(
        0xffffff,
      );
    } finally {
      restoreGfx();
    }
  });

  it('leaves a weapon-skin fresnel shell material untouched through a full pass', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const weapon = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      weapon.userData.weaponMesh = true;
      const root = new THREE.Group();
      root.add(weapon);
      const spec: WeaponVfxSpec = {
        tier: 'epic',
        name: 'test blade',
        type: 'sword',
        lore: '',
        fx: [],
      };
      const handle = createWeaponVfx(weapon, spec, { grounded: false });
      const shell = weapon.children.find((o) => o.userData.__vfx) as THREE.Mesh;
      expect(shell).toBeTruthy();
      expect(shell.userData.weaponVfxMesh).toBe(true);
      const shellMat = shell.material as THREE.ShaderMaterial;

      applyMaterials(root, { tint: 0x336699, tintStrength: 0.4 } as VisualDef, 0xffffff);

      // The sweep must not re-own the shell: the rig's per-frame uniform
      // writes go to this exact material instance, and a clone would render
      // frozen while the original absorbs every uTime/uStr write.
      expect(shell.material).toBe(shellMat);
      handle.update(0.25);
      expect(shellMat.uniforms.uTime.value).toBe(0.25);
      handle.dispose();
    } finally {
      restoreGfx();
    }
  });

  it('keeps a tagged fresnel shell out of the shadow-caster rebuild after an offhand swap', async () => {
    // Full-construction pin on the real rebuildCasters sweep (visual.ts): the
    // shell is a frustumCulled=false duplicate at 1.015 scale, so joining the
    // caster list after a weapon-graph change would put it in the shadow pass.
    // Mocked loader serves a minimal rig for every URL (the halo suite's
    // pattern), so the warrior def resolves without assets.
    vi.resetModules();
    const stubGltf = () => {
      const scene = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
      mesh.name = 'body';
      scene.add(mesh);
      return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
    };
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));
    try {
      const { charactersReady } = await import('../src/render/characters/assets');
      await charactersReady();
      const { CharacterVisual } = await import('../src/render/characters/visual');
      // player_warrior: the offhandSlot def, so setOffhand takes the lean path
      // that ends in rebuildCasters (visual.ts setOffhand).
      const visual = new CharacterVisual('player_warrior', 0xffffff, 0);
      const body = visual.root.getObjectByName('body') as THREE.Mesh;
      expect(body).toBeDefined();

      // A held-weapon host inside the model graph, carrying a real VFX rig:
      // makeShell parents the shell to the host mesh itself.
      const host = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      host.name = 'held_test_weapon';
      host.userData.weaponMesh = true;
      body.add(host);
      const spec: WeaponVfxSpec = {
        tier: 'epic',
        name: 'test blade',
        type: 'sword',
        lore: '',
        fx: [],
      };
      const handle = createWeaponVfx(host, spec, { grounded: false });
      const shell = host.children.find((o) => o.userData.__vfx) as THREE.Mesh;
      expect(shell.userData.weaponVfxMesh).toBe(true);
      expect(shell.castShadow).toBe(false);

      // The offhand swap re-lists the casters over the whole model graph.
      visual.setOffhand('shield_round');
      const casters = (visual as unknown as { casters: THREE.Mesh[] }).casters;
      expect(casters).toContain(body);
      expect(casters).toContain(host);
      expect(casters).not.toContain(shell);
      // shadowOn defaults true, so the sweep turned the host on while the
      // tagged shell stayed out of the shadow pass.
      expect(host.castShadow).toBe(true);
      expect(shell.castShadow).toBe(false);

      handle.dispose();
      visual.dispose();
    } finally {
      vi.doUnmock('../src/render/assets/loader');
      vi.resetModules();
    }
  });
});
