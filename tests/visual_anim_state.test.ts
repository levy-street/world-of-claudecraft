import { describe, expect, it } from 'vitest';
import { isVisuallyDead } from '../src/render/anim_state';
import type { Aura } from '../src/sim/types';

describe('render animation state', () => {
  it('treats zero-hp entities as visually dead before the server dead flag arrives', () => {
    expect(isVisuallyDead({ dead: false, hp: 0 })).toBe(true);
    expect(isVisuallyDead({ dead: false, hp: -1 })).toBe(true);
    expect(isVisuallyDead({ dead: false, hp: 1 })).toBe(false);
    expect(isVisuallyDead({ dead: true, hp: 10 })).toBe(true);
  });

  it('uses the death pose while Feign Death is active without making the entity dead', () => {
    const feign = { kind: 'feign_death' } as Aura;
    const speed = { kind: 'buff_speed' } as Aura;

    expect(isVisuallyDead({ dead: false, hp: 100, auras: [feign] })).toBe(true);
    expect(isVisuallyDead({ dead: false, hp: 100, auras: [speed] })).toBe(false);
  });
});
