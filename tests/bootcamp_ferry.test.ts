// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/characters/portrait', () => ({
  modularPortraitDataUrl: vi.fn(() => null),
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(() => null),
  portraitsReady: vi.fn(() => false),
  visualPortraitDataUrl: vi.fn(() => null),
}));

import { PROVING_SHORE_QUEST_ORDER } from '../src/sim/content/proving_shore';
import type { Entity } from '../src/sim/types';
import { BootcampOverlay } from '../src/ui/bootcamp';
import type { IWorld } from '../src/world_api';

describe('tutorial wrong-way nudges while sailing', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['offline', 'online'])('silences the voyage and resets the trail grace (%s)', (host) => {
    let now = 50000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    // Off the tutorial trail, with the first on-foot station available.
    const sim = {
      player: { pos: { x: -300, y: 0, z: 400 } } as Entity,
      questLog: new Map(),
      questState: (id: string) => (id === PROVING_SHORE_QUEST_ORDER[0] ? 'available' : null),
    } as unknown as IWorld;
    const coach = new BootcampOverlay();
    const internals = coach as unknown as {
      updateVeerNudge(world: IWorld): void;
      guideOffPathSince: number | null;
      speak(name: string, repeatable?: boolean): void;
    };
    const speak = vi.spyOn(internals, 'speak').mockImplementation(() => {});
    internals.updateVeerNudge(sim);
    expect(internals.guideOffPathSince).toBe(now);
    if (host === 'offline')
      sim.player.ferryRide = { route: 'ferry', from: 0, to: 1, ship: { x: 0, z: 0, rot: 0 } };
    else sim.player.ferryRiding = true;
    now += 6000;
    internals.updateVeerNudge(sim);
    expect(speak).not.toHaveBeenCalled();
    expect(internals.guideOffPathSince).toBeNull();
    now += 60000;
    internals.updateVeerNudge(sim);
    expect(speak).not.toHaveBeenCalled();
    delete sim.player.ferryRide;
    sim.player.ferryRiding = false;
    now += 1000;
    internals.updateVeerNudge(sim);
    expect(speak).not.toHaveBeenCalled();
    expect(internals.guideOffPathSince).toBe(now);
    now += 6000;
    internals.updateVeerNudge(sim);
    expect(speak).toHaveBeenCalledWith('veerOff', true);
  });
});
