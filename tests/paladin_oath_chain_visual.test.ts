import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPaladinVfxDetailForTest } from '../src/render/ability_vfx/paladin_vfx_detail';
import { isOathChainAura } from '../src/render/character_effects';
import { syncPaladinOathChainVisual } from '../src/render/paladin_oath_chain_visual';

// Node tests run at the Medium preset; the tests below pin the authored
// composition (full detail) unless a test names another tier.
beforeEach(() => setPaladinVfxDetailForTest('full'));
afterEach(() => setPaladinVfxDetailForTest(null));

describe('Paladin Oath Chain visual', () => {
  it('recognises both the pull and its arrival slow, but not unrelated control', () => {
    expect(isOathChainAura({ id: 'oath_chain_pull', kind: 'forced_move' })).toBe(true);
    expect(isOathChainAura({ id: 'oath_chain_slow', kind: 'slow' })).toBe(true);
    expect(isOathChainAura({ id: 'frostbolt_slow', kind: 'slow' })).toBe(false);
  });

  it('leaves the chain to the Paladin kit: the renderer hook draws nothing', () => {
    const parent = new THREE.Group();
    const at = { x: 0, y: 0, z: 0 };
    expect(
      syncPaladinOathChainVisual(null, parent, at, { x: 10, y: 0, z: 0 }, 1.8, 1.8, true, 0, false),
    ).toBeNull();
    expect(parent.children).toHaveLength(0);
    const leftover = { dispose: vi.fn() };
    syncPaladinOathChainVisual(leftover, parent, at, at, 1.8, 1.8, true, 0, false);
    expect(leftover.dispose).toHaveBeenCalledOnce();
  });

  it('draws nothing on any tier: the chain is the kit tiers own', () => {
    for (const detail of ['full', 'light', 'minimal'] as const) {
      setPaladinVfxDetailForTest(detail);
      const parent = new THREE.Group();
      const at = { x: 0, y: 0, z: 0 };
      expect(syncPaladinOathChainVisual(null, parent, at, at, 1.8, 1.8, true, 0, false)).toBeNull();
      expect(parent.children).toHaveLength(0);
    }
  });
});
