import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISCORD_CHOICE_KEY } from '../src/game/discord_login_choice';
import { EDITOR_PLAYTEST_KEY } from '../src/game/editor_playtest';
import { ENTRY_PROBE_KEY } from '../src/game/entry_crash_guard';
import { GRAPHICS_REBUILD_PROBE_KEY } from '../src/game/graphics_rebuild_crash_guard';
import {
  interfaceModeFromSetting,
  PHONE_TOUCH_QUERY,
  resolveTouchInterface,
} from '../src/game/mobile_controls';
import {
  type BootInputs,
  bootModeFor,
  GAME_NOW_SESSION_KEYS,
  GAME_NOW_STORED_KEYS,
  LANDING_PHONE_TOUCH_QUERY,
  landingTouchInterface,
} from '../src/ui/landing_first_core';

function inputs(over: Partial<BootInputs> = {}, stored: Record<string, string> = {}): BootInputs {
  return {
    pathname: '/',
    search: '',
    nativeApp: false,
    desktopApp: false,
    stored: (key) => stored[key] ?? null,
    session: () => null,
    ...over,
  };
}

describe('bootModeFor', () => {
  it('takes the landing-first boot on a plain first visit to the home page', () => {
    expect(bootModeFor(inputs())).toBe('landing');
    expect(bootModeFor(inputs({ pathname: '/index.html' }))).toBe('landing');
    // Marketing and referral parameters do not need the client before an interaction.
    expect(bootModeFor(inputs({ search: '?ref=friend&utm_source=x' }))).toBe('landing');
    expect(bootModeFor(inputs({ search: '?lang=en' }))).toBe('landing');
    expect(bootModeFor(inputs({}, { locale: 'en' }))).toBe('landing');
  });

  it('starts the client at once in the native and desktop shells', () => {
    expect(bootModeFor(inputs({ nativeApp: true }))).toBe('game');
    expect(bootModeFor(inputs({ desktopApp: true }))).toBe('game');
  });

  it('starts the client at once off the home page (e.g. /desktop-login)', () => {
    expect(bootModeFor(inputs({ pathname: '/desktop-login' }))).toBe('game');
  });

  it('starts the client at once for a reset link, the diagnostics run and boot=now', () => {
    expect(bootModeFor(inputs({ search: `?reset=${'a'.repeat(64)}` }))).toBe('game');
    expect(bootModeFor(inputs({ search: '?diagnostics=1&diagnosticsAuto=1' }))).toBe('game');
    expect(bootModeFor(inputs({ search: '?boot=now' }))).toBe('game');
  });

  it('starts the client for the release headless browser tools without waiting for a click', () => {
    expect(bootModeFor(inputs({ search: '?headless=1' }))).toBe('game');
  });

  it.each(['?map=example-world', '?editorPlaytest=transfer-token', '?boss=balgath'])(
    'starts the release direct-entry flow immediately for %s',
    (search) => {
      expect(bootModeFor(inputs({ search }))).toBe('game');
    },
  );

  it('starts the client at once for any language but English, from ?lang or the stored locale', () => {
    expect(bootModeFor(inputs({ search: '?lang=de_DE' }))).toBe('game');
    expect(bootModeFor(inputs({}, { locale: 'ja_JP' }))).toBe('game');
    expect(bootModeFor(inputs({}, { locale: 'en_CA' }))).toBe('game');
    // ?lang wins over the stored locale, as in src/ui/i18n.ts.
    expect(bootModeFor(inputs({ search: '?lang=en' }, { locale: 'fr_FR' }))).toBe('landing');
  });

  it('starts the client at once for a saved session, a pending login hand-off and a crash probe', () => {
    for (const key of GAME_NOW_STORED_KEYS) {
      expect(bootModeFor(inputs({}, { [key]: '1' })), key).toBe('game');
    }
    for (const key of GAME_NOW_SESSION_KEYS) {
      expect(bootModeFor(inputs({ session: (k) => (k === key ? '1' : null) })), key).toBe('game');
    }
  });

  it('names the keys their owners write', () => {
    // Literals here (the boot chunk must not import the client), pinned to the owners.
    const onlineTs = readFileSync(new URL('../src/net/online.ts', import.meta.url), 'utf8');
    const sessionKey = /private static readonly SESSION_KEY = '([^']+)'/.exec(onlineTs)?.[1];
    expect(GAME_NOW_STORED_KEYS).toEqual([
      sessionKey,
      DISCORD_CHOICE_KEY,
      ENTRY_PROBE_KEY,
      GRAPHICS_REBUILD_PROBE_KEY,
    ]);
    expect(GAME_NOW_SESSION_KEYS).toEqual([EDITOR_PLAYTEST_KEY]);
  });
});

describe('landing touch interface', () => {
  it('uses the same phone query as the touch controls', () => {
    expect(LANDING_PHONE_TOUCH_QUERY).toBe(PHONE_TOUCH_QUERY);
  });

  it('answers as resolveTouchInterface does for every Interface Mode', () => {
    for (const mode of [0, 1, 2]) {
      for (const phone of [false, true]) {
        expect(landingTouchInterface(mode, phone), `mode ${mode} phone ${phone}`).toBe(
          resolveTouchInterface(interfaceModeFromSetting(mode), phone),
        );
      }
    }
  });
});
