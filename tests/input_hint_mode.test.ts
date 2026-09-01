import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPadActivity,
  currentInputHintMode,
  markPadActivity,
  PAD_ACTIVE_CLASS,
  registerInputHandoff,
} from '../src/game/input_hint_mode';

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
  it('releases pad ownership when the controller lifecycle ends', () => {
    const classes = new Set<string>();
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
      value: { addEventListener: vi.fn() },
    });

    const handoff = vi.fn();
    const unregister = registerInputHandoff(handoff);
    classes.add(PAD_ACTIVE_CLASS);
    clearPadActivity();

    expect(currentInputHintMode()).toBe('keyboard');
    expect(handoff).toHaveBeenCalledOnce();
    unregister();
  });

  it('keeps touch as the visible control family even after pad activity', () => {
    const classes = new Set<string>(['mobile-touch']);
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
    classes.add(PAD_ACTIVE_CLASS);

    expect(currentInputHintMode()).toBe('touch');
  });

  it('ignores synthetic events and yields ownership on every trusted non-pad input family', () => {
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

    const handoff = vi.fn();
    const unregister = registerInputHandoff(handoff);

    listeners.get('mousemove')?.({ isTrusted: false } as Event);
    expect(currentInputHintMode()).toBe('pad');
    expect(handoff).not.toHaveBeenCalled();

    listeners.get('mousemove')?.({ isTrusted: true } as Event);
    expect(currentInputHintMode()).toBe('keyboard');
    expect(handoff).toHaveBeenCalledTimes(1);

    for (const type of ['keydown', 'mousedown', 'pointerdown', 'pointermove', 'touchstart']) {
      markPadActivity();
      listeners.get(type)?.({ isTrusted: true } as Event);
      expect(currentInputHintMode(), type).toBe('keyboard');
    }
    expect(handoff).toHaveBeenCalledTimes(6);
    unregister();
  });
});
