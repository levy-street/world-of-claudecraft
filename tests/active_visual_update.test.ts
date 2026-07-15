import { describe, expect, it, vi } from 'vitest';
import { updateActiveAndBaseVisual } from '../src/render/characters/active_visual_update';
import type { AnimState } from '../src/render/characters/anim_state';

const STATE = {} as AnimState;

function visual() {
  return { update: vi.fn() };
}

describe('updateActiveAndBaseVisual', () => {
  it('updates a visible base rig exactly once with the selected cadence', () => {
    const base = visual();
    updateActiveAndBaseVisual(base, base, 0.05, STATE, true);
    expect(base.update).toHaveBeenCalledTimes(1);
    expect(base.update).toHaveBeenCalledWith(0.05, STATE, true);
  });

  it('ticks a hidden base rig without mixer integration while a form is active', () => {
    const base = visual();
    const form = visual();
    updateActiveAndBaseVisual(base, form, 0.05, STATE, true);
    expect(form.update).toHaveBeenCalledWith(0.05, STATE, true);
    expect(base.update).toHaveBeenCalledWith(0.05, STATE, false);
  });
});
