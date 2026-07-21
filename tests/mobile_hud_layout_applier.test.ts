import { afterEach, describe, expect, it } from 'vitest';
import { setInterfaceMode } from '../src/game/mobile_controls';
import { applyMobileHudLayout } from '../src/game/mobile_hud_layout_applier';

// Hand-rolled fake DOM (the tests/CLAUDE.md idiom: no jsdom). Models only the
// contract applyMobileHudLayout touches: classList add/remove/contains and
// style.setProperty on document.body, plus innerWidth/innerHeight + matchMedia
// on window.
class FakeClassList {
  private values = new Set<string>();
  add(...names: string[]): void {
    for (const name of names) this.values.add(name);
  }
  remove(...names: string[]): void {
    for (const name of names) this.values.delete(name);
  }
  contains(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeBody {
  classList = new FakeClassList();
  styleProps = new Map<string, string>();
  style = {
    setProperty: (name: string, value: string) => {
      this.styleProps.set(name, value);
    },
  };
}

function fakeWin(width: number, height: number, body: FakeBody) {
  return {
    innerWidth: width,
    innerHeight: height,
    matchMedia: () => ({ matches: false }),
    document: { body: body as unknown as HTMLElement },
  } as unknown as Window;
}

const previousGlobalDocument = globalThis.document;

afterEach(() => {
  setInterfaceMode('auto');
  Object.defineProperty(globalThis, 'document', {
    value: previousGlobalDocument,
    configurable: true,
  });
});

describe('applyMobileHudLayout', () => {
  it('applies no tier class on desktop (touch mode off)', () => {
    setInterfaceMode('desktop');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.classList.contains('hud-mobile-standard')).toBe(false);
    expect(body.classList.contains('hud-mobile-compact')).toBe(false);
    expect(body.classList.contains('hud-mobile-tablet')).toBe(false);
  });

  it('applies the resolved tier class in touch mode', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1920, 1080, body));
    expect(body.classList.contains('hud-mobile-tablet')).toBe(true);
    expect(body.classList.contains('hud-mobile-compact')).toBe(false);
    expect(body.classList.contains('hud-mobile-standard')).toBe(false);
  });

  it('drops the old tier class when the tier changes across two calls', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1920, 1080, body));
    expect(body.classList.contains('hud-mobile-tablet')).toBe(true);

    applyMobileHudLayout(fakeWin(844, 390, body));
    expect(body.classList.contains('hud-mobile-tablet')).toBe(false);
    expect(body.classList.contains('hud-mobile-compact')).toBe(true);
  });

  it('mirrors mobile-window-open / mobile-chat-open into hud-menu-open / hud-chat-open', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    body.classList.add('mobile-window-open');
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.classList.contains('hud-menu-open')).toBe(true);
    expect(body.classList.contains('hud-chat-open')).toBe(false);

    body.classList.remove('mobile-window-open');
    body.classList.add('mobile-chat-open');
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.classList.contains('hud-menu-open')).toBe(false);
    expect(body.classList.contains('hud-chat-open')).toBe(true);
  });

  it('sets the safe-area css vars on body.style', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    applyMobileHudLayout(fakeWin(1280, 720, body));
    expect(body.styleProps.get('--mobile-hud-safe-top')).toBe('0px');
    expect(body.styleProps.get('--mobile-hud-safe-left')).toBe('0px');
  });

  it('applies a tier class inside the native app shell even when useTouchInterface is false', () => {
    // Desktop interface mode (or a desktop-shaped auto-detect) makes
    // useTouchInterface() false, but the packaged native app shell (see
    // isNativeAppShell in mobile_controls.ts) forces touch UI on top of that:
    // main.ts adds body.classList 'native-app' for the Capacitor build. The
    // applier must OR in isNativeAppShell(), same as MobileControls.start()/
    // refreshInterfaceMode() do, or the native shell gets the empty layout.
    setInterfaceMode('desktop');
    const body = new FakeBody();
    body.classList.add('native-app');
    // isNativeAppShell() reads the GLOBAL document (it runs unparameterized,
    // same as production main.ts/mobile_controls.ts call sites), so stub it
    // separately from the injected fakeWin used for viewport/body writes.
    Object.defineProperty(globalThis, 'document', {
      value: { body },
      configurable: true,
    });
    applyMobileHudLayout(fakeWin(390, 844, body));
    expect(body.classList.contains('hud-mobile-compact')).toBe(true);
  });
});
