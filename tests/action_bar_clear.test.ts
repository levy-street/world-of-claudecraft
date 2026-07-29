import { describe, expect, it, vi } from 'vitest';
import {
  handleShiftClearContextMenu,
  handleShiftClearKeydown,
} from '../src/ui/hud/action_bar/action_bar_clear';

describe('action-bar clear gestures', () => {
  it('leaves a slot unchanged on an ordinary right-click', () => {
    const preventDefault = vi.fn();
    const clear = vi.fn();

    expect(handleShiftClearContextMenu({ shiftKey: false, preventDefault }, false, clear)).toBe(
      false,
    );
    expect(preventDefault).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears a slot and suppresses the menu on Shift-right-click', () => {
    const preventDefault = vi.fn();
    const clear = vi.fn();

    expect(handleShiftClearContextMenu({ shiftKey: true, preventDefault }, false, clear)).toBe(
      true,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
  });

  it.each(['Delete', 'Backspace'])('clears a slot on Shift-%s', (key) => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const clear = vi.fn();

    expect(
      handleShiftClearKeydown(
        { shiftKey: true, key, preventDefault, stopPropagation },
        false,
        clear,
      ),
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
        false,
        clear,
      ),
    ).toBe(false);
    expect(
      handleShiftClearKeydown(
        { shiftKey: true, key: 'Enter', preventDefault, stopPropagation },
        false,
        clear,
      ),
    ).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('suppresses every clear gesture while the action bars are locked', () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const clear = vi.fn();

    expect(handleShiftClearContextMenu({ shiftKey: true, preventDefault }, true, clear)).toBe(true);
    expect(
      handleShiftClearKeydown(
        { shiftKey: true, key: 'Delete', preventDefault, stopPropagation },
        true,
        clear,
      ),
    ).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
  });
});
