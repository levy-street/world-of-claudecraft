// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import type { SimEvent } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

const victory: Extract<SimEvent, { type: 'duelEnd' }> = {
  type: 'duelEnd',
  winnerName: 'Winner',
  loserName: 'Loser',
  winnerPid: 1,
  loserPid: 2,
  zoneId: 'eastbrook_vale',
};

function hudAt(pid: number, z: number) {
  const hud = Object.assign(Object.create(Hud.prototype), {
    sim: {
      playerId: pid,
      player: { pos: { x: 0, y: 0, z } },
      craftingIdentity: { synced: false },
      craftSkills: {},
      gatheringProficiency: {},
    },
    renderer: { handleEvent: vi.fn() },
    playEventSfx: vi.fn(),
    meters: { onEvent: vi.fn() },
    isNythraxisEvent: vi.fn(() => false),
    showBanner: vi.fn(),
    combatLog: vi.fn(),
    prevCraftSkills: null,
    craftTierUpDrains: 0,
  });
  return hud as typeof hud & { handleEvents(events: SimEvent[]): void };
}

afterEach(() => vi.restoreAllMocks());

describe('offline duel victory presentation', () => {
  it('shows a local victory and ignores one from another zone', () => {
    const sound = vi.spyOn(audio, 'duelEnd').mockImplementation(() => {});
    const local = hudAt(3, -175);
    const remote = hudAt(4, 185);

    local.handleEvents([victory]);
    remote.handleEvents([victory]);

    expect(local.showBanner).toHaveBeenCalledOnce();
    expect(local.combatLog).toHaveBeenCalledOnce();
    expect(remote.showBanner).not.toHaveBeenCalled();
    expect(remote.combatLog).not.toHaveBeenCalled();
    expect(remote.renderer.handleEvent).not.toHaveBeenCalled();
    expect(sound).toHaveBeenCalledOnce();
  });
});
