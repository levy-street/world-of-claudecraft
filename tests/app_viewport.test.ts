import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syncAppViewport } from '../src/game/app_viewport';

const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const rendererTs = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('../src/styles/base.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');

interface FakeWin {
  innerWidth: number;
  innerHeight: number;
  visualViewport:
    | {
        width: number;
        height: number;
        scale?: number;
        offsetLeft?: number;
        offsetTop?: number;
      }
    | undefined;
  matchMedia: (query: string) => { matches: boolean };
  document: {
    body: {
      classList: { contains: (c: string) => boolean };
    };
    documentElement: {
      style: { setProperty: (name: string, value: string) => void };
    };
  };
}

function fakeWin(opts: {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: {
    width: number;
    height: number;
    scale?: number;
    offsetLeft?: number;
    offsetTop?: number;
  };
  gameActive?: boolean;
  touch?: boolean;
  mobileTouch?: boolean;
}): { win: FakeWin; props: Record<string, string> } {
  const props: Record<string, string> = {};
  const win: FakeWin = {
    innerWidth: opts.innerWidth,
    innerHeight: opts.innerHeight,
    visualViewport: opts.visualViewport,
    matchMedia: () => ({ matches: !!opts.touch }),
    document: {
      body: {
        classList: {
          contains: (c: string) => {
            if (c === 'game-active') return !!opts.gameActive;
            if (c === 'mobile-touch') return opts.mobileTouch ?? !!opts.touch;
            return false;
          },
        },
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

  it('uses stable small-viewport units for an active touch game across browser chrome resizes', () => {
    const { win, props } = fakeWin({
      innerWidth: 1194,
      innerHeight: 905,
      visualViewport: { width: 1000, height: 700 },
      gameActive: true,
      touch: true,
    });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('100svw');
    expect(props['--app-vh']).toBe('100svh');

    win.innerHeight = 760;
    win.visualViewport = { width: 1194, height: 736 };
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('100svw');
    expect(props['--app-vh']).toBe('100svh');
  });

  it('uses the visible viewport for the portrait rotate prompt so Safari chrome does not cover it', () => {
    const { win, props } = fakeWin({
      innerWidth: 390,
      innerHeight: 844,
      visualViewport: { width: 390, height: 724 },
      gameActive: true,
      touch: true,
    });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('100svw');
    expect(props['--app-vh']).toBe('100svh');
  });

  it('keeps the stable portrait game viewport while the keyboard owns the visual viewport', () => {
    const { win, props } = fakeWin({
      innerWidth: 390,
      innerHeight: 844,
      visualViewport: { width: 390, height: 420 },
      gameActive: true,
      touch: true,
    });
    syncAppViewport(win as unknown as Window);
    expect(props['--app-vw']).toBe('100svw');
    expect(props['--app-vh']).toBe('100svh');
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

  it('uses the actual mobile-touch game state for a native shell override', () => {
    const { win, props } = fakeWin({
      innerWidth: 1194,
      innerHeight: 905,
      visualViewport: {
        width: 1194,
        height: 420,
        offsetLeft: 0,
        offsetTop: 151,
      },
      gameActive: true,
      touch: false,
      mobileTouch: true,
    });

    syncAppViewport(win as unknown as Window);

    expect(props['--app-vw']).toBe('100svw');
    expect(props['--app-vh']).toBe('100svh');
  });

  it('contains fixed HUD descendants in the stable mobile game root', () => {
    const bodyRule = mobileCss.match(/body\.mobile-touch\.game-active\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(bodyRule).toMatch(/position:\s*relative/);
    expect(bodyRule).toMatch(/transform:\s*translateZ\(0\)/);

    for (const selector of ['#game-canvas', '#nameplates']) {
      const rule = baseCss.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(rule, selector).toMatch(/left:\s*0/);
      expect(rule, selector).toMatch(/top:\s*0/);
    }
    const ui = baseCss.match(/#ui\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(ui).toMatch(/left:\s*0/);
    expect(ui).toMatch(/top:\s*0/);
    const controls =
      mobileCss.match(/body\.mobile-touch\.game-active #mobile-controls\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(controls).toMatch(/left:\s*0/);
    expect(controls).toMatch(/top:\s*0/);
  });

  it('does not manually translate or repeatedly scroll the game on visual viewport changes', () => {
    expect(baseCss).not.toContain('--app-vv-');
    expect(mobileCss).not.toContain('--app-vv-');
    expect(mainTs).not.toContain('syncVisualViewportOffset');
    expect(mainTs).not.toContain('createComposerBlurViewportRecovery');
    expect(mainTs).not.toContain('resetAppViewportScroll');
    expect(rendererTs).toContain('resolveViewportResize');
  });
});
