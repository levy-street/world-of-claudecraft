import { describe, expect, it } from 'vitest';
import { isVisuallyDead } from '../src/render/anim_state';

describe('render animation state', () => {
  it('treats zero-hp entities as visually dead before the server dead flag arrives', () => {
    expect(isVisuallyDead({ dead: false, hp: 0 })).toBe(true);
    expect(isVisuallyDead({ dead: false, hp: -1 })).toBe(true);
    expect(isVisuallyDead({ dead: false, hp: 1 })).toBe(false);
    expect(isVisuallyDead({ dead: true, hp: 10 })).toBe(true);
  });
});
