// The Esc-menu Wiki row's dispatch hop (options_window.ts renderMain). The pure
// core pin (options_view.test.ts) proves the row EXISTS with kind 'wiki', and
// wiki_link.test.ts proves what Hud.openWiki delegates to; this suite pins the
// hop between them: clicking the rendered row fires deps.openWiki exactly once,
// and the menu STAYS OPEN (the OptionsWindowDeps.openWiki contract: a Cancel on
// the confirm lands the player back where they were). Rig mirrors
// options_window_unstuck.test.ts (the sibling menu-row dispatch suite).

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/app_viewport', () => ({ syncAppViewport: vi.fn() }));
vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/game/music', () => ({
  music: { pauseForMenu: vi.fn(), resumeFromMenu: vi.fn() },
}));
vi.mock('../src/ui/app_version', () => ({
  appVersionInfo: () => ({ version: 'test', build: 'test' }),
}));

import { t } from '../src/ui/i18n';
import { OptionsWindow } from '../src/ui/options_window';

type Listener = () => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly style = { display: 'block' };
  readonly classList = {
    add: () => {},
    remove: () => {},
  };
  className = '';
  innerHTML = '';
  textContent: string | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  querySelector(_selector: string): FakeElement | null {
    return null;
  }

  setAttribute(_name: string, _value: string): void {}

  removeAttribute(_name: string): void {}

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }

  findButton(label: string): FakeElement | null {
    if (this.textContent === label) return this;
    for (const child of this.children) {
      const found = child.findButton(label);
      if (found) return found;
    }
    return null;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('options window wiki row', () => {
  it('fires deps.openWiki once from the rendered row and leaves the menu open', () => {
    const root = new FakeElement();
    const openWiki = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
    });
    const window = new OptionsWindow({
      root: () => root as unknown as HTMLElement,
      world: () => ({}) as never,
      options: () => null,
      bugReport: () => null,
      openWiki,
      hideTooltip: vi.fn(),
      restoreFocus: vi.fn(),
    } as never);

    (window as unknown as { renderMain(): void }).renderMain();
    const button = root.findButton(t('nav.wiki'));
    expect(button).not.toBeNull();

    button?.click();

    expect(openWiki).toHaveBeenCalledOnce();
    // The menu stays open: Cancel on the confirm returns the player here.
    expect(root.style.display).toBe('block');
  });
});
