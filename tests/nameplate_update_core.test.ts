import { describe, expect, it, vi } from 'vitest';
import type { ControllerWorldPromptFrame } from '../src/render/controller_world_prompt_view';
import { NameplateUpdateCore } from '../src/render/nameplate_update_core';

const frame: ControllerWorldPromptFrame = {
  padActive: true,
  claimedBy: null,
  action: {
    kind: 'confirm',
    buttonLabel: 'A',
    anchor: { kind: 'entity', entityId: 7 },
    blocked: false,
  },
};

describe('nameplate update core', () => {
  it('pulls current prompt state and clears the source without retaining stale frames', () => {
    const update = new NameplateUpdateCore();
    let current: ControllerWorldPromptFrame | null = frame;
    update.setControllerWorldPromptSource(() => current);

    expect(update.controllerWorldPrompt()).toBe(frame);
    current = null;
    expect(update.controllerWorldPrompt()).toBeNull();
    update.setControllerWorldPromptSource(null);
    current = frame;
    expect(update.controllerWorldPrompt()).toBeNull();
  });

  it('keeps prompt polling out of cadence advancement', () => {
    const update = new NameplateUpdateCore();
    const source = vi.fn(() => frame);
    update.setControllerWorldPromptSource(source);

    expect(update.advance(0.02, 0.05)).toBe(false);
    expect(update.advance(0.02, 0.05)).toBe(false);
    expect(update.advance(0.02, 0.05)).toBe(true);
    expect(source).not.toHaveBeenCalled();
    expect(update.controllerWorldPrompt()).toBe(frame);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it('resets elapsed time after each full pass', () => {
    const update = new NameplateUpdateCore();

    expect(update.advance(0.07, 0.06)).toBe(true);
    expect(update.advance(0.05, 0.06)).toBe(false);
    expect(update.advance(0.01, 0.06)).toBe(true);
  });
});
