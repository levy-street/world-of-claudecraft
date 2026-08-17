// The renderer half of the desktop shell's window display mode: the capability
// probe the options row is gated on, BOTH bridge crossings (the boot reflection
// that mirrors the shell's real window state in, and the push that sends a
// player's choice out). The throttled gamepad-activity notify lives in
// tests/gamepad_activity_notify.test.ts.
//
// The mapping is the whole point of this file: the setting is numeric (1 =
// borderless, 0 = windowed) and the shell speaks a string union, so each
// crossing must translate exactly once and in the right direction. Both
// directions are asserted at both crossings, the push on the ARGUMENT the
// bridge actually receives, so a swapped ternary fails here rather than
// shipping as "the picker windows the game when you ask for fullscreen".

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  desktopDisplayModeSupported,
  pushDesktopDisplayMode,
  syncDesktopDisplayModeSetting,
} from '../src/game/desktop_display_mode_sync';
import { GRAPHICS_REBUILD_KEYS } from '../src/game/graphics_rebuild_core';
import { Settings } from '../src/game/settings';
import type { DesktopBridge, DesktopDisplayMode } from '../src/runtime';
import { buildGraphicsSections, optionsControlKeys } from '../src/ui/options_view';
import { stripComments } from './helpers/strip_comments';

// A settings FACTORY double. It records every write, so "wrote nothing" is
// provable rather than inferred from a value that happened to match the
// default, and counts constructions, because when the store is built is itself
// load-bearing (Settings snapshots localStorage in its constructor).
function fakeSettingsFactory() {
  const writes: { key: string; value: number }[] = [];
  let constructed = 0;
  const create = () => {
    constructed += 1;
    return {
      set(key: 'displayMode', value: number): number {
        writes.push({ key, value });
        return value;
      },
    };
  };
  return { writes, create, constructions: () => constructed };
}

// Only the members these modules read; the rest of DesktopBridge is irrelevant
// here, so the double is cast at the one boundary instead of stubbing 20 methods.
function fakeBridge(members: Partial<DesktopBridge>): DesktopBridge {
  return members as DesktopBridge;
}

// Records the mode string the shell is handed, which is the only observable the
// push has: the write is fire-and-forget by design.
function recordingWriteBridge(): { bridge: DesktopBridge; received: DesktopDisplayMode[] } {
  const received: DesktopDisplayMode[] = [];
  return {
    received,
    bridge: fakeBridge({
      setDisplayMode: async (mode: DesktopDisplayMode) => {
        received.push(mode);
        return true;
      },
    }),
  };
}

describe('desktop_display_mode_sync: capability probe', () => {
  it('requires BOTH bridge methods (a half-updated or older shell keeps the browser toggle)', () => {
    const get = async (): Promise<DesktopDisplayMode> => 'borderless';
    const set = async () => true;
    expect(
      desktopDisplayModeSupported(fakeBridge({ getDisplayMode: get, setDisplayMode: set })),
    ).toBe(true);
    // each half alone is not enough: the row would either not read or not write
    expect(desktopDisplayModeSupported(fakeBridge({ getDisplayMode: get }))).toBe(false);
    expect(desktopDisplayModeSupported(fakeBridge({ setDisplayMode: set }))).toBe(false);
    expect(desktopDisplayModeSupported(fakeBridge({}))).toBe(false);
  });

  it('answers false without a bridge at all (the web build and offline play)', () => {
    expect(desktopDisplayModeSupported(null)).toBe(false);
    expect(desktopDisplayModeSupported(undefined)).toBe(false);
  });

  it('rejects non-function members (a shell exposing the names as data)', () => {
    const bogus = {
      getDisplayMode: 'borderless',
      setDisplayMode: true,
    } as unknown as DesktopBridge;
    expect(desktopDisplayModeSupported(bogus)).toBe(false);
  });
});

describe('desktop_display_mode_sync: options write push', () => {
  it('hands the shell the mode it was given, in BOTH directions', () => {
    const { bridge, received } = recordingWriteBridge();
    pushDesktopDisplayMode(bridge, 'borderless');
    expect(received).toEqual(['borderless']);
    pushDesktopDisplayMode(bridge, 'windowed');
    // nothing inverted, nothing dropped: the second push is its own message
    expect(received).toEqual(['borderless', 'windowed']);
  });

  it('writes nothing when the shell has no setter (an older installed shell)', () => {
    const reads: string[] = [];
    const bridge = fakeBridge({
      getDisplayMode: async () => {
        reads.push('read');
        return 'borderless';
      },
    });
    expect(() => pushDesktopDisplayMode(bridge, 'windowed')).not.toThrow();
    // and it does not fall back to some other bridge member instead
    expect(reads).toEqual([]);
  });

  it('does nothing without a bridge at all (the web build)', () => {
    expect(() => pushDesktopDisplayMode(null, 'borderless')).not.toThrow();
    expect(() => pushDesktopDisplayMode(undefined, 'windowed')).not.toThrow();
  });

  it('swallows a rejected write instead of throwing into the options window', async () => {
    const bridge = fakeBridge({
      setDisplayMode: async () => {
        throw new Error('window was destroyed');
      },
    });
    expect(() => pushDesktopDisplayMode(bridge, 'windowed')).not.toThrow();
    // drain the microtask queue: an unswallowed rejection would surface here
    await Promise.resolve();
    await Promise.resolve();
  });

  it('survives a shell that throws synchronously (a torn-down IPC channel)', () => {
    const bridge = fakeBridge({
      setDisplayMode: (() => {
        throw new Error('render frame was disposed');
      }) as () => Promise<boolean>,
    });
    expect(() => pushDesktopDisplayMode(bridge, 'borderless')).not.toThrow();
  });

  it('writes through the bridge as its receiver (a preload object using `this`)', () => {
    const received: DesktopDisplayMode[] = [];
    const bridge = {
      sink: received,
      async setDisplayMode(
        this: { sink: DesktopDisplayMode[] },
        mode: DesktopDisplayMode,
      ): Promise<boolean> {
        this.sink.push(mode);
        return true;
      },
    } as unknown as DesktopBridge;
    pushDesktopDisplayMode(bridge, 'windowed');
    expect(received).toEqual(['windowed']);
  });
});

describe('desktop_display_mode_sync: boot reflection', () => {
  it("maps a stored 'borderless' to the setting 1", async () => {
    const settings = fakeSettingsFactory();
    await syncDesktopDisplayModeSetting(
      fakeBridge({ getDisplayMode: async () => 'borderless' }),
      settings.create,
    );
    expect(settings.writes).toEqual([{ key: 'displayMode', value: 1 }]);
  });

  it("maps a stored 'windowed' to the setting 0", async () => {
    const settings = fakeSettingsFactory();
    await syncDesktopDisplayModeSetting(
      fakeBridge({ getDisplayMode: async () => 'windowed' }),
      settings.create,
    );
    expect(settings.writes).toEqual([{ key: 'displayMode', value: 0 }]);
  });

  it('builds the settings store only AFTER the bridge read has resolved', async () => {
    // Settings snapshots localStorage in its constructor and save() rewrites the
    // whole blob, so a store built before the round trip would revert any write
    // that landed during it (the first-run graphics preset, the entry-crash
    // safe-preset step-down). The order log is what proves the ordering: a
    // constructor call before the await would read ['built', 'resolved'].
    const order: string[] = [];
    const settings = fakeSettingsFactory();
    await syncDesktopDisplayModeSetting(
      fakeBridge({
        getDisplayMode: async () => {
          // yield first, so construction before the await is observable
          await Promise.resolve();
          order.push('resolved');
          return 'windowed';
        },
      }),
      () => {
        order.push('built');
        return settings.create();
      },
    );
    expect(order).toEqual(['resolved', 'built']);
    expect(settings.constructions()).toBe(1);
    expect(settings.writes).toEqual([{ key: 'displayMode', value: 0 }]);
  });

  it('never builds a store when the shell has no getter (an older installed shell)', async () => {
    const settings = fakeSettingsFactory();
    await syncDesktopDisplayModeSetting(
      fakeBridge({ setDisplayMode: async () => true }),
      settings.create,
    );
    expect(settings.constructions()).toBe(0);
    expect(settings.writes).toEqual([]);
  });

  it('never builds a store without a bridge (the web build)', async () => {
    const settings = fakeSettingsFactory();
    await syncDesktopDisplayModeSetting(null, settings.create);
    expect(settings.constructions()).toBe(0);
    expect(settings.writes).toEqual([]);
  });

  it('swallows a rejected read, building nothing and leaving the setting alone', async () => {
    const settings = fakeSettingsFactory();
    await expect(
      syncDesktopDisplayModeSetting(
        fakeBridge({
          getDisplayMode: async () => {
            throw new Error('prefs store unavailable');
          },
        }),
        settings.create,
      ),
    ).resolves.toBeUndefined();
    expect(settings.constructions()).toBe(0);
    expect(settings.writes).toEqual([]);
  });

  it('ignores an answer outside the union instead of coercing it', async () => {
    // The shell is an independently updated binary. A mode name this build does
    // not know ('full' from a newer shell), a truthy non-string, and a missing
    // answer must all leave the stored setting alone: coercing any of them would
    // silently resize the player's window on the next options interaction.
    for (const bogus of ['full', 'fullscreen', '', true, 1, 0, undefined, null]) {
      const settings = fakeSettingsFactory();
      await syncDesktopDisplayModeSetting(
        fakeBridge({
          getDisplayMode: (async () => bogus) as unknown as () => Promise<DesktopDisplayMode>,
        }),
        settings.create,
      );
      expect(settings.constructions(), `answer ${String(bogus)} must write nothing`).toBe(0);
      expect(settings.writes).toEqual([]);
    }
  });

  it('reads through the bridge as its receiver (a preload object using `this`)', async () => {
    const settings = fakeSettingsFactory();
    const bridge = {
      mode: 'windowed' as DesktopDisplayMode,
      async getDisplayMode(this: { mode: DesktopDisplayMode }): Promise<DesktopDisplayMode> {
        return this.mode;
      },
    } as unknown as DesktopBridge;
    await syncDesktopDisplayModeSetting(bridge, settings.create);
    expect(settings.writes).toEqual([{ key: 'displayMode', value: 0 }]);
  });
});

// The module suites above prove each crossing in isolation; these pins prove the
// composition roots actually WIRE them. The house pattern for desktop wiring
// (tests/desktop_gpu_pref_sync.test.ts, tests/client_shell.test.ts): textual
// pins on the composition lines, because a wiring edit is exactly the
// regression the module suite cannot see.
describe('desktop_display_mode_sync: wiring pins', () => {
  // Strip comments before matching via the shared single-pass helper
  // (tests/helpers/strip_comments.ts): a commented-out composition line must
  // never satisfy a positive pin, and a bare /* inside a line comment (the
  // src/main.ts:3144 hazard class) must never open a phantom block that
  // swallows the wiring these pins anchor on.
  const mainSource = stripComments(readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8'));
  const optionsWindowSource = stripComments(
    readFileSync(join(__dirname, '..', 'src', 'ui', 'options_window.ts'), 'utf8'),
  );

  it('gates the options row on the bridge CAPABILITY, never on the native-shell flag', () => {
    // isNativeAppShell() is true in the mobile Capacitor shells too, and true for
    // a desktop shell too old to have display modes: either substitution renders
    // a picker that cannot move a window.
    expect(optionsWindowSource).toContain(
      'desktopDisplayMode: desktopDisplayModeSupported(desktopBridge()),',
    );
    expect(optionsWindowSource).not.toContain('desktopDisplayMode: isNativeAppShell(');
  });

  it('boots the reflection with the live-or-fresh settings factory, desktop-gated', () => {
    // The factory resolution is load-bearing twice over: it must construct the
    // fresh snapshot AFTER the await (hoisting `new Settings()` outside the
    // call re-creates the pre-await snapshot bug), and it must answer with the
    // LIVE long-lived store once startGame has built one, or that store's next
    // unrelated save() reverts the reflected value (the fast-entry boot race;
    // the behavior half is the race suite below).
    expect(mainSource).toContain(
      'const settingsForShellReflection = (): Settings => liveSettings ?? new Settings();',
    );
    expect(mainSource).toContain(
      'if (DESKTOP_APP) void syncDesktopDisplayModeSetting(desktopBridge(), settingsForShellReflection);',
    );
    // startGame publishes its long-lived store into the holder the factory reads.
    expect(mainSource).toContain('liveSettings = settings;');
  });

  it('routes the options picker through the push, both polarities in one statement', () => {
    // Pinned whole: a swapped ternary (or a flipped comparison) would send
    // 'windowed' for the borderless choice, which is exactly the bug the module
    // suite cannot see because it never reads main.ts.
    expect(mainSource).toContain(
      "pushDesktopDisplayMode(desktopBridge(), v >= 0.5 ? 'borderless' : 'windowed');",
    );
  });

  it('stops asking the browser for fullscreen once the shell owns the window', () => {
    // Sliced to the function body so the pin cannot be satisfied by the same
    // words appearing in some other function; pinned whole so a dropped `!`
    // (which would invert the guard and break the web build instead) reds.
    const start = mainSource.indexOf('function requestPreferredFullscreen(): void {');
    expect(start).toBeGreaterThan(-1);
    const body = mainSource.slice(start, mainSource.indexOf('\n}', start));
    expect(body).toContain('if (desktopDisplayModeSupported(desktopBridge())) return;');
    expect(body).not.toContain('if (!desktopDisplayModeSupported(desktopBridge())) return;');
    // The pre-existing arms are untouched: mobile still gets the landscape path
    // and the browser build still reads the fullscreen setting.
    expect(body).toContain('if (NATIVE_APP) return;');
    expect(body).toContain(
      "if (new Settings().get('fullscreen') >= 0.5) requestBrowserFullscreen();",
    );
  });

  it('leaves the browser fullscreen arm exactly as it was', () => {
    // The web and mobile hosts keep the old key and the old behavior; the
    // desktop row is a second setting, not a rename of this one.
    expect(mainSource).toContain(
      'v >= 0.5 ? requestPreferredFullscreen() : exitBrowserFullscreen();',
    );
  });
});

// The boot race the live-or-fresh factory closes, display-mode twin of the
// suite in tests/desktop_gpu_pref_sync.test.ts: a reflection resolving AFTER
// the long-lived Settings exists must land in that instance, or its next
// unrelated whole-blob save() reverts the reflected mode.
describe('desktop_display_mode_sync: fast-entry boot race', () => {
  const installStorage = (): void => {
    const map = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return map.size;
      },
      key: (index: number) => Array.from(map.keys())[index] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  };

  it('a reflection resolving after the live store exists lands in it and survives an unrelated set()', async () => {
    installStorage();
    let live: Settings | null = null;
    let resolveRead: (mode: DesktopDisplayMode) => void = () => {};
    const read = new Promise<DesktopDisplayMode>((resolve) => {
      resolveRead = resolve;
    });
    const pending = syncDesktopDisplayModeSetting(
      fakeBridge({ getDisplayMode: () => read }),
      () => live ?? new Settings(),
    );
    // The fast entry: the long-lived store is built while the read is in flight.
    live = new Settings();
    resolveRead('windowed'); // the shell's real window state, off the default 1
    await pending;
    expect(live.get('displayMode')).toBe(0);
    // The revert scenario the race used to allow: an unrelated later write on
    // the live store must not roll the reflected mode back to borderless.
    live.set('showFps', true);
    expect(new Settings().get('displayMode')).toBe(0);
    expect(new Settings().get('showFps')).toBe(true);
  });
});

// Interface "Reset to Defaults" re-applies every RENDERED key through
// onSettingChange, so on a desktop shell the reset click pushes displayMode's
// default (1 = borderless) at the shell: a player who chose Windowed and clicks
// Reset is put back into borderless fullscreen. ACCEPTED DOCTRINE, the same one
// the GPU preference row carries: reset means defaults, and this row resets like
// every other rendered row. This test is the coupling pin; changing the behavior
// means rewriting it consciously.
describe('desktop_display_mode_sync: Reset to Defaults re-arms borderless', () => {
  const installStorage = (): void => {
    const map = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return map.size;
      },
      key: (index: number) => Array.from(map.keys())[index] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
    };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  };

  it('displayMode is a rendered, non-rebuild key, so the real footer reset reaches it', () => {
    // The footer's resetGraphicsDraft path is: optionsControlKeys(rendered
    // controls) filtered through the GRAPHICS_REBUILD_KEYS set, then
    // settings.reset + onSettingChange per survivor. Re-derive BOTH inputs
    // from the real builders so this cannot go constant-true: dropping the
    // row from the desktop Display card, or moving displayMode into the
    // rebuild set, must each red here.
    installStorage();
    const settings = new Settings();
    const source = {
      num: (key: string) => settings.get(key as never) as number,
      bool: (key: string) => Boolean(settings.get(key as never)),
      range: () => ({ min: 0, max: 1 }),
    };
    const sections = buildGraphicsSections(source, {
      touch: false,
      nativeShell: false,
      desktopDisplayMode: true,
    });
    const rendered = optionsControlKeys(sections.flatMap((section) => section.controls));
    const rebuild = new Set<string>(GRAPHICS_REBUILD_KEYS);
    const liveKeys = rendered.filter((key) => !rebuild.has(key));
    expect(rendered, 'the desktop Display card must render the row').toContain('displayMode');
    expect(liveKeys, 'the reset filter must let displayMode through').toContain('displayMode');
  });

  it('reset restores the default 1 and the re-apply pushes borderless', () => {
    installStorage();
    const settings = new Settings();
    expect(settings.set('displayMode', 0)).toBe(0);
    settings.reset(['displayMode']);
    expect(settings.get('displayMode'), 'reset must restore the doctrinal default').toBe(1);
    // The footer's re-apply lands in the main.ts arm pinned above, which is
    // exactly this call shape: the committed value in, the mapping inside.
    const { bridge, received } = recordingWriteBridge();
    const v = settings.get('displayMode');
    pushDesktopDisplayMode(bridge, v >= 0.5 ? 'borderless' : 'windowed');
    expect(received, 'the reset click re-arms borderless in the shell').toEqual(['borderless']);
  });
});
