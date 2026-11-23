// The "Dungeon mechanic hints" option (Options > Interface > Combat,
// settings.showDungeonHints) as a SETTING: its default, persistence and place
// in the settings export, its declarative options row, and the fairness pin:
// it is a player-chosen interface preference, independent of every graphics
// preset (docs/design/graphics-settings-fairness.md). What it hides in the HUD
// is pinned by tests/dungeon_prompt_policy.test.ts.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { BOOL_SETTINGS, SETTING_RANGES, Settings } from '../src/game/settings';
import { setLanguage, t } from '../src/ui/i18n';
import {
  buildInterfaceControls,
  interfaceControlsForTab,
  type OptionsSettingsSource,
} from '../src/ui/options_view';
import {
  buildTransferCode,
  parseTransferCode,
  transferKeyAllowed,
} from '../src/ui/settings_transfer_core';
import { PROFILE_TOKENS } from './helpers/profile_tokens';

setLanguage('en');

// ---- the setting ------------------------------------------------------------------

function installStorage(): Map<string, string> {
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
  return map;
}

describe('settings.showDungeonHints', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStorage();
  });

  it('is on by default, for a fresh player and for a save that predates it', () => {
    expect(BOOL_SETTINGS.showDungeonHints).toEqual({ def: true });
    expect(new Settings().get('showDungeonHints')).toBe(true);
    store.set('woc_settings', JSON.stringify({ graphicsPreset: 1, compactChat: true }));
    expect(new Settings().get('showDungeonHints')).toBe(true);
  });

  it('persists the choice across sessions and reset restores the default', () => {
    const settings = new Settings();
    settings.set('showDungeonHints', false);
    expect(new Settings().get('showDungeonHints')).toBe(false);
    expect(JSON.parse(store.get('woc_settings') ?? '{}').showDungeonHints).toBe(false);
    settings.reset(['showDungeonHints']);
    expect(new Settings().get('showDungeonHints')).toBe(true);
  });

  it('rides the settings export and import, and stays out of a frames-only code', () => {
    new Settings().set('showDungeonHints', false);
    const saved = store.get('woc_settings') ?? '';
    expect(transferKeyAllowed('settings', 'woc_settings')).toBe(true);
    expect(transferKeyAllowed('frames', 'woc_settings')).toBe(false);
    for (const kind of ['settings', 'full'] as const) {
      const parsed = parseTransferCode(kind, buildTransferCode(kind, { woc_settings: saved }));
      expect(parsed.ok, kind).toBe(true);
      if (!parsed.ok) continue;
      // A fresh device imports the code: the choice arrives with it.
      const fresh = installStorage();
      for (const [k, v] of Object.entries(parsed.entries)) fresh.set(k, v);
      expect(new Settings().get('showDungeonHints'), kind).toBe(false);
    }
  });
});

describe('the options row', () => {
  const source: OptionsSettingsSource = {
    num: () => 0,
    bool: (key) => BOOL_SETTINGS[key as keyof typeof BOOL_SETTINGS]?.def ?? false,
    range: (key) => {
      const r = (SETTING_RANGES as Record<string, { min: number; max: number }>)[key];
      return r ? { min: r.min, max: r.max } : { min: 0, max: 1 };
    },
  };

  it('is a declarative Combat toggle with its label and its note under it', () => {
    const combat = interfaceControlsForTab(buildInterfaceControls(source), 'combat');
    const at = combat.findIndex((c) => 'key' in c && c.key === 'showDungeonHints');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(combat[at]).toMatchObject({
      control: 'boolToggle',
      category: 'combat',
      labelKey: 'hudChrome.options.showDungeonHints',
    });
    expect(combat[at + 1]).toMatchObject({
      control: 'note',
      textKey: 'hudChrome.options.showDungeonHintsNote',
    });
    expect(t('hudChrome.options.showDungeonHints')).toBe('Dungeon mechanic hints');
  });

  it('carries its five non-Latin fills (M16), none left as English', () => {
    const en = t('hudChrome.options.showDungeonHints');
    const enNote = t('hudChrome.options.showDungeonHintsNote');
    const overlay = (lang: string) =>
      readFileSync(new URL(`../src/ui/i18n.locales/${lang}.ts`, import.meta.url), 'utf8');
    for (const lang of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU']) {
      const text = overlay(lang);
      expect(text, lang).toContain("'hudChrome.options.showDungeonHints':");
      expect(text, lang).toContain("'hudChrome.options.showDungeonHintsNote':");
      expect(text.includes(en), lang).toBe(false);
      expect(text.includes(enNote), lang).toBe(false);
    }
  });
});

// ---- fairness: a player preference, never a graphics tier -------------------------

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Comments stripped before scanning (the architecture-test rule): prose that
// NAMES the invariant must never trip the scan that enforces it.
const read = (rel: string): string =>
  readFileSync(join(repoRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      // The i18n catalogs, overlays and generated tables carry the LABEL key,
      // which is not a read of the setting.
      if (entry.name.startsWith('i18n.')) continue;
      sourceFiles(rel, out);
    } else if (/\.(ts|svelte|mjs)$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

describe('the hints setting is independent of the graphics preset', () => {
  beforeEach(() => {
    installStorage();
  });

  it('no preset moves it, and it moves no preset', () => {
    const { min, max } = SETTING_RANGES.graphicsPreset;
    expect(max).toBeGreaterThan(min);
    for (const chosen of [true, false]) {
      const settings = new Settings();
      settings.set('showDungeonHints', chosen);
      for (let preset = min; preset <= max; preset++) {
        settings.set('graphicsPreset', preset);
        expect(settings.get('showDungeonHints'), `preset ${preset}`).toBe(chosen);
        // And across a reload on that preset.
        expect(new Settings().get('showDungeonHints'), `preset ${preset} reloaded`).toBe(chosen);
      }
      const before = settings.get('graphicsPreset');
      settings.set('showDungeonHints', !chosen);
      expect(settings.get('graphicsPreset')).toBe(before);
    }
  });

  it('the policy and the composer read no effects profile, tier knob or governor', () => {
    for (const rel of [
      'src/ui/hud/dungeon/dungeon_prompt_policy_core.ts',
      'src/ui/hud/dungeon/dungeon_prompts.ts',
    ]) {
      const source = read(rel);
      for (const token of PROFILE_TOKENS) {
        expect(source.includes(token), `${rel} must not read ${token}`).toBe(false);
      }
      expect(/fxTier|graphicsPreset|governor/i.test(source), rel).toBe(false);
    }
  });

  it('only the settings table, the options row and the HUD pass-through name the setting', () => {
    // A preset table, a tier knob or the governor would have to name the key to
    // touch it: the whole client source names it in exactly these three places.
    const naming = sourceFiles('src')
      .filter((rel) => read(rel).includes('showDungeonHints'))
      .sort();
    expect(naming).toEqual(['src/game/settings.ts', 'src/ui/hud.ts', 'src/ui/options_view.ts']);
    expect(read('src/game/settings.ts').match(/showDungeonHints/g)?.length).toBe(1);
  });

  it('no advisory alert takes a press (a pressable alert would be an action prompt)', () => {
    // The setting may hide these four views only because none of them is a
    // control. An alert that grows a press has to leave the advisory set
    // (DUNGEON_PROMPT_ADVISORY) in the same change, and this is what says so.
    for (const rel of [
      'src/ui/hud/dungeon/bastion_alert_view.ts',
      'src/ui/hud/dungeon/wildheart_alert_view.ts',
      'src/ui/hud/dungeon/sanctum_alert_view.ts',
      'src/ui/hud/dungeon/crypt_alert_view.ts',
    ]) {
      const source = read(rel);
      // Every place a view sets the field, it sets it false (and none passes
      // it through as a shorthand or a computed value).
      const sets = source.match(/pressable\s*[:,]/g) ?? [];
      const setsFalse = source.match(/pressable: false/g) ?? [];
      expect(sets.length, rel).toBeGreaterThan(0);
      expect(setsFalse.length, `${rel} marks an alert pressable`).toBe(sets.length);
    }
    // The use prompt is the family member that does take one, and is not advisory.
    expect(read('src/ui/hud/dungeon/kit_use_prompt_view.ts')).toContain('pressable: true');
  });

  it('the HUD hands the composer the setting itself, combined with nothing', () => {
    const hud = read('src/ui/hud.ts');
    const call = hud.slice(hud.indexOf('this.dungeonPrompts.paint({'));
    const args = call.slice(0, call.indexOf('});'));
    expect(args).toContain("mechanicHints: this.boolSetting('showDungeonHints', true),");
    expect(/fxTier|graphicsPreset|governor|uiEffects/i.test(args)).toBe(false);
    expect(hud.match(/showDungeonHints/g)?.length).toBe(1);
  });
});
