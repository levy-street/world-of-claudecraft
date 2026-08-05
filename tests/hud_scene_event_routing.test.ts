// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

interface SceneEventHudHarness {
  sim: {
    playerId: number;
    player: { pos: { x: number; z: number } };
    entities: Map<number, unknown>;
    craftingIdentity: { synced: boolean };
    craftSkills: Record<string, number>;
  };
  renderer: { handleEvent: ReturnType<typeof vi.fn> };
  playEventSfx: ReturnType<typeof vi.fn>;
  meters: { onEvent: ReturnType<typeof vi.fn> };
  isNythraxisEvent: ReturnType<typeof vi.fn>;
  sceneController: { onEvent: ReturnType<typeof vi.fn> };
  prevCraftSkills: Record<string, number> | null;
  craftTierUpDrains: number;
  handleEvents(events: SimEvent[]): void;
}

function harness(): SceneEventHudHarness {
  const hud = Object.create(Hud.prototype) as unknown as SceneEventHudHarness;
  hud.sim = {
    playerId: 17,
    player: { pos: { x: 0, z: 0 } },
    entities: new Map(),
    craftingIdentity: { synced: false },
    craftSkills: {},
  };
  hud.renderer = { handleEvent: vi.fn() };
  hud.playEventSfx = vi.fn();
  hud.meters = { onEvent: vi.fn() };
  hud.isNythraxisEvent = vi.fn(() => false);
  hud.sceneController = { onEvent: vi.fn() };
  hud.prevCraftSkills = null;
  hud.craftTierUpDrains = 0;
  return hud;
}

describe('HUD Last Bell scene event routing', () => {
  it('forwards every scene lifecycle and choice event to SceneHudController in order', () => {
    const hud = harness();
    const events = [
      { type: 'scene' },
      { type: 'sceneChoice' },
      { type: 'sceneChoiceResult' },
      { type: 'sceneSync' },
      { type: 'sceneChoiceSync' },
    ] as unknown as SimEvent[];

    hud.handleEvents(events);

    expect(hud.sceneController.onEvent.mock.calls.map(([event]) => event)).toEqual(events);
    expect(hud.renderer.handleEvent.mock.calls.map(([event]) => event)).toEqual(events);
  });
});
