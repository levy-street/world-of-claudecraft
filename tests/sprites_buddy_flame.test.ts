import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { attachSpritesBuddyFlame } from '../src/render/sprites_buddy_flame';
import { attachTemplateModelVfx } from '../src/render/template_model_vfx';
import { buddyTemplateId } from '../src/sim/content/buddy_mobs';
import { IGNIVAR_BOSS_ID } from '../src/sim/types';

/** A stand-in rig root with the sprite buddy's flame bones. */
function spritesRig(bones = ['gold_squash', 'teal_squash', 'gold_merged_12']): THREE.Group {
  const root = new THREE.Group();
  for (const name of bones) {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
  }
  return root;
}

function flamesOn(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.name.startsWith('spritesBuddyFlame_')) out.push(o);
  });
  return out;
}

describe('sprite buddy flame attach', () => {
  it('hangs one flame on each squash bone, once however often it is attached', () => {
    const root = spritesRig();
    expect(attachSpritesBuddyFlame(root, () => false)).toBe(true);
    expect(attachSpritesBuddyFlame(root, () => false)).toBe(true);
    expect(flamesOn(root)).toHaveLength(2);
    expect(root.getObjectByName('spritesBuddyFlame_gold')?.parent?.name).toBe('gold_squash');
    expect(root.getObjectByName('spritesBuddyFlame_teal')?.parent?.name).toBe('teal_squash');
  });

  it('attaches nothing to a rig missing a squash bone', () => {
    const root = spritesRig(['gold_squash', 'gold_merged_12']);
    expect(attachSpritesBuddyFlame(root, () => false)).toBe(false);
    expect(flamesOn(root)).toEqual([]);
    expect(root.userData.spritesBuddyFlame).toBeUndefined();
  });

  it('steps once per renderer frame from the draw, and freezes its flicker under reduced motion', () => {
    const root = spritesRig();
    let reduced = false;
    attachSpritesBuddyFlame(root, () => reduced);
    root.updateMatrixWorld(true);
    const gold = root.getObjectByName('spritesBuddyFlame_gold') as THREE.Mesh;
    const values = gold.userData.flameUniforms as { time: number };
    const now = vi.spyOn(performance, 'now');
    const draw = (frame: number, ms: number) => {
      now.mockReturnValue(ms);
      const renderer = { info: { render: { frame } } } as unknown as THREE.WebGLRenderer;
      gold.onBeforeRender(
        renderer,
        new THREE.Scene(),
        new THREE.Camera(),
        gold.geometry,
        gold.material as THREE.Material,
        null as never,
      );
    };
    try {
      draw(1, 1000);
      const t1 = values.time;
      draw(1, 1016); // same frame again (another pass): no step
      expect(values.time).toBe(t1);
      draw(2, 1016);
      expect(values.time).toBeGreaterThan(t1);
      reduced = true;
      const t2 = values.time;
      draw(3, 1032);
      expect(values.time).toBe(t2);
    } finally {
      now.mockRestore();
    }
  });

  it('hides teal once it has sunk wholly into gold', () => {
    const root = spritesRig();
    attachSpritesBuddyFlame(root, () => false);
    root.updateMatrixWorld(true); // both squash bones at the origin: teal swallowed
    const gold = root.getObjectByName('spritesBuddyFlame_gold') as THREE.Mesh;
    const teal = root.getObjectByName('spritesBuddyFlame_teal') as THREE.Mesh;
    const renderer = { info: { render: { frame: 1 } } } as unknown as THREE.WebGLRenderer;
    gold.onBeforeRender(
      renderer,
      new THREE.Scene(),
      new THREE.Camera(),
      gold.geometry,
      gold.material as THREE.Material,
      null as never,
    );
    expect(teal.visible).toBe(false);
    expect((teal.userData.flameUniforms as { fade: number }).fade).toBeLessThan(0.001);
  });
});

describe('template model effects', () => {
  it('routes the sprite buddy to its flames and leaves every other template alone', () => {
    expect(buddyTemplateId('sprites')).toBe('buddy_sprites');
    const sprites = spritesRig();
    attachTemplateModelVfx('buddy_sprites', sprites, () => false);
    expect(flamesOn(sprites)).toHaveLength(2);

    const other = spritesRig();
    attachTemplateModelVfx('forest_wolf', other, () => false);
    expect(flamesOn(other)).toEqual([]);
  });

  it('still gives Ignivar his furnace effects through the same seam', () => {
    const textureLoad = vi
      .spyOn(THREE.TextureLoader.prototype, 'load')
      .mockReturnValue(new THREE.Texture());
    try {
      const model = new THREE.Group();
      for (const name of ['vfx_core', 'vfx_ventl', 'vfx_ventr']) {
        const socket = new THREE.Bone();
        socket.name = name;
        model.add(socket);
      }
      attachTemplateModelVfx(IGNIVAR_BOSS_ID, model, () => false);
      expect(model.getObjectByName('vfx_core__plume')).toBeDefined();
      expect(flamesOn(model)).toEqual([]);
    } finally {
      textureLoad.mockRestore();
    }
  });
});
