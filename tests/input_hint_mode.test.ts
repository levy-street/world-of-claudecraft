import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentInputHintMode, markPadActivity } from '../src/game/input_hint_mode';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('input hint mouse handoff', () => {
  it('ignores synthetic pad cursor moves and yields to a real mouse move', () => {
    const classes = new Set<string>();
    const listeners = new Map<string, EventListener>();
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: {
          classList: {
            add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name),
            contains: (name: string) => classes.has(name),
          },
        },
      },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          listeners.set(type, listener);
        }),
      },
    });

    markPadActivity();
    expect(currentInputHintMode()).toBe('pad');

    listeners.get('mousemove')?.({ isTrusted: false } as Event);
    expect(currentInputHintMode()).toBe('pad');

    listeners.get('mousemove')?.({ isTrusted: true } as Event);
    expect(currentInputHintMode()).toBe('keyboard');
  });
});
