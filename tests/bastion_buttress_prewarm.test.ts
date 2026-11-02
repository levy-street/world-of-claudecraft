import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { BastionFx } from '../src/render/sunken_bastion/bastion_fx';
import type { IWorld } from '../src/world_api';

vi.mock('../src/render/textures', () => ({ radialGlowTexture: () => new THREE.Texture() }));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async () => ({ scene: new THREE.Group() }),
}));

type Body = IWorld['entities'] extends Map<number, infer E> ? E : never;

it('gates hidden buttress shapes before any entity exists, then reuses and releases the pool', async () => {
  const scene = new THREE.Scene();
  const player = { id: 1, kind: 'player', pos: { x: 0, y: 0, z: 0 }, auras: [] } as unknown as Body;
  const entities = new Map<number, Body>([[1, player]]);
  const world = { playerId: 1, player, entities } as IWorld;
  const compiled: THREE.InstancedMesh[] = [];
  const fx = new BastionFx(
    scene,
    () => 2,
    world,
    async (root) => {
      if (root.name !== 'sunken-bastion-telegraphs') return;
      expect(root.visible).toBe(false);
      root.traverse((object) => {
        if (
          object instanceof THREE.InstancedMesh &&
          !Array.isArray(object.material) &&
          object.material.name === 'SunkenBastionKitStone'
        )
          compiled.push(object);
      });
    },
  );
  try {
    await fx.readyForEntry;
    expect(compiled).toHaveLength(3);
    for (const mesh of compiled) {
      expect(mesh.visible).toBe(false);
      expect(mesh.parent?.visible).toBe(false);
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
      expect(mesh.geometry.attributes.color.itemSize).toBe(3);
    }
    const update = vi.spyOn(compiled[0], 'updateMatrixWorld');
    scene.updateMatrixWorld(true);
    expect(update).not.toHaveBeenCalled();
    const buttress = {
      id: 2,
      kind: 'object',
      templateId: 'bastion_buttress_intact',
      pos: { x: 12, y: 2, z: 18 },
    } as unknown as Body;
    entities.set(buttress.id, buttress);
    fx.update(0.1);
    scene.updateMatrixWorld(true);
    expect(compiled.filter((mesh) => mesh.visible)).toHaveLength(1);
    expect(compiled[0].matrixWorld.elements[12]).toBe(12);
    expect(compiled[0].matrixWorld.elements[14]).toBe(18);
    buttress.templateId = 'bastion_buttress_cracked';
    fx.update(0.1);
    expect(compiled.filter((mesh) => mesh.visible)).toEqual([compiled[1]]);
    entities.clear();
    fx.update(0.1);
    expect(compiled[0].parent?.visible).toBe(false);
    const releases = compiled.map((mesh) => {
      const released = vi.fn();
      mesh.addEventListener('dispose', released);
      return released;
    });
    fx.dispose();
    for (const released of releases) expect(released).toHaveBeenCalledOnce();
  } finally {
    if (scene.getObjectByName('sunken-bastion-telegraphs')) fx.dispose();
    vi.restoreAllMocks();
  }
});
