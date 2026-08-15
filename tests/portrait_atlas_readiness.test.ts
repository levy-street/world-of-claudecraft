import { describe, expect, it, vi } from 'vitest';

const atlas = vi.hoisted(() => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    loaded: false,
    promise,
    resolve: () => {
      atlas.loaded = true;
      resolve();
    },
  };
});

const ensureSkinTexture = vi.hoisted(() => vi.fn(() => (atlas.loaded ? null : atlas.promise)));
const CharacterVisual = vi.hoisted(() => vi.fn());

vi.mock('../src/render/assets/preload', () => ({
  assetsReady: () => Promise.resolve(),
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));
vi.mock('../src/render/characters/assets', () => ({
  ensureSkinTexture,
}));
vi.mock('../src/render/characters/visual', () => ({
  CharacterVisual,
}));

import {
  onPortraitUpdate,
  portraitsReady,
  visualPortraitDataUrl,
} from '../src/render/characters/portrait';

describe('deferred portrait atlas readiness', () => {
  it('returns no false portrait and notifies consumers when the real atlas arrives', async () => {
    await vi.waitFor(() => expect(portraitsReady()).toBe(true));
    const updated = vi.fn();
    onPortraitUpdate(updated);

    expect(visualPortraitDataUrl('player_mage', 1)).toBeNull();
    expect(ensureSkinTexture).toHaveBeenCalledWith('player_mage', 1);
    expect(CharacterVisual).not.toHaveBeenCalled();

    atlas.resolve();
    await vi.waitFor(() => expect(updated).toHaveBeenCalledWith('player_mage', 1));
  });
});
