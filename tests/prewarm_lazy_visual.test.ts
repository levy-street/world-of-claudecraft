import { describe, it, expect } from 'vitest';
import { isVisualLazy } from '../src/render/characters/manifest';

// Guards the boot-prewarm crash fix: a lazyPreload visual must be reported as lazy
// so the renderer's prewarm sweep skips building it (its GLB isn't loaded at boot,
// and building one throws "character asset not preloaded"). player_mech is the
// upstream visual flagged lazyPreload: true.
describe('isVisualLazy', () => {
  it('is true for a lazyPreload visual (player_mech)', () => {
    expect(isVisualLazy('player_mech')).toBe(true);
  });

  it('is false for an eagerly-preloaded visual (player_warrior)', () => {
    expect(isVisualLazy('player_warrior')).toBe(false);
  });

  it('is false for an unknown visual key', () => {
    expect(isVisualLazy('definitely_not_a_real_visual_key')).toBe(false);
  });
});
