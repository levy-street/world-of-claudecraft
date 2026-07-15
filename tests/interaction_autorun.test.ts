import { describe, expect, it, vi } from 'vitest';
import { stopAutorunForInteraction } from '../src/game/interaction_autorun';

describe('stopAutorunForInteraction', () => {
  it('clears the autorun latch and its mobile lock indicator after an interaction', () => {
    const setAutorun = vi.fn();
    const clearClickMove = vi.fn();
    const syncAutorun = vi.fn();

    expect(stopAutorunForInteraction(true, { setAutorun, clearClickMove }, { syncAutorun })).toBe(
      true,
    );
    expect(setAutorun).toHaveBeenCalledWith(false);
    expect(clearClickMove).toHaveBeenCalledOnce();
    expect(syncAutorun).toHaveBeenCalledWith(false);
  });

  it('preserves autorun when no world interaction happened', () => {
    const setAutorun = vi.fn();
    const clearClickMove = vi.fn();
    const syncAutorun = vi.fn();

    expect(stopAutorunForInteraction(false, { setAutorun, clearClickMove }, { syncAutorun })).toBe(
      false,
    );
    expect(setAutorun).not.toHaveBeenCalled();
    expect(clearClickMove).not.toHaveBeenCalled();
    expect(syncAutorun).not.toHaveBeenCalled();
  });
});
