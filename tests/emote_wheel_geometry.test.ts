// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '../src/ui/hud';

vi.mock('../src/render/characters', () => ({ CharacterPreview: class {} }));
vi.mock('../src/render/characters/assets', () => ({ preloadMechAssets: vi.fn() }));
vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(),
  visualPortraitDataUrl: vi.fn(),
}));

interface EmoteWheelHarness {
  emoteWheelEl: HTMLDivElement | null;
  emoteWheelOpen: boolean;
  emoteWheelPinned: boolean;
  emoteWheelHover: string | null;
  emoteWheelSlots: string[];
  showEmoteWheel(pinned?: boolean): void;
  updateEmoteWheelPointer(x: number, y: number): void;
}

describe('Hud emote wheel geometry', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
  });

  it('places eight seats at the input ring radius and selects the pointed seat', () => {
    const hud = Object.create(Hud.prototype) as unknown as EmoteWheelHarness;
    hud.emoteWheelEl = null;
    hud.emoteWheelOpen = false;
    hud.emoteWheelPinned = false;
    hud.emoteWheelHover = null;
    hud.emoteWheelSlots = ['wave', 'laugh', 'question', 'cheer', 'dance', 'point', 'flex', 'cry'];

    hud.showEmoteWheel();

    const wheel = document.getElementById('emote-wheel') as HTMLDivElement;
    expect(hud.emoteWheelEl).toBe(wheel);
    wheel.getBoundingClientRect = () =>
      ({
        x: 20,
        y: 30,
        left: 20,
        top: 30,
        right: 350,
        bottom: 360,
        width: 330,
        height: 330,
        toJSON: () => ({}),
      }) as DOMRect;
    const seats = Array.from(wheel.querySelectorAll<HTMLElement>('.emote-wheel-item'));

    // W12: rendered seats and pointer selection share the approved 92px radial geometry.
    expect(seats).toHaveLength(8);
    expect(Number(seats[0]?.style.left.match(/([\d.e+-]+)px/)?.[1])).toBeCloseTo(0);
    expect(Number(seats[0]?.style.top.match(/([\d.e+-]+)px/)?.[1])).toBe(-92);
    hud.updateEmoteWheelPointer(185, 103);
    expect(hud.emoteWheelHover).toBe('wave');
    expect(seats[0]?.classList.contains('selected')).toBe(true);
    expect(seats.slice(1).every((seat) => !seat.classList.contains('selected'))).toBe(true);
  });
});
