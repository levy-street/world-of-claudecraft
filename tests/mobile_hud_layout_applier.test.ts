import { afterEach, describe, expect, it } from 'vitest';
import { setInterfaceMode } from '../src/game/mobile_controls';
import {
  applyMobileHudLayout,
  syncMobileMenuPlacement,
} from '../src/game/mobile_hud_layout_applier';

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
  stableWidth = 0;
  stableHeight = 0;
  getBoundingClientRect(): DOMRect {
    return {
      width: this.stableWidth,
      height: this.stableHeight,
    } as DOMRect;
  }
}

class FakeElement {
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  focused = false;

  constructor(readonly id: string) {}

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  insertBefore(node: FakeElement, before: FakeElement | null): FakeElement {
    if (node.parentElement) {
      const oldIndex = node.parentElement.children.indexOf(node);
      if (oldIndex >= 0) node.parentElement.children.splice(oldIndex, 1);
    }
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index >= 0 ? index : this.children.length, 0, node);
    node.parentElement = this;
    return node;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.insertBefore(node, null);
  }

  contains(node: unknown): boolean {
    return node === this || this.children.some((child) => child.contains(node));
  }

  focus(): void {
    this.focused = true;
  }
}

function menuDocument() {
  const combat = new FakeElement('mobile-combat-controls');
  const extra = new FakeElement('mobile-extra-grid');
  const chat = new FakeElement('mobile-chat');
  const bags = new FakeElement('mobile-bags');
  const social = new FakeElement('mobile-social');
  const quest = new FakeElement('mobile-quest');
  const menu = new FakeElement('mobile-menu');
  const more = new FakeElement('mobile-more');
  combat.append(chat, bags, social, quest, menu, more);
  const elements = new Map(
    [combat, extra, chat, social, quest, menu, more, bags].map((el) => [el.id, el]),
  );
  const document = {
    activeElement: null,
    getElementById: (id: string) => elements.get(id) ?? null,
  } as unknown as Document;
  return { document, combat, extra, social, menu, more };
}

function fakeWin(width: number, height: number, body: FakeBody) {
  return {
    innerWidth: width,
    innerHeight: height,
    matchMedia: () => ({ matches: false }),
    document: { body: body as unknown as HTMLElement, getElementById: () => null },
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

  it('keeps the active game tier on the stable root size while browser chrome resizes', () => {
    setInterfaceMode('touch');
    const body = new FakeBody();
    body.classList.add('game-active', 'mobile-touch');
    body.stableWidth = 1280;
    body.stableHeight = 500;

    applyMobileHudLayout(fakeWin(1280, 460, body));

    expect(body.classList.contains('hud-mobile-standard')).toBe(true);
    expect(body.classList.contains('hud-mobile-compact')).toBe(false);
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

describe('syncMobileMenuPlacement', () => {
  it('moves the same Social and Settings nodes to the start of More in compact mode', () => {
    const { document, combat, extra, social, menu } = menuDocument();

    syncMobileMenuPlacement(document, 'compact');

    expect(combat.children.map((el) => el.id)).toEqual([
      'mobile-chat',
      'mobile-bags',
      'mobile-quest',
      'mobile-more',
    ]);
    expect(extra.children.map((el) => el.id)).toEqual(['mobile-social', 'mobile-menu']);
    expect(extra.children[0]).toBe(social);
    expect(extra.children[1]).toBe(menu);
  });

  it('restores the full direct order and stays idempotent across repeated transitions', () => {
    const { document, combat, extra } = menuDocument();

    syncMobileMenuPlacement(document, 'compact');
    syncMobileMenuPlacement(document, 'compact');
    syncMobileMenuPlacement(document, 'full');
    syncMobileMenuPlacement(document, 'full');

    expect(combat.children.map((el) => el.id)).toEqual([
      'mobile-chat',
      'mobile-bags',
      'mobile-social',
      'mobile-quest',
      'mobile-menu',
      'mobile-more',
    ]);
    expect(extra.children.map((el) => el.id)).toEqual([]);
  });

  it('moves focus to More before compact placement hides a focused direct action', () => {
    const { document, social, more } = menuDocument();
    (document as unknown as { activeElement: FakeElement }).activeElement = social;

    syncMobileMenuPlacement(document, 'compact');

    expect(more.focused).toBe(true);
  });

  it('does nothing when a cached or partial shell omits one of the required nodes', () => {
    const document = { getElementById: () => null } as unknown as Document;
    expect(() => syncMobileMenuPlacement(document, 'compact')).not.toThrow();
  });
});
