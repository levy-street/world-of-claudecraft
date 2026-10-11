import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { IWorld } from '../src/world_api';

const mocks = vi.hoisted(() => ({
  anchor: vi.fn(),
  familiar: vi.fn(),
  courier: vi.fn(),
  clear: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../src/render/umbral_anchor_marker', async () => {
  const { Group } = await import('three');
  return {
    UmbralAnchorMarker: class {
      group = new Group();
      update = mocks.anchor;
    },
  };
});
vi.mock('../src/render/affliction_familiar', () => ({
  AfflictionFamiliar: class {
    update = mocks.familiar;
    clear = mocks.clear;
  },
}));
vi.mock('../src/render/courier_visual', () => ({
  CourierVisual: class {
    update = mocks.courier;
    dispose = mocks.dispose;
  },
}));

import { LocalPlayerVisuals } from '../src/render/local_player_visuals';

describe('local player visual lifecycle', () => {
  it('preserves marker/familiar inputs and drives and tears down the courier', () => {
    const scene = new THREE.Scene();
    const owner = { id: 7 };
    const world = {
      playerId: 7,
      entities: new Map([[7, owner]]),
      courierInfo: { phase: 'outbound' },
    } as unknown as IWorld;
    const views = new Map();
    const visuals = new LocalPlayerVisuals(
      scene,
      () => 0,
      () => undefined,
    );
    expect(scene.children).toHaveLength(0);
    visuals.attach();
    expect(scene.children).toHaveLength(1);
    visuals.update(world, views, true, 12, 0.05, true);
    expect(mocks.anchor).toHaveBeenCalledWith(owner, 12, true, true);
    expect(mocks.familiar).toHaveBeenCalledWith(world, views, true, 12);
    expect(mocks.courier).toHaveBeenCalledWith(world.courierInfo, 0.05, true);
    visuals.dispose();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });
});
