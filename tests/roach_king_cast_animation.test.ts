import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { Entity } from '../src/sim/types';

function testGltf() {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  body.name = 'CrownRoot';
  scene.add(body);
  const clips = [
    'Idle',
    'Walk',
    'Run',
    'Attack',
    'Hit',
    'Death',
    'Cast',
    'Jump',
    'Transform',
    'Spit',
    'Stomp',
    'Decree',
  ];
  return {
    scene,
    animations: clips.map((name) => {
      const duration = name === 'Transform' ? 17 / 6 : 1;
      return new THREE.AnimationClip(name, duration, [
        new THREE.NumberKeyframeTrack('CrownRoot.position[x]', [0, duration], [0, 1]),
      ]);
    }),
  };
}

const pose: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: true,
  castingAbility: 'rift_asmon_coronation',
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

describe('Roach King coronation cast clip', () => {
  it('runs to its final pose and holds through a delayed cast end without looping or losing weight', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(async () => testGltf()),
      loadTexture: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
      releaseGltf: vi.fn(),
    }));
    const { preloadMountAssets } = await import('../src/render/characters/assets');
    await preloadMountAssets('mob_asmon_hermit');
    const { createCharacterVisual } = await import('../src/render/characters/index');
    const visual = createCharacterVisual({
      kind: 'mob',
      id: 1,
      templateId: 'rift_boss_asmon',
      color: 0xffffff,
      skin: 0,
      mainhandItemId: null,
      auras: [],
    } as unknown as Entity);
    expect(visual).not.toBeNull();
    if (!visual) throw new Error('Missing hermit visual');
    const actions = (visual as unknown as { actions: Map<string, THREE.AnimationAction> }).actions;
    let previous = 0;
    for (let frame = 0; frame < 240; frame++) {
      visual.update(1 / 60, pose, true);
      const action = actions.get('Transform');
      if (!action) throw new Error('Missing Transform action');
      expect(action.time).toBeGreaterThanOrEqual(previous);
      previous = action.time;
      if (frame > 30) expect(action.getEffectiveWeight()).toBeGreaterThan(0.99);
    }
    const action = actions.get('Transform');
    if (!action) throw new Error('Missing Transform action');
    expect(action.loop).toBe(THREE.LoopOnce);
    expect(action.time).toBeCloseTo(17 / 6, 4);
    expect(action.paused).toBe(true);
    visual.update(1 / 60, { ...pose, casting: false, castingAbility: null }, true);
    expect(actions.get('Idle')?.isScheduled()).toBe(true);
    visual.dispose();
  });
});
