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
    });
    const window = new OptionsWindow({
      root: () => root as unknown as HTMLElement,
      world: () => ({ unstuck }) as never,
      options: () => null,
      bugReport: () => null,
      hideTooltip: vi.fn(),
      restoreFocus: vi.fn(),
    } as never);

    (window as unknown as { renderMain(): void }).renderMain();
    const button = root.findButton(t('hudChrome.unstuck.menuButton'));
    expect(button).not.toBeNull();

    button?.click();

    expect(unstuck).toHaveBeenCalledOnce();
    expect(root.style.display).toBe('none');
  });
});
