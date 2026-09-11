import { describe, expect, it, vi } from 'vitest';
import { createBgFlagKey } from '../src/game/interaction_input';

describe('createBgFlagKey', () => {
  it('attempts the dedicated flag action only while a match exists', () => {
    const bgFlagAction = vi.fn();
    const world = { bgInfo: null as { match: unknown } | null, bgFlagAction };
    const press = createBgFlagKey(world);

    press();
    expect(bgFlagAction).not.toHaveBeenCalled();

    world.bgInfo = { match: {} };
    press();

    expect(bgFlagAction).toHaveBeenCalledOnce();
  });
});
