import { describe, expect, it, vi } from 'vitest';
import { type PadCastHud, padCastPress, padCastRelease } from '../src/game/pad_cast_routing';

function hudStub(): PadCastHud {
  return {
    pressCrossHotbarAction: vi.fn(),
    releaseCrossHotbarAction: vi.fn(),
    releaseSlot: vi.fn(),
  };
}

describe('pad cast routing', () => {
  it('auto-targets before forwarding a cross hotbar press', () => {
    const calls: string[] = [];
    const hud = hudStub();
    const action = { type: 'ability' as const, id: 'glacial_front' };
    const autoTarget = vi.fn(() => calls.push('target'));
    vi.mocked(hud.pressCrossHotbarAction).mockImplementation(() => calls.push('press'));

    padCastPress(hud, autoTarget, action);

    expect(autoTarget).toHaveBeenCalledExactlyOnceWith(action);
    expect(hud.pressCrossHotbarAction).toHaveBeenCalledExactlyOnceWith(action);
    expect(calls).toEqual(['target', 'press']);
  });

  it('releases flat slots through releaseSlot', () => {
    const hud = hudStub();

    padCastRelease(hud, { kind: 'slot', slot: 7 });

    expect(hud.releaseSlot).toHaveBeenCalledExactlyOnceWith(7);
    expect(hud.releaseCrossHotbarAction).not.toHaveBeenCalled();
  });

  it('releases cross hotbar actions through their dedicated route', () => {
    const hud = hudStub();
    const action = { type: 'item' as const, id: 'minor_healing_potion' };

    padCastRelease(hud, { kind: 'xhb', action });

    expect(hud.releaseCrossHotbarAction).toHaveBeenCalledExactlyOnceWith(action);
    expect(hud.releaseSlot).not.toHaveBeenCalled();
  });
});
