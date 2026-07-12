import { describe, expect, it } from 'vitest';
import { SETTING_RANGES } from '../src/game/settings';
import {
  allRows,
  CATEGORIES,
  CATEGORY_SECTIONS,
  categoryOf,
  categorySettingKeys,
  NON_SETTING_SEARCH_ROWS,
  OVERVIEW_PINS,
  settingRow,
} from '../src/ui/options_ia';
import {
  boolToggleNextValue,
  buildBugReportInfo,
  buildControlFromRow,
  buildEnvGatedControl,
  categoryChangedCount,
  categoryResetKeys,
  NATIVE_SHELL_MAX_GRAPHICS_PRESET,
  nonSettingRowMatches,
  type OptionsSettingsSource,
  renderCategory,
  renderRailModel,
  rowMatchesQuery,
  SECTION_HEAD_KEYS,
  sliderDispatchValue,
  toggleIsOn,
  toggleNextValue,
  totalChangedCount,
} from '../src/ui/options_view';

// A fake settings projection over plain records, with the real numeric ranges so
// slider descriptors carry the true min/max. The painter builds the same shape
// from the live Settings store.
function makeSource(
  num: Record<string, number> = {},
  bool: Record<string, boolean> = {},
): OptionsSettingsSource {
  return {
    num: (k) => num[k] ?? 0,
    bool: (k) => bool[k] ?? false,
    range: (k) => {
      const r = (SETTING_RANGES as Record<string, { min: number; max: number }>)[k];
      return r ? { min: r.min, max: r.max } : { min: 0, max: 1 };
    },
  };
}

// ---------------------------------------------------------------------------
// Cluster 1: the four control primitives + their dispatch-value coercion
// ---------------------------------------------------------------------------
describe('options_view: control primitive dispatch (cluster 1)', () => {
  it('settingSlider dispatches the raw input value coerced to a Number', () => {
    expect(sliderDispatchValue('0.35')).toBe(0.35);
    expect(sliderDispatchValue('60')).toBe(60);
    // identical coercion regardless of formatting kind
    expect(sliderDispatchValue('1')).toBe(1);
  });

  it('settingToggle flips 0<->1 off the stored value and reads on at >=0.5', () => {
    expect(toggleNextValue(0)).toBe(1);
    expect(toggleNextValue(1)).toBe(0);
    expect(toggleNextValue(0.6)).toBe(0);
    expect(toggleNextValue(0.4)).toBe(1);
    expect(toggleIsOn(0.5)).toBe(true);
    expect(toggleIsOn(0.49)).toBe(false);
    expect(toggleIsOn(0)).toBe(false);
  });

  it('settingBoolToggle flips the stored boolean', () => {
    expect(boolToggleNextValue(true)).toBe(false);
    expect(boolToggleNextValue(false)).toBe(true);
  });

  it('a slider descriptor carries the live value, range, step and format', () => {
    const cam = buildControlFromRow(makeSource({ cameraSpeed: 0.9 }), settingRow('cameraSpeed')!);
    expect(cam).toMatchObject({ control: 'slider', value: 0.9, step: 0.05, fmt: 'percent' });
    expect(cam).toMatchObject({
      min: SETTING_RANGES.cameraSpeed.min,
      max: SETTING_RANGES.cameraSpeed.max,
    });
    const fov = buildControlFromRow(makeSource({ cameraFov: 75 }), settingRow('cameraFov')!);
    expect(fov).toMatchObject({ control: 'slider', value: 75, step: 1, fmt: 'degrees' });
  });
});

// ---------------------------------------------------------------------------
// Cluster 2: bug report. The ONE IWorld slice the window reads, so it is the
// ClientWorld-vs-Sim parity surface.
// ---------------------------------------------------------------------------
describe('options_view: bug report info (cluster 2)', () => {
  it('derives realm/character/coords; unknown realm flagged when blank', () => {
    const info = buildBugReportInfo('Stormrend', {
      name: 'Tharos',
      pos: { x: 12.6, y: -3.1, z: 88.9 },
    });
    expect(info).toEqual({
      realmKnown: true,
      realm: 'Stormrend',
      characterName: 'Tharos',
      pos: { x: 12.6, y: -3.1, z: 88.9 },
    });
    const offline = buildBugReportInfo('', { name: 'Tharos', pos: { x: 0, y: 0, z: 0 } });
    expect(offline.realmKnown).toBe(false);
    expect(offline.realm).toBe('');
    const nullRealm = buildBugReportInfo(null, { name: 'Tharos', pos: { x: 0, y: 0, z: 0 } });
    expect(nullRealm.realmKnown).toBe(false);
  });

  it('derives the documented info from BOTH a Sim shape and a ClientWorld-mirror shape (parity)', () => {
    // Two GENUINELY different world shapes, not a self-clone: the offline Sim hands
    // the window a live player Entity (a prototyped instance carrying extra offline
    // fields the window must ignore) and an empty realm string (IWorld.realm is ''
    // in offline play); the online ClientWorld hands it a plain wire-mirrored object
    // and a populated realm. The slice the window reads (name + pos) must come out
    // identical from both, so an offline-only field shape can't silently misrender
    // online; only realm (a documented online/offline difference) differs.
    const simPlayer = Object.assign(Object.create({ speed: 7 }), {
      name: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
      hp: 120, // offline-only field the bug-report slice must not read
    });
    const simInfo = buildBugReportInfo('', simPlayer);
    expect(simInfo).toEqual({
      realmKnown: false,
      realm: '',
      characterName: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
    });

    const clientInfo = buildBugReportInfo('Stormrend', {
      name: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
    });
    expect(clientInfo).toEqual({
      realmKnown: true,
      realm: 'Stormrend',
      characterName: 'Tharos',
      pos: { x: 5.5, y: 2.25, z: -7.75 },
    });

    // The read slice is identical across the two shapes; realm is the only divergence.
    expect(clientInfo.characterName).toBe(simInfo.characterName);
    expect(clientInfo.pos).toEqual(simInfo.pos);
  });
});

// ---------------------------------------------------------------------------
// Determinism: same input -> same output (deterministic pure core)
// ---------------------------------------------------------------------------
describe('options_view: determinism', () => {
  it('produces identical models and controls for identical inputs', () => {
    const src = makeSource({ graphicsPreset: 5, cameraSpeed: 0.8 }, { reduceMotion: true });
    const env = { touch: true, nativeShell: false };
    expect(renderCategory('graphics', env)).toEqual(renderCategory('graphics', env));
    expect(renderCategory('interface', env)).toEqual(renderCategory('interface', env));
    expect(renderRailModel(env, () => 0)).toEqual(renderRailModel(env, () => 0));
    const preset = settingRow('graphicsPreset')!;
    expect(buildEnvGatedControl(src, preset, env)).toEqual(buildEnvGatedControl(src, preset, env));
    expect(buildControlFromRow(src, preset)).toEqual(buildControlFromRow(src, preset));
  });
});

// ---------------------------------------------------------------------------
// buildEnvGatedControl: the ONE cap/env gating path (S1). Every render surface
// (category detail, Overview pins, global search) binds rows through this, so
// the native-shell preset cap and the env-hidden rows can never leak through a
// mirror row.
// ---------------------------------------------------------------------------
describe('options_view: buildEnvGatedControl (S1)', () => {
  const desktop = { touch: false, nativeShell: false };
  const nativeShell = { touch: true, nativeShell: true };

  it('caps the graphicsPreset choice at High under the native shell (and only there)', () => {
    const row = settingRow('graphicsPreset')!;
    const capped = buildEnvGatedControl(makeSource({ graphicsPreset: 3 }), row, nativeShell);
    expect(capped).toMatchObject({ control: 'choice', key: 'graphicsPreset' });
    if (capped?.control === 'choice') {
      expect(capped.options.map((o) => o.value)).toEqual([1, 2, 3]);
      expect(Math.max(...capped.options.map((o) => o.value))).toBe(
        NATIVE_SHELL_MAX_GRAPHICS_PRESET,
      );
    }
    const full = buildEnvGatedControl(makeSource({ graphicsPreset: 3 }), row, desktop);
    if (full?.control === 'choice')
      expect(full.options.map((o) => o.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns null for the nativeShellHidden interfaceMode row under the native shell', () => {
    // This is the Overview-pin leak: the pin path must drop the row exactly like
    // the Controls detail pane does.
    const row = settingRow('interfaceMode')!;
    expect(buildEnvGatedControl(makeSource(), row, nativeShell)).toBeNull();
    expect(buildEnvGatedControl(makeSource(), row, desktop)).toMatchObject({
      control: 'choice',
      key: 'interfaceMode',
    });
  });

  it('hides a desktop-only row on touch and a touch-only row on desktop', () => {
    const mouse = settingRow('mouseCamera')!;
    expect(buildEnvGatedControl(makeSource(), mouse, { touch: true, nativeShell: false })).toBe(
      null,
    );
    expect(buildEnvGatedControl(makeSource(), mouse, desktop)).not.toBeNull();
    // joystickScale inherits touchOnly from its Touch home category.
    const joystick = settingRow('joystickScale')!;
    expect(buildEnvGatedControl(makeSource(), joystick, desktop)).toBeNull();
    expect(
      buildEnvGatedControl(makeSource(), joystick, { touch: true, nativeShell: false }),
    ).not.toBeNull();
  });

  it('still returns null for bespoke rows, which the painter renders itself', () => {
    const lang = allRows().find((r) => r.control === 'language')!;
    expect(buildEnvGatedControl(makeSource(), lang, desktop)).toBeNull();
  });
});

// ===========================================================================
// The Warden's Codex desktop chrome (P2): rail + category detail view-models.
// ===========================================================================

describe('options_view: rail model (P2)', () => {
  const desktop = { touch: false, nativeShell: false };

  it('puts Overview first and groups the nine categories under Display/Input/System', () => {
    const rail = renderRailModel(desktop, () => 0);
    expect(rail.overview.id).toBe('overview');
    // conflict dot slot reserved for P4: always false in P2
    expect(rail.overview.hasConflict).toBe(false);
    expect(rail.groups.map((g) => g.id)).toEqual(['display', 'input', 'system']);
    const idsIn = (g: string) => rail.groups.find((x) => x.id === g)?.tabs.map((t) => t.id) ?? [];
    expect(idsIn('display')).toEqual(['graphics', 'interface', 'accessibility']);
    // On desktop the touch-only Touch category is hidden (gating verified below).
    expect(idsIn('input')).toEqual(['controls', 'keybinds', 'controller']);
    expect(idsIn('system')).toEqual(['audio', 'system']);
  });

  it('hides the touch-only Touch category on desktop and the desktop-only Keybinds on touch', () => {
    const onDesktop = renderRailModel(desktop, () => 0)
      .groups.flatMap((g) => g.tabs)
      .map((t) => t.id);
    expect(onDesktop).toContain('keybinds');
    expect(onDesktop).not.toContain('touch');
    const onTouch = renderRailModel({ touch: true, nativeShell: false }, () => 0)
      .groups.flatMap((g) => g.tabs)
      .map((t) => t.id);
    expect(onTouch).toContain('touch');
    expect(onTouch).not.toContain('keybinds');
    // Controller stays on touch (Bluetooth pads are real).
    expect(onTouch).toContain('controller');
  });

  it('wires the per-category changed count from the supplied callback', () => {
    const rail = renderRailModel(desktop, (id) => (id === 'audio' ? 3 : 0));
    const audio = rail.groups.flatMap((g) => g.tabs).find((t) => t.id === 'audio');
    expect(audio?.changedCount).toBe(3);
    const graphics = rail.groups.flatMap((g) => g.tabs).find((t) => t.id === 'graphics');
    expect(graphics?.changedCount).toBe(0);
  });
});

describe('options_view: category detail model (P2)', () => {
  const desktop = { touch: false, nativeShell: false };

  it('builds a dense category (Interface) as sections + rows with head keys', () => {
    const model = renderCategory('interface', desktop);
    expect(model.id).toBe('interface');
    const secIds = model.sections.map((s) => s.id);
    expect(secIds).toContain('general');
    expect(secIds).toContain('unitFrames');
    for (const s of model.sections) {
      expect(s.headKey, `${s.id} head`).toBe(SECTION_HEAD_KEYS[s.id]);
      expect(s.rows.length, `${s.id} rows`).toBeGreaterThan(0);
    }
    // The General section carries the two bespoke non-settings rows in order.
    const general = model.sections.find((s) => s.id === 'general');
    expect(general?.rows.map((r) => r.control)).toEqual(['language', 'themePreset']);
  });

  it('drops the desktop-only Controls rows (and their now-empty section) on touch', () => {
    const onDesktop = renderCategory('controls', desktop)
      .sections.flatMap((s) => s.rows)
      .map((r) => r.key);
    expect(onDesktop).toContain('mouseCamera');
    const touchModel = renderCategory('controls', { touch: true, nativeShell: false });
    const onTouch = touchModel.sections.flatMap((s) => s.rows).map((r) => r.key);
    expect(onTouch).not.toContain('mouseCamera');
    // The camera section is all desktop-only rows: it disappears entirely on touch.
    expect(touchModel.sections.map((s) => s.id)).not.toContain('camera');
    // Combat rows have no desktop gate and stay reachable on touch.
    expect(onTouch).toContain('attackMove');
  });

  it('hides interfaceMode under the native app shell (its lone-note section drops)', () => {
    const shell = renderCategory('controls', { touch: false, nativeShell: true });
    const keys = shell.sections.flatMap((s) => s.rows).map((r) => r.key);
    expect(keys).not.toContain('interfaceMode');
    // The inputMode section held only interfaceMode + its note, so it drops whole.
    expect(shell.sections.map((s) => s.id)).not.toContain('inputMode');
  });

  it('the Chat section carries the hud-owned chat-timestamp rows (S2), on every host', () => {
    // Show + 12h/24h are keyless bespoke rows (hud localStorage state via the
    // OptionsHooks chat accessors); a player with timestamps on must always have
    // a surface to turn them off, so no env gate hides them anywhere.
    for (const env of [
      desktop,
      { touch: true, nativeShell: false },
      { touch: true, nativeShell: true },
    ]) {
      const chat = renderCategory('interface', env).sections.find((s) => s.id === 'chat');
      const controls = chat?.rows.map((r) => r.control) ?? [];
      expect(controls, `env ${JSON.stringify(env)}`).toContain('chatTimestamps');
      expect(controls, `env ${JSON.stringify(env)}`).toContain('chatClock');
    }
    // Their labels are the shipped chatTimestamps keys (already localized).
    const chat = renderCategory('interface', desktop).sections.find((s) => s.id === 'chat');
    expect(chat?.rows.find((r) => r.control === 'chatTimestamps')?.labelKey).toBe(
      'hudChrome.chatTimestamps.show',
    );
    expect(chat?.rows.find((r) => r.control === 'chatClock')?.labelKey).toBe(
      'hudChrome.chatTimestamps.format',
    );
  });
});

describe('options_view: buildControlFromRow parity (P2)', () => {
  const rowFor = (key: string) =>
    Object.values(CATEGORY_SECTIONS)
      .flat()
      .flatMap((s) => s.rows)
      .find((r) => r.key === key);

  it('binds a slider with the old step (degrees=1, else 0.05) and preserves commitOnChange', () => {
    const fov = buildControlFromRow(makeSource({ cameraFov: 75 }), rowFor('cameraFov')!);
    expect(fov).toMatchObject({
      control: 'slider',
      key: 'cameraFov',
      step: 1,
      fmt: 'degrees',
      value: 75,
    });
    const ui = buildControlFromRow(makeSource({ uiScale: 1.1 }), rowFor('uiScale')!);
    expect(ui).toMatchObject({
      control: 'slider',
      key: 'uiScale',
      step: 0.05,
      commitOnChange: true,
    });
    // a plain percent slider is live (no commitOnChange flag)
    const music = buildControlFromRow(makeSource({ musicVolume: 0.5 }), rowFor('musicVolume')!);
    expect(music).not.toHaveProperty('commitOnChange');
  });

  it('binds a choice with its option set, current value, and rerender flag', () => {
    const preset = buildControlFromRow(
      makeSource({ graphicsPreset: 5 }),
      rowFor('graphicsPreset')!,
    );
    expect(preset).toMatchObject({
      control: 'choice',
      key: 'graphicsPreset',
      current: 5,
      rerender: true,
    });
    if (preset?.control === 'choice')
      expect(preset.options.map((o) => o.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns null for the bespoke language + theme-preset rows', () => {
    const lang = allRows().find((r) => r.control === 'language');
    const theme = allRows().find((r) => r.control === 'themePreset');
    expect(buildControlFromRow(makeSource(), lang!)).toBeNull();
    expect(buildControlFromRow(makeSource(), theme!)).toBeNull();
  });

  it('each settings-backed Overview pin builds a control that writes its HOME settings key', () => {
    const s = makeSource();
    for (const pin of OVERVIEW_PINS) {
      if (!pin.key) continue;
      const control = buildControlFromRow(s, settingRow(pin.key)!);
      expect(control && 'key' in control && control.key, `${pin.key} pin`).toBe(pin.key);
      expect(categoryOf(pin.key), `${pin.key} home`).toBe(pin.homeCategory);
    }
  });
});

describe('options_view: section-scope search (P2)', () => {
  it('matches by case-insensitive label substring; an empty query matches every row', () => {
    expect(rowMatchesQuery('UI Scale', 'uiScale', '')).toBe(true);
    expect(rowMatchesQuery('UI Scale', 'uiScale', 'scale')).toBe(true);
    expect(rowMatchesQuery('UI Scale', 'uiScale', 'SCALE')).toBe(true);
    expect(rowMatchesQuery('UI Scale', 'uiScale', 'volume')).toBe(false);
  });

  it('matches through the explicit synonym overlay, scoped to the synonym target', () => {
    expect(rowMatchesQuery('Show FPS', 'showFps', 'fps')).toBe(true);
    expect(rowMatchesQuery('Show FPS', 'showFps', 'framerate')).toBe(true);
    expect(rowMatchesQuery('Reduce Motion', 'reduceMotion', 'motion')).toBe(true);
    // "fps" is a synonym for showFps only: it must not match an unrelated row.
    expect(rowMatchesQuery('Reduce Motion', 'reduceMotion', 'fps')).toBe(false);
  });
});

describe('options_view: non-settings row search (M3, language + theme preset)', () => {
  const langRow = NON_SETTING_SEARCH_ROWS.find((r) => r.control === 'language');
  const themeRow = NON_SETTING_SEARCH_ROWS.find((r) => r.control === 'themePreset');

  it('the two keyless rows are homed in Interface > general with their real labels', () => {
    expect(langRow).toBeDefined();
    expect(themeRow).toBeDefined();
    for (const r of NON_SETTING_SEARCH_ROWS) {
      expect(r.categoryId).toBe('interface');
      expect(r.sectionId).toBe('general');
    }
    expect(langRow?.labelKey).toBe('hud.options.language');
    expect(themeRow?.labelKey).toBe('hudChrome.theme.preset');
  });

  it('matches the language row by label and its synonyms (language, locale)', () => {
    // Guard the exact assertion: nonSettingRowMatches must be defined.
    if (!langRow) throw new Error('language search row missing');
    expect(nonSettingRowMatches(langRow, 'Language', '')).toBe(true); // empty matches
    expect(nonSettingRowMatches(langRow, 'Language', 'lang')).toBe(true); // label substring
    expect(nonSettingRowMatches(langRow, 'Language', 'LOCALE')).toBe(true); // synonym (ci)
    expect(nonSettingRowMatches(langRow, 'Language', 'volume')).toBe(false);
  });

  it('matches the theme row by label and its synonyms (theme, colour/color, appearance)', () => {
    if (!themeRow) throw new Error('theme search row missing');
    expect(nonSettingRowMatches(themeRow, 'Theme', 'theme')).toBe(true);
    expect(nonSettingRowMatches(themeRow, 'Theme', 'colour')).toBe(true);
    expect(nonSettingRowMatches(themeRow, 'Theme', 'color')).toBe(true);
    expect(nonSettingRowMatches(themeRow, 'Theme', 'appearance')).toBe(true);
    expect(nonSettingRowMatches(themeRow, 'Theme', 'fps')).toBe(false);
  });
});

describe('options_view: scoped reset + changed counts (P2)', () => {
  it('a scoped category reset targets exactly that category homed key set', () => {
    expect(categoryResetKeys('audio')).toEqual(categorySettingKeys('audio'));
    expect(categoryResetKeys('audio')).toEqual([
      'sfxVolume',
      'musicVolume',
      'voiceVolume',
      'voiceEnabled',
      'footstepSfx',
    ]);
    // Overview owns no settings keys of its own (its pins are mirrors).
    expect(categoryResetKeys('overview')).toEqual([]);
  });

  it('counts changed keys per category and in total from the changed predicate', () => {
    const changed = (k: string) => k === 'musicVolume' || k === 'sfxVolume';
    expect(categoryChangedCount('audio', changed)).toBe(2);
    expect(categoryChangedCount('graphics', changed)).toBe(0);
    expect(totalChangedCount(() => false)).toBe(0);
    const homed = CATEGORIES.reduce((n, c) => n + categorySettingKeys(c.id).length, 0);
    expect(totalChangedCount(() => true)).toBe(homed);
  });
});
