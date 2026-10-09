import { describe, expect, it } from 'vitest';
import { rewardGliderVisible } from '../src/render/reward_glider_core';
import type { Entity } from '../src/sim/types';

describe('reputation glider visibility', () => {
  it('requires a living airborne player with a live reward aura', () => {
    const entity = {
      kind: 'player',
      dead: false,
      onGround: false,
      auras: [{ id: 'rift_feather_glider', remaining: 30, value: 1 }],
    } as Entity;
    expect(rewardGliderVisible(entity)).toBe(true);
    for (const change of [
      { dead: true },
      { kind: 'mob' },
      { auras: [] },
      { auras: [{ id: 'slow_fall', remaining: 30 }] },
      { auras: [{ id: 'rift_feather_glider', remaining: 0, value: 1 }] },
      { auras: [{ id: 'rift_feather_glider', remaining: 30, value: 0 }] },
    ])
      expect(rewardGliderVisible({ ...entity, ...change } as Entity)).toBe(false);
  });
  it('uses the replicated airborne marker when the online client retains grounded defaults', () => {
    const entity = {
      kind: 'player',
      dead: false,
      onGround: true,
      auras: [{ id: 'rift_feather_glider', remaining: 30, value: 1 }],
    } as Entity;
    expect(rewardGliderVisible(entity)).toBe(true);
    entity.auras[0].value = 0;
    expect(rewardGliderVisible(entity)).toBe(false);
  });
});
