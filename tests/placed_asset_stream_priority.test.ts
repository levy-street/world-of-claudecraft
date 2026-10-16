import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetLoadPriority } from '../src/render/assets/load_priority_core';
import { PlacedAssetsView } from '../src/render/placed_assets';
import type { PlacedAsset } from '../src/sim/types';

const requests = vi.hoisted(() => new Map<string, AssetLoadPriority | undefined>());
vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadGltf: (url: string, priority?: AssetLoadPriority) => {
    requests.set(url, priority);
    // Keep templates waiting so the view's real pending-placement index owns
    // priority throughout the test, without fetching assets or drawing a frame.
    return new Promise<never>(() => {});
  },
}));

const placement = (path: string, x: number): PlacedAsset => ({
  path,
  x,
  z: 0,
  rotY: 0,
  scale: 1,
});

function priorityFor(path: string): AssetLoadPriority {
  const priority = requests.get(path);
  expect(priority, `expected a loader priority callback for ${path}`).toBeTypeOf('function');
  if (!priority) throw new Error(`missing loader priority callback for ${path}`);
  return priority;
}

afterEach(() => requests.clear());

describe('placed asset loader priority wiring', () => {
  it('tracks the nearest waiting placement as the camera moves and placements leave', () => {
    const path = '/models/priority-shared.glb';
    const view = new PlacedAssetsView([placement(path, 2), placement(path, 10)], 1);
    try {
      const priority = priorityFor(path);
      expect(priority()).toBe(0); // no camera has been sampled yet
      view.updateLod(0, 0, 600);
      expect(priority()).toBe(4);
      view.updateLod(9, 0, 600);
      expect(priority()).toBe(1);
      view.removePlacement(1);
      expect(priority()).toBe(49);
      view.removePlacement(0);
      expect(priority()).toBe(Infinity);
    } finally {
      view.dispose();
    }
  });

  it('places speculative map-wide warmups behind resident placements', () => {
    const near = '/models/priority-near.glb';
    const far = '/models/priority-far.glb';
    const placements = Array.from({ length: 1600 }, (_, index) =>
      placement(index === 0 ? near : far, index === 0 ? 2 : 5000),
    );
    const view = new PlacedAssetsView(placements, 1, { streamAround: { x: 0, z: 0 } });
    try {
      const nearPriority = priorityFor(near);
      const farPriority = priorityFor(far);
      view.updateLod(0, 0, 600);
      expect(nearPriority()).toBe(4);
      expect(farPriority()).toBe(Infinity);
      view.streamResidency(5000, 0, 650, true);
      view.updateLod(4999, 0, 600);
      expect(farPriority()).toBe(1);
      expect(nearPriority()).toBe(Infinity);
    } finally {
      view.dispose();
    }
  });
});
