import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadGltf } from '../src/render/assets/loader';
import { GestureMeshToggles } from '../src/render/characters/gesture_mesh_toggles';
import {
  ZULGAR_HIDE_GESTURE,
  ZULGAR_SHOW_GESTURE,
} from '../src/render/characters/wildheart_creature_looks';
import type { BasinFxHost } from '../src/render/wildheart_basin/basin_fx_host';
import { ZulgarAvatarFx } from '../src/render/wildheart_basin/zulgar_avatar_fx';
import {
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_MAULED,
  ZULGAR_VANISHED,
} from '../src/sim/encounters/wildheart_basin/ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    return {
      scene,
      animations: ['Idle', 'Walk', 'Run', 'Roar', 'Pounce'].map(
        (name) =>
          new THREE.AnimationClip(name, 0.4, [
            new THREE.NumberKeyframeTrack('.rotation[x]', [0, 0.4], [0, 0.1]),
          ]),
      ),
    };
  }),
}));

function fixture(gate?: () => Promise<void>) {
  const e = {
    id: 42,
    templateId: ZULGAR_ID,
    pos: { x: 0, y: 0, z: 0 },
    facing: 0,
    dead: false,
    auras: [{ id: ZULGAR_AVATAR }],
  } as Entity;
  const scene = new THREE.Scene();
  const priest = new THREE.Group();
  const priestModel = new THREE.Group();
  priestModel.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  // As in CharacterVisual: the pick proxy is a sibling of the GLB model.
  const clickProxy = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2));
  clickProxy.visible = false;
  clickProxy.userData.entityId = e.id;
  priest.add(priestModel, clickProxy);
  const toggles = new GestureMeshToggles(priestModel, [
    { nodes: ['*'], hideNow: ZULGAR_HIDE_GESTURE, showNow: ZULGAR_SHOW_GESTURE },
  ]);
  const gesture = vi.fn((_id: number, name: string) => {
    toggles.handle(name);
  });
  const host = {
    groundY: () => 0,
    uTime: { value: 0 },
    density: 0,
    rand: () => 0.5,
    puff: vi.fn(),
  } as unknown as BasinFxHost;
  const world = { entities: new Map([[e.id, e]]) } as unknown as IWorld;
  const fx = new ZulgarAvatarFx(scene, host, world, gate, gesture);
  fx.setZulgar(e);
  return { fx, e, scene, gesture, world, priest, priestModel, clickProxy };
}

function event(ability: string) {
  return { type: 'spellfx', ability } as Extract<SimEvent, { type: 'spellfx' }>;
}

describe('Zulgar avatar transformation', () => {
  it('keeps the priest until the spirit asset and compile gate are ready', async () => {
    let release!: () => void;
    const f = fixture(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    f.fx.update(0.1);
    expect(f.gesture).not.toHaveBeenCalledWith(42, ZULGAR_HIDE_GESTURE);
    await Promise.resolve();
    f.fx.update(0.1);
    expect(f.gesture).not.toHaveBeenCalledWith(42, ZULGAR_HIDE_GESTURE);
    release();
    await f.fx.ready;
    f.fx.update(0.1);
    expect(f.gesture).toHaveBeenLastCalledWith(42, ZULGAR_HIDE_GESTURE);
    f.fx.dispose();
  });

  it('hides priest meshes without hiding the entity group or breaking its click proxy', async () => {
    const f = fixture();
    await f.fx.ready;
    f.fx.update(0.1);
    expect(f.priestModel.visible).toBe(false);
    expect(f.priest.visible).toBe(true);
    f.priest.updateMatrixWorld(true);
    const hits = new THREE.Raycaster(
      new THREE.Vector3(0, 0, 10),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(f.clickProxy);
    expect(hits[0]?.object.userData.entityId).toBe(42);
    f.fx.dispose();
    expect(f.priestModel.visible).toBe(true);
  });

  it('retains the priest after an asset failure', async () => {
    vi.mocked(loadGltf).mockRejectedValueOnce(new Error('unavailable'));
    const f = fixture();
    await f.fx.ready;
    f.fx.update(1);
    expect(f.gesture).not.toHaveBeenCalledWith(42, ZULGAR_HIDE_GESTURE);
    f.fx.dispose();
  });

  it('restores a hidden body when the entity leaves the world', async () => {
    const f = fixture();
    await f.fx.ready;
    f.fx.update(0.1);
    f.world.entities.delete(f.e.id);
    f.fx.update(0.1);
    expect(f.gesture).toHaveBeenLastCalledWith(42, ZULGAR_SHOW_GESTURE);
    f.fx.dispose();
  });

  it.each(['end', 'death', 'reset', 'dispose'] as const)(
    'restores the priest on %s, including a permanent final-phase avatar',
    async (reason) => {
      const f = fixture();
      f.e.auras[0].permanent = true;
      await f.fx.ready;
      f.fx.update(0.1);
      expect(f.gesture).toHaveBeenLastCalledWith(42, ZULGAR_HIDE_GESTURE);
      if (reason === 'end') f.e.auras = [];
      if (reason === 'death') f.e.dead = true;
      if (reason === 'reset') f.fx.hide();
      else if (reason === 'dispose') f.fx.dispose();
      else f.fx.update(0.1);
      expect(f.gesture).toHaveBeenLastCalledWith(42, ZULGAR_SHOW_GESTURE);
      f.fx.dispose();
    },
  );

  it('preserves heroic vanish and restores on landing without an avatar', async () => {
    const f = fixture();
    f.e.auras = [{ id: ZULGAR_VANISHED }] as Entity['auras'];
    await f.fx.ready;
    f.fx.update(0.1);
    expect(f.gesture).toHaveBeenLastCalledWith(42, ZULGAR_HIDE_GESTURE);
    f.e.auras = [];
    f.fx.update(0.1);
    expect(f.gesture).toHaveBeenLastCalledWith(42, ZULGAR_SHOW_GESTURE);
    f.fx.dispose();
  });

  it('resumes an unchanged idle loop after the roar fully faded it out', async () => {
    const f = fixture();
    await f.fx.ready;
    f.fx.update(0.1);
    f.fx.handleEvent(event(ZULGAR_AVATAR));
    for (let i = 0; i < 20; i++) f.fx.update(0.05);
    const internal = f.fx as unknown as { actions: Map<string, THREE.AnimationAction> };
    expect(internal.actions.get('Idle')?.getEffectiveWeight()).toBeGreaterThan(0.9);
    f.fx.dispose();
  });

  it.each([ZULGAR_AVATAR, ZULGAR_MAULED])(
    'restores moving animation weight after %s',
    async (ability) => {
      const f = fixture();
      await f.fx.ready;
      f.fx.update(0.1);
      f.fx.handleEvent(event(ability));
      for (let i = 0; i < 20; i++) {
        f.e.pos.x += 1;
        f.fx.update(0.05);
      }
      const internal = f.fx as unknown as { actions: Map<string, THREE.AnimationAction> };
      expect(internal.actions.get('Run')?.getEffectiveWeight()).toBeGreaterThan(0.9);
      f.fx.dispose();
    },
  );
});
