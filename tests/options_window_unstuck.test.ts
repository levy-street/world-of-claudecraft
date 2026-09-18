import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/app_viewport', () => ({ syncAppViewport: vi.fn() }));
vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/game/music', () => ({
  music: { pauseForMenu: vi.fn(), resumeFromMenu: vi.fn() },
}));
vi.mock('../src/ui/app_version', () => ({
  appVersionInfo: () => ({ version: 'test', build: 'test' }),
}));

import { ClientWorld } from '../src/net/online';
import { t } from '../src/ui/i18n';
import { OptionsWindow } from '../src/ui/options_window';

type Listener = () => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly style = { display: 'block' };
  readonly classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
  };
  readonly dataset: Record<string, string> = {};
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

describe('options window unstuck action', () => {
  it('dispatches the active world command from the rendered button and closes immediately', () => {
    const root = new FakeElement();
    const unstuck = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
      // The main menu's touch gate also asks whether the native shell is up.
      body: { classList: { contains: () => false } },
    });
    // The main menu reads the touch probe (desktop here, so the Unlock
    // Interface row paints too) and the frame-editing seam.
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const window = new OptionsWindow({
      root: () => root as unknown as HTMLElement,
      world: () => ({ unstuck }) as never,
      options: () => null,
      bugReport: () => null,
      hideTooltip: vi.fn(),
      restoreFocus: vi.fn(),
      isInterfaceUnlocked: () => false,
      toggleInterfaceUnlock: () => false,
    } as never);

    (window as unknown as { renderMain(): void }).renderMain();
    const button = root.findButton(t('hudChrome.unstuck.menuButton'));
    expect(button).not.toBeNull();

    button?.click();

    expect(unstuck).toHaveBeenCalledOnce();
    expect(root.style.display).toBe('none');
  });

  it('routes the rendered button through the client unstuck wire command', () => {
    const root = new FakeElement();
    const cmd = vi.fn();
    const clientWorld = {
      unstuck: () => ClientWorld.prototype.unstuck.call({ cmd } as never),
    };
    vi.stubGlobal('document', {
      createElement: () => new FakeElement(),
      // The main menu's touch gate also asks whether the native shell is up.
      body: { classList: { contains: () => false } },
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const window = new OptionsWindow({
      root: () => root as unknown as HTMLElement,
      world: () => clientWorld as never,
      options: () => null,
      bugReport: () => null,
      hideTooltip: vi.fn(),
      restoreFocus: vi.fn(),
      isInterfaceUnlocked: () => false,
      toggleInterfaceUnlock: () => false,
    } as never);

    (window as unknown as { renderMain(): void }).renderMain();
    root.findButton(t('hudChrome.unstuck.menuButton'))?.click();

    expect(cmd).toHaveBeenCalledWith({ cmd: 'unstuck' });
    expect(root.style.display).toBe('none');
  });
});
