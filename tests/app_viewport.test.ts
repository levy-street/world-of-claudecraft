import { describe, expect, it } from 'vitest';
import { syncAppViewport } from '../src/game/app_viewport';

interface FakeWin {
  innerWidth: number;
  innerHeight: number;
  visualViewport: { width: number; height: number; scale?: number } | undefined;
  matchMedia: (query: string) => { matches: boolean };
  document: {
    body: { classList: { contains: (c: string) => boolean } };
    documentElement: { style: { setProperty: (name: string, value: string) => void } };
  };
}

function fakeWin(opts: {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: { width: number; height: number; scale?: number };
  gameActive?: boolean;
  touch?: boolean;
}): { win: FakeWin; props: Record<string, string> } {
  const props: Record<string, string> = {};
  const win: FakeWin = {
    innerWidth: opts.innerWidth,
    innerHeight: opts.innerHeight,
    visualViewport: opts.visualViewport,
    matchMedia: () => ({ matches: !!opts.touch }),
    document: {
      body: {
        classList: { contains: (c: string) => (c === 'game-active' ? !!opts.gameActive : false) },
      },
      documentElement: {
        style: {
          setProperty: (name, value) => {
            props[name] = value;
          },
        },
      },
    },
  };
  return { win, props };
}

describe('syncAppViewport', () => {
  it('writes --app-vw/--app-vh from the live viewport', () => {
    const { win, props } = fakeWin({ innerWidth: 1194, innerHeight: 905 });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('1194px');
    expect(props['--app-vh']).toBe('905px');
  });

  it('prefers visualViewport dimensions off the stable game viewport', () => {
    const { win, props } = fakeWin({
      innerWidth: 1194,
      innerHeight: 905,
      visualViewport: { width: 1000, height: 700 },
    });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('1000px');
    expect(props['--app-vh']).toBe('700px');
  });

  it('uses window inner dimensions on the stable (touch, game-active) viewport, ignoring visualViewport', () => {
    const { win, props } = fakeWin({
      innerWidth: 1194,
      innerHeight: 905,
      visualViewport: { width: 1000, height: 700 },
      gameActive: true,
      touch: true,
    });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('1194px');
    expect(props['--app-vh']).toBe('905px');
  });

  it('normalizes a stale scaled visual viewport after a landscape-to-portrait rotation', () => {
    const { win, props } = fakeWin({
      innerWidth: 844,
      innerHeight: 1827,
      visualViewport: { width: 844, height: 1827, scale: 390 / 844 },
      touch: true,
    });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('390px');
    expect(props['--app-vh']).toBe('844px');
  });

  it('rounds fractional visualViewport dimensions and floors at 1px', () => {
    const { win, props } = fakeWin({
      innerWidth: 0,
      innerHeight: 0,
      visualViewport: { width: 0.4, height: 0.6 },
    });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('1px');
    expect(props['--app-vh']).toBe('1px');
  });
});
