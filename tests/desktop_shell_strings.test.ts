import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELL_STRINGS } from '../electron/shell_strings.cjs';
import {
  desktopShellStringsPayload,
  repushWhenLocaleResident,
} from '../src/game/desktop_shell_strings';

// Cross-boundary contract: the renderer pushes t()-localized strings for the
// main process's crash dialogs (desktop-set-strings). The payload must cover
// exactly the keys electron/shell_strings.cjs knows, and in English the pushed
// values must MATCH the electron-side defaults, so the pre-push fallback (a
// crash before the client booted) reads identically to the first push.
describe('desktopShellStringsPayload', () => {
  it('covers exactly the DEFAULT_SHELL_STRINGS keys', () => {
    expect(Object.keys(desktopShellStringsPayload()).sort()).toEqual(
      Object.keys(DEFAULT_SHELL_STRINGS).sort(),
    );
  });

  it('matches the electron-side English defaults value for value', () => {
    const payload = desktopShellStringsPayload();
    for (const [key, value] of Object.entries(DEFAULT_SHELL_STRINGS)) {
      expect(payload[key], key).toBe(value);
    }
  });
});

// The first push happens at client-entry evaluation, when only English is
// resident; a stored non-en locale finishes loading asynchronously and the
// boot load fires no woc:languagechange, so the module must re-push on its own
// once the table lands (or non-English players keep English crash dialogs).
describe('repushWhenLocaleResident', () => {
  it('re-pushes once a non-resident boot locale finishes loading', async () => {
    let pushes = 0;
    let resolveLoad: () => void = () => {};
    const load = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    repushWhenLocaleResident(
      () => {
        pushes += 1;
      },
      'ru_RU',
      { isLocaleResident: () => false, ensureLocaleLoaded: () => load },
    );
    expect(pushes).toBe(0);
    resolveLoad();
    await load;
    await Promise.resolve();
    expect(pushes).toBe(1);
  });

  it('no-ops when the locale is already resident (English boot)', () => {
    let pushes = 0;
    repushWhenLocaleResident(
      () => {
        pushes += 1;
      },
      'en',
      {
        isLocaleResident: () => true,
        ensureLocaleLoaded: () => {
          throw new Error('must not load');
        },
      },
    );
    expect(pushes).toBe(0);
  });

  it('keeps the English defaults when the chunk load fails', async () => {
    let pushes = 0;
    repushWhenLocaleResident(
      () => {
        pushes += 1;
      },
      'ru_RU',
      {
        isLocaleResident: () => false,
        ensureLocaleLoaded: () => Promise.reject(new Error('offline')),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pushes).toBe(0);
  });
});
