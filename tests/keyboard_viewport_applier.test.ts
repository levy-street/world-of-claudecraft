import { afterEach, describe, expect, it } from 'vitest';
import { applyMobileKeyboardViewport } from '../src/game/keyboard_viewport_applier';
import { setInterfaceMode } from '../src/game/mobile_controls';

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

  toggle(name: string, force: boolean): boolean {
    if (force) this.values.add(name);
    else this.values.delete(name);
    return force;
  }
}

afterEach(() => setInterfaceMode('auto'));

describe('applyMobileKeyboardViewport', () => {
  it('detects the keyboard against the stable game root when iOS also shrinks innerHeight', () => {
    setInterfaceMode('touch');
    const classList = new FakeClassList();
    classList.add('game-active', 'mobile-touch');
    const props = new Map<string, string>();
    const win = {
      innerHeight: 420,
      visualViewport: { height: 420 },
      matchMedia: () => ({ matches: false }),
      document: {
        body: {
          classList,
          getBoundingClientRect: () => ({ height: 844 }),
          style: { setProperty: (name: string, value: string) => props.set(name, value) },
        },
      },
    } as unknown as Window;

    applyMobileKeyboardViewport(win);

    expect(classList.contains('mobile-keyboard-open')).toBe(true);
    expect(props.get('--mobile-keyboard-visible-vh')).toBe('420px');
  });
});
