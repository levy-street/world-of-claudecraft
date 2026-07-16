import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUSABLE_SELECTOR } from '../src/ui/focus_manager';

vi.mock('../src/game/mobile_controls', () => ({
  isNativeAppShell: () => false,
  useTouchInterface: () => false,
}));

import {
  cameraPromptOpen,
  dismissCameraPrompt,
  maybeShowFirstRunCameraPrompt,
} from '../src/ui/camera_prompt';

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  key?: string;
  shiftKey?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  isConnected = true;
  className = '';
  id = '';
  type = '';
  name = '';
  value = '';
  checked = false;
  textContent = '';
  title = '';
  private attrs = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();

  constructor(readonly tagName = 'div') {}

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    child.isConnected = this.isConnected;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    this.parentElement = null;
    this.setConnected(false);
  }

  private setConnected(connected: boolean): void {
    this.isConnected = connected;
    for (const child of this.children) child.setConnected(connected);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: FakeEvent = fakeEvent()): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    fakeDocument.activeElement = this;
  }

  getClientRects(): unknown[] {
    return this.isConnected ? [{}] : [];
  }

  contains(target: FakeElement | null): boolean {
    for (let node = target; node; node = node.parentElement) if (node === this) return true;
    return false;
  }

  matches(selector: string): boolean {
    return selector === '[data-close]' && this.attrs.has('data-close');
  }

  querySelectorAll(selector: string): FakeElement[] {
    const descendants = this.descendants();
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return descendants.filter((el) => el.className.split(/\s+/).includes(className));
    }
    if (selector === FOCUSABLE_SELECTOR)
      return descendants.filter((el) => el.tagName === 'input' || el.tagName === 'button');
    if (selector === 'input[type="radio"]')
      return descendants.filter((el) => el.tagName === 'input' && el.type === 'radio');
    if (selector === 'button') return descendants.filter((el) => el.tagName === 'button');
    return [];
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.descendants().find((el) => el.className.split(/\s+/).includes(className)) ?? null;
    }
    return this.querySelectorAll(selector)[0] ?? null;
  }

  private descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    const visit = (root: FakeElement): void => {
      for (const child of root.children) {
        out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }
}

function fakeEvent(): FakeEvent {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

const storage = new Map<string, string>();
const documentListeners = new Map<string, Listener>();
const fakeDocument = {
  body: new FakeElement('body'),
  activeElement: null as FakeElement | null,
  createElement: (tag: string) => new FakeElement(tag),
  addEventListener: (type: string, listener: Listener) => documentListeners.set(type, listener),
  removeEventListener: (type: string) => documentListeners.delete(type),
};
const fakeWindow = {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
  setTimeout: (run: () => void) => {
    run();
    return 0;
  },
};

beforeEach(() => {
  storage.clear();
  documentListeners.clear();
  fakeDocument.body = new FakeElement('body');
  fakeDocument.activeElement = null;
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('HTMLElement', FakeElement);
});

afterEach(() => {
  if (cameraPromptOpen()) dismissCameraPrompt();
  vi.unstubAllGlobals();
});

describe('first-run camera prompt DOM and state', () => {
  it('blocks while open, uses shared focus return, and clears state on confirmation', () => {
    const opener = new FakeElement('button');
    fakeDocument.activeElement = opener;
    const applied: boolean[] = [];

    maybeShowFirstRunCameraPrompt({ applyMouseCamera: (enabled) => applied.push(enabled) });

    expect(cameraPromptOpen()).toBe(true);
    expect(fakeDocument.activeElement?.className).toBe('camera-prompt-radio');
    const backdrop = fakeDocument.body.children[0];
    const confirm = backdrop.querySelector('.camera-prompt-confirm');
    expect(confirm).not.toBeNull();
    confirm?.dispatch('click');

    expect(applied).toEqual([false]);
    expect(cameraPromptOpen()).toBe(false);
    expect(fakeDocument.body.children).toEqual([]);
    expect(fakeDocument.activeElement).toBe(opener);
  });

  it('tabs from the selected camera radio directly to Confirm', () => {
    maybeShowFirstRunCameraPrompt({ applyMouseCamera: vi.fn() });

    const backdrop = fakeDocument.body.children[0];
    const radios = backdrop.querySelectorAll('input[type="radio"]');
    const confirm = backdrop.querySelector('.camera-prompt-confirm');
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    expect(fakeDocument.activeElement).toBe(radios[0]);

    const event = fakeEvent();
    event.key = 'Tab';
    event.shiftKey = false;
    documentListeners.get('keydown')?.(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fakeDocument.activeElement).toBe(confirm);
    expect(fakeDocument.activeElement).not.toBe(radios[1]);
  });

  it('puts Classic first with neutral copy and no recommended option', () => {
    maybeShowFirstRunCameraPrompt({ applyMouseCamera: vi.fn() });

    const backdrop = fakeDocument.body.children[0];
    const radios = backdrop.querySelectorAll('input[type="radio"]');
    const descriptions = backdrop
      .querySelectorAll('.camera-prompt-option-desc')
      .map((element) => element.textContent);

    expect(radios.map((radio) => radio.value)).toEqual(['classic', 'mouse']);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
    expect(descriptions).toEqual([
      'Hold right-click and move the mouse to turn the camera.',
      'Move the mouse to turn the camera without holding a button.',
    ]);
    expect(backdrop.querySelector('.camera-prompt-badge')).toBeNull();
    expect(descriptions.join(' ')).not.toMatch(/recommend|prefer|traditional/i);
  });
});

describe('camera prompt client integration', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  it('shares one gameplay gate across keyboard and gamepad actions', () => {
    expect(main).toContain('const gameplayInputBlocked = () =>');
    expect(main.match(/gameplayInputBlocked\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('suspends movement and enters gamepad pointer mode while the prompt is open', () => {
    expect(main).toMatch(/input\.setSuspendMovement\([^;]*cameraPromptOpen\(\)/);
    expect(main).toMatch(/isPointerMode: \(\) => hud\.isWindowOpen\(\) \|\| cameraPromptOpen\(\)/);
  });

  it('routes the gamepad Escape action to the prompt before HUD windows', () => {
    expect(main).toMatch(/if \(dismissCameraPrompt\(\)\) return;/);
  });
});
