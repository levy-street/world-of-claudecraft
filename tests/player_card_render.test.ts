// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYER_CARD_COLOR_TOKENS,
  type PlayerCardData,
  renderPlayerCardCanvas,
} from '../src/ui/hud/player_card/player_card';

const TOKEN_CSS = readFileSync('src/styles/tokens.css', 'utf8');

const TOKEN_VALUES: Record<
  (typeof PLAYER_CARD_COLOR_TOKENS)[keyof typeof PLAYER_CARD_COLOR_TOKENS],
  string
> = {
  '--color-player-card-bg-hi': 'rgb(42, 58, 72)',
  '--color-player-card-bg-lo': 'rgb(11, 11, 18)',
  '--border': 'rgb(76, 61, 35)',
  '--color-control-border': 'rgb(93, 73, 38)',
  '--color-accent': 'rgb(218, 165, 76)',
  '--gold-dim': 'rgb(154, 113, 45)',
  '--color-text-light': 'rgb(244, 235, 207)',
  '--color-text-muted': 'rgb(174, 164, 139)',
  '--color-keyline': 'rgb(4, 5, 7)',
  '--color-player-card-chip-ink': 'rgb(28, 20, 7)',
};

function data(characterImage: HTMLCanvasElement): PlayerCardData {
  return {
    name: 'Adventurer',
    className: 'Warrior',
    classColor: 'rgb(196, 116, 67)',
    level: 20,
    realm: 'Test Realm',
    characterImage,
    primaryStats: [],
    combatStats: [],
    gear: [],
    topPercent: null,
    balance: null,
    devTier: null,
    devMergedPrs: null,
    referralHandle: 'adventurer',
    referralCount: null,
    siteUrl: 'https://example.test',
  };
}

describe('player card canvas colors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('declares the three canvas-only palette tokens with shipping values', () => {
    // W12: explicit declarations keep the compositor from silently resolving an empty color.
    expect(TOKEN_CSS).toContain('--color-player-card-bg-hi: #2a3a48;');
    expect(TOKEN_CSS).toContain('--color-player-card-bg-lo: #0b0b12;');
    expect(TOKEN_CSS).toContain('--color-player-card-chip-ink: #1c1407;');
  });

  it('resolves every palette token and paints the backdrop gradient from it', async () => {
    const getPropertyValue = vi.fn(
      (name: string) => TOKEN_VALUES[name as keyof typeof TOKEN_VALUES],
    );
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue }));
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        width = 0;
        height = 0;
        set src(_value: string) {
          this.onerror?.();
        }
      },
    );

    const linearGradients: Array<{ addColorStop: ReturnType<typeof vi.fn> }> = [];
    const gradient = () => ({ addColorStop: vi.fn() });
    const context = {
      arcTo: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      createLinearGradient: vi.fn(() => {
        const value = gradient();
        linearGradients.push(value);
        return value;
      }),
      createRadialGradient: vi.fn(gradient),
      drawImage: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      scale: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const portrait = document.createElement('canvas');
    portrait.width = 240;
    portrait.height = 420;

    const result = await renderPlayerCardCanvas(data(portrait));

    expect(result.width).toBe(1200);
    expect(result.height).toBe(630);
    expect(getPropertyValue.mock.calls.map(([name]) => name)).toEqual(
      Object.values(PLAYER_CARD_COLOR_TOKENS),
    );
    expect(linearGradients[0]?.addColorStop).toHaveBeenNthCalledWith(
      1,
      0,
      TOKEN_VALUES['--color-player-card-bg-hi'],
    );
    expect(linearGradients[0]?.addColorStop).toHaveBeenNthCalledWith(
      2,
      1,
      TOKEN_VALUES['--color-player-card-bg-lo'],
    );
  });
});
