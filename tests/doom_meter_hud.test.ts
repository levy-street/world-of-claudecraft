import { describe, expect, it, vi } from 'vitest';
import type { Entity } from '../src/sim/types';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

interface DoomMeterHudHarness {
  sim: { talentSpec: string | null };
  doomMeter: { paint: ReturnType<typeof vi.fn> };
  updateWarlockDoomMeter(player: Entity): number;
}

describe('Hud Warlock Doom meter integration', () => {
  it('drives the real Hud method from Fate Threads owned by the player', () => {
    const paint = vi.fn();
    const hud = Object.create(Hud.prototype) as unknown as DoomMeterHudHarness;
    hud.sim = { talentSpec: 'affliction' };
    hud.doomMeter = { paint };
    const player = {
      id: 7,
      auras: [
        {
          id: 'needle_of_fate',
          name: 'Fate Threads',
          kind: 'affliction_fate_threads',
          remaining: 12,
          duration: 12,
          value: 3,
          stacks: 3,
          sourceId: 7,
          school: 'shadow',
        },
      ],
    } as Entity;

    expect(hud.updateWarlockDoomMeter(player)).toBe(3);

    expect(paint).toHaveBeenCalledWith({
      affliction: true,
      auras: player.auras,
      fateThreads: 3,
    });
  });
});
