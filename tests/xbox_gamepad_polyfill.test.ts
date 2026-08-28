import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

// The Xbox shell injects this file into the page at document-create; it is the
// only thing standing between the native pad read and navigator.getGamepads(),
// and it ships inside an MSIX where nothing else exercises it. Everything from
// the WebView message onward is plain JS, so stubbing window.chrome.webview
// runs the whole page-side path for real. Only the two native hops
// (Windows.Gaming.Input -> GamepadBridge -> PostWebMessageAsJson) are outside
// this test, and the payloads below are exactly what GamepadBridge.Serialize()
// emits.
const SOURCE = readFileSync(
  new URL('../xbox/WorldOfClaudecraft.Shell/Assets/gamepad-polyfill.js', import.meta.url),
  'utf8',
);

const realWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

type HostMessage = { t?: string; connected?: boolean; buttons?: boolean[]; axes?: number[] };
type PadListener = (event: { data: unknown }) => void;

interface Harness {
  events: string[];
  pads: () => (Gamepad | null)[];
  host: (message: unknown) => void;
}

/** Boot the polyfill against a stubbed WebView2 host. */
function boot(withHost = true): Harness {
  const listeners: PadListener[] = [];
  const events: string[] = [];
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  if (withHost) {
    win.chrome = {
      webview: {
        addEventListener(type: string, fn: PadListener) {
          if (type === 'message') listeners.push(fn);
        },
      },
    };
  }
  win.addEventListener('gamepadconnected', () => events.push('connected'));
  win.addEventListener('gamepaddisconnected', () => events.push('disconnected'));

  const nav: { getGamepads?: () => (Gamepad | null)[] } = {};
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });

  new Function(SOURCE)();

  return {
    events,
    pads: () => nav.getGamepads?.() ?? [],
    host: (message) => {
      for (const fn of listeners) fn({ data: message });
    },
  };
}

/** A 16-slot standard-mapping button frame with the given indices held. */
function frame(...down: number[]): HostMessage {
  const held = new Set(down);
  return {
    t: 'pad',
    connected: true,
    buttons: Array.from({ length: 16 }, (_, i) => held.has(i)),
    axes: [0, 0, 0, 0],
  };
}

afterEach(() => {
  if (realWindow) Object.defineProperty(globalThis, 'window', realWindow);
  else delete (globalThis as Record<string, unknown>).window;
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
});

describe('xbox gamepad polyfill', () => {
  it('installs getGamepads and reports nothing before the host speaks', () => {
    const h = boot();
    expect(h.pads().filter(Boolean)).toHaveLength(0);
    expect(h.events).toEqual([]);
  });

  it('does nothing at all outside the WebView2 shell', () => {
    // Same file, ordinary browser: it must not replace getGamepads, or a
    // desktop build that ever loaded it would lose its real controller.
    const h = boot(false);
    const { navigator } = globalThis as { navigator: { getGamepads?: unknown } };
    expect(navigator.getGamepads).toBeUndefined();
    expect(h.pads()).toEqual([]);
  });

  it('turns a host frame into a standard-mapping Gamepad', () => {
    const h = boot();
    // A held, left stick pushed fully up: the bridge negates the Y axis because
    // Windows.Gaming.Input and the Gamepad API disagree on its sign.
    h.host({ ...frame(0), axes: [0, -1, 0, 0] });

    const pad = h.pads()[0];
    expect(h.pads().filter(Boolean)).toHaveLength(1);
    expect(pad?.mapping).toBe('standard');
    expect(pad?.buttons).toHaveLength(16);
    expect(pad?.buttons[0].pressed).toBe(true);
    expect(pad?.buttons[0].value).toBe(1);
    expect(pad?.buttons[1].pressed).toBe(false);
    expect(pad?.axes[1]).toBe(-1);
    expect(pad?.timestamp).toBeGreaterThan(0);
    expect(h.events).toEqual(['connected']);
  });

  it('tracks button changes without re-announcing the pad', () => {
    const h = boot();
    h.host(frame(0));
    // B: the button that would tear the app down if the shell had not claimed
    // the KEY. It must still reach the page as a BUTTON.
    h.host(frame(1));

    expect(h.pads()[0]?.buttons[1].pressed).toBe(true);
    expect(h.pads()[0]?.buttons[0].pressed).toBe(false);
    expect(h.events).toEqual(['connected']);
  });

  it('releases every button and axis when the pad goes away mid press', () => {
    // The crash-latch case. The shell posts this exact message when it pauses
    // the feed (a render-process death, or a real unplug). Without the release
    // the page keeps the last-held stick forever and the character runs into a
    // wall with no button working, which is the bug this whole path exists for.
    const h = boot();
    h.host({ ...frame(0, 12), axes: [0.9, -0.9, 0, 0] });
    const pad = h.pads()[0];

    h.host({ t: 'pad', connected: false });

    expect(h.pads().filter(Boolean)).toHaveLength(0);
    expect(pad?.buttons.some((b) => b.pressed)).toBe(false);
    expect(pad?.axes.some((a) => a !== 0)).toBe(false);
    expect(h.events).toEqual(['connected', 'disconnected']);
  });

  it('re-announces on reconnect, which is how crash recovery re-arms', () => {
    const h = boot();
    h.host(frame(0));
    h.host({ t: 'pad', connected: false });
    h.host(frame(3));

    expect(h.events).toEqual(['connected', 'disconnected', 'connected']);
    expect(h.pads()[0]?.buttons[3].pressed).toBe(true);
  });

  it('ignores foreign, malformed, and partial messages', () => {
    const h = boot();
    // The host channel is shared, so anything that is not a pad frame must be
    // inert rather than throwing inside a listener the page cannot see.
    h.host({ t: 'other', connected: true, buttons: [true] });
    h.host(null);
    h.host('nonsense');
    expect(h.pads().filter(Boolean)).toHaveLength(0);

    h.host({ t: 'pad', connected: true });
    expect(h.pads()[0]?.axes).toEqual([0, 0, 0, 0]);
    expect(h.pads()[0]?.buttons.some((b) => b.pressed)).toBe(false);
  });
});
