import { describe, expect, it } from 'vitest';
import {
  type ItemDetailModifierDocument,
  type ItemDetailModifierTarget,
  installItemDetailModifier,
} from '../src/ui/procedural_item_details';

class FakeTarget implements ItemDetailModifierTarget {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string, event: Partial<KeyboardEvent> = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as Event);
  }
}

function fixture() {
  const classes = new Set<string>();
  const windowTarget = new FakeTarget();
  const documentTarget = new FakeTarget() as FakeTarget & ItemDetailModifierDocument;
  Object.defineProperties(documentTarget, {
    hidden: { value: false, writable: true },
    body: {
      value: {
        classList: {
          toggle(name: string, force = !classes.has(name)) {
            if (force) classes.add(name);
            else classes.delete(name);
            return force;
          },
          remove(name: string) {
            classes.delete(name);
          },
        },
      },
    },
  });
  const dispose = installItemDetailModifier(documentTarget, windowTarget);
  return { classes, documentTarget, windowTarget, dispose };
}

describe('procedural item advanced detail modifier', () => {
  it('reveals ranges on Alt keydown and hides them on release', () => {
    const test = fixture();
    test.windowTarget.fire('keydown', { key: 'Alt', altKey: true });
    expect(test.classes.has('item-details-advanced')).toBe(true);
    test.windowTarget.fire('keyup', { key: 'Alt', altKey: false });
    expect(test.classes.has('item-details-advanced')).toBe(false);
  });

  it('recognizes Alt held while another key is pressed', () => {
    const test = fixture();
    test.windowTarget.fire('keydown', { key: 'A', altKey: true });
    expect(test.classes.has('item-details-advanced')).toBe(true);
  });

  it('clears a stuck modifier when the window loses focus', () => {
    const test = fixture();
    test.windowTarget.fire('keydown', { key: 'Alt', altKey: true });
    test.windowTarget.fire('blur');
    expect(test.classes.has('item-details-advanced')).toBe(false);
  });

  it('removes listeners and the body state on disposal', () => {
    const test = fixture();
    test.windowTarget.fire('keydown', { key: 'Alt', altKey: true });
    test.dispose();
    expect(test.classes.has('item-details-advanced')).toBe(false);
    test.windowTarget.fire('keydown', { key: 'Alt', altKey: true });
    expect(test.classes.has('item-details-advanced')).toBe(false);
    expect(test.windowTarget.listeners.get('keydown')?.size).toBe(0);
  });
});
