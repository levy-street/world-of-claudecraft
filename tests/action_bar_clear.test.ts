import { describe, expect, it, vi } from 'vitest';
import {
  handleShiftClearContextMenu,
  handleShiftClearKeydown,
} from '../src/ui/hud/action_bar/action_bar_clear';

describe('action-bar clear gestures', () => {
  it('leaves a slot unchanged on an ordinary right-click', () => {
    const preventDefault = vi.fn();
    const clear = vi.fn();

    expect(handleShiftClearContextMenu({ shiftKey: false, preventDefault }, clear)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears a slot and suppresses the menu on Shift-right-click', () => {
    const preventDefault = vi.fn();
    const clear = vi.fn();

    expect(handleShiftClearContextMenu({ shiftKey: true, preventDefault }, clear)).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });

  it.each(['Delete', 'Backspace'])('clears a slot on Shift-%s', (key) => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const clear = vi.fn();

    expect(
      handleShiftClearKeydown({ shiftKey: true, key, preventDefault, stopPropagation }, clear),
    ).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('ignores unmodified and unrelated key presses', () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const clear = vi.fn();

    expect(
      handleShiftClearKeydown(
        { shiftKey: false, key: 'Delete', preventDefault, stopPropagation },
        clear,
      ),
    ).toBe(false);
    expect(
      handleShiftClearKeydown(
        { shiftKey: true, key: 'Enter', preventDefault, stopPropagation },
        clear,
      ),
    ).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
