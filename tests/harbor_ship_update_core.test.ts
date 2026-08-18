import { describe, expect, it, vi } from 'vitest';
import type { DeckStandInRuntimeHandle } from '../src/render/harbor_deck_stand_in_core';
import { createHarborShipUpdater } from '../src/render/harbor_ship_update_core';

interface Visual {
  id: string;
}

interface Handle extends DeckStandInRuntimeHandle<Visual> {
  id: string;
}

describe('createHarborShipUpdater', () => {
  it('hands the renderer a true-to-false stand-in lifecycle without per-frame callback setup', () => {
    const handle: Handle = {
      id: 'mainland',
      cueStartSec: 1,
      segment: {},
      deckStandIn: null,
    };
    const visual = { id: 'player' };
    const createStandIn = vi.fn(() => visual);
    const updateStandIn = vi.fn();
    const disposeStandIn = vi.fn();
    const updateMotion = vi.fn();
    const handles = vi.fn(() => [handle]);
    const updateHarborShips = createHarborShipUpdater({
      handles,
      isRealLocalPlayer: () => true,
      createStandIn,
      updateStandIn,
      disposeStandIn,
      updateMotion,
    });

    expect(updateHarborShips({}, 0.1)).toBe(true);
    expect(updateHarborShips({}, 0.2)).toBe(true);
    expect(createStandIn).toHaveBeenCalledTimes(1);
    expect(updateStandIn).toHaveBeenNthCalledWith(1, visual, 0.1);
    expect(updateStandIn).toHaveBeenNthCalledWith(2, visual, 0.2);

    handle.cueStartSec = null;
    handle.segment = null;
    expect(updateHarborShips({}, 0.3)).toBe(false);

    expect(disposeStandIn).toHaveBeenCalledTimes(1);
    expect(updateMotion).toHaveBeenCalledTimes(3);
    expect(handles).toHaveBeenCalledTimes(3);
  });

  it('keeps the authoritative rig visible when stand-in creation fails', () => {
    const handle: Handle = {
      id: 'mainland',
      cueStartSec: 1,
      segment: {},
      deckStandIn: null,
    };
    const visual = { id: 'retry' };
    const createStandIn = vi
      .fn<() => Visual | null>()
      .mockReturnValueOnce(null)
      .mockReturnValue(visual);
    const updateHarborShips = createHarborShipUpdater({
      handles: () => [handle],
      isRealLocalPlayer: () => true,
      createStandIn,
      updateStandIn: vi.fn(),
      disposeStandIn: vi.fn(),
      updateMotion: vi.fn(),
    });

    expect(updateHarborShips({}, 0.1)).toBe(false);
    expect(updateHarborShips({}, 0.1)).toBe(true);
    expect(createStandIn).toHaveBeenCalledTimes(2);
  });

  it('disposes the prior stand-in and keeps one replacement active across a ship cut', () => {
    const oldVisual = { id: 'old' };
    const oldShip: Handle = {
      id: 'mainland',
      cueStartSec: null,
      segment: null,
      deckStandIn: oldVisual,
    };
    const newShip: Handle = {
      id: 'gullhaven',
      cueStartSec: 5,
      segment: {},
      deckStandIn: null,
    };
    const disposeStandIn = vi.fn();
    const updateHarborShips = createHarborShipUpdater({
      handles: () => [oldShip, newShip],
      isRealLocalPlayer: () => true,
      createStandIn: () => ({ id: 'new' }),
      updateStandIn: vi.fn(),
      disposeStandIn,
      updateMotion: vi.fn(),
    });

    expect(updateHarborShips({}, 0.1)).toBe(true);
    expect(disposeStandIn).toHaveBeenCalledWith(oldVisual);
    expect(oldShip.deckStandIn).toBeNull();
    expect(newShip.deckStandIn).toEqual({ id: 'new' });
  });
});
