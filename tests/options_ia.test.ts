import { describe, expect, it } from 'vitest';
import { BOOL_SETTINGS, SETTING_RANGES } from '../src/game/settings';
import {
  allRows,
  buildSearchIndex,
  CATEGORIES,
  CATEGORY_SEARCH_SYNONYMS,
  type CategoryId,
  categoriesForSearch,
  categoryOf,
  categorySettingKeys,
  EXCLUDED_SETTING_KEYS,
  OVERVIEW_PINS,
  OVERVIEW_QUICK_ACTIONS,
  RAIL_GROUPS,
  rowEnv,
  SEARCH_SYNONYMS,
  settingRow,
} from '../src/ui/options_ia';

// The REAL settings tables are the source of truth for exhaustiveness: bind the
// test to them (the same import the options dispatch tests use, options_view.test
// imports SETTING_RANGES) so a NEW settings key with no IA home reds this file.
const ALL_SETTING_KEYS = [...Object.keys(SETTING_RANGES), ...Object.keys(BOOL_SETTINGS)];

// ---------------------------------------------------------------------------
// Category tree shape (pinned as literals per spec section 3)
// ---------------------------------------------------------------------------
describe('options_ia: category tree shape', () => {
  it('opens on Overview then lists the nine categories in group order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      'overview',
      'graphics',
      'interface',
      'accessibility',
      'controls',
      'keybinds',
      'controller',
      'touch',
      'audio',
      'system',
    ]);
    // Overview is the landing: it sits ABOVE the rail groups (no group).
    expect(CATEGORIES[0]).toMatchObject({ id: 'overview', group: null });
    // Every category carries a name key, a subhead key, and an icon slug.
    for (const c of CATEGORIES) {
      expect(typeof c.nameKey, `${c.id} name`).toBe('string');
      expect(typeof c.subheadKey, `${c.id} subhead`).toBe('string');
      expect((c.iconSlug ?? '').length, `${c.id} icon`).toBeGreaterThan(0);
    }
  });

  it('pins the three rail groups and their exact membership + order', () => {
    expect(RAIL_GROUPS.map((g) => g.id)).toEqual(['display', 'input', 'system']);
    const inGroup = (g: string) => CATEGORIES.filter((c) => c.group === g).map((c) => c.id);
    expect(inGroup('display')).toEqual(['graphics', 'interface', 'accessibility']);
    expect(inGroup('input')).toEqual(['controls', 'keybinds', 'controller', 'touch']);
    expect(inGroup('system')).toEqual(['audio', 'system']);
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness: EVERY settings key assigned exactly once OR allowlisted
// ---------------------------------------------------------------------------
describe('options_ia: settings-key exhaustiveness', () => {
  const categoryIds = CATEGORIES.map((c) => c.id);

  it('assigns every SETTING_RANGES + BOOL_SETTINGS key to exactly one category or the allowlist', () => {
    const excluded = new Set(EXCLUDED_SETTING_KEYS);
    for (const key of ALL_SETTING_KEYS) {
      const homes = categoryIds.filter((id) => categorySettingKeys(id).includes(key));
      if (excluded.has(key)) {
        expect(homes, `${key} is allowlisted, must not also be assigned`).toEqual([]);
      } else {
        // Exactly one home category: RED on a new unassigned key AND on a double assignment.
        expect(homes, `${key} must have exactly one category home`).toHaveLength(1);
      }
    }
  });

  it('never assigns an allowlisted key and never allowlists a key it also homes', () => {
    expect([...EXCLUDED_SETTING_KEYS].sort()).toEqual(
      ['graphicsDefaultApplied', 'questTrackerCollapsed'].sort(),
    );
    for (const key of EXCLUDED_SETTING_KEYS) {
      expect(ALL_SETTING_KEYS, `${key} allowlist entry is a real settings key`).toContain(key);
    }
  });

  it('homes no phantom key (every IA-mapped key is a real settings key)', () => {
    const real = new Set(ALL_SETTING_KEYS);
    for (const id of categoryIds) {
      for (const key of categorySettingKeys(id)) {
        expect(real.has(key), `${id} maps a non-existent settings key '${key}'`).toBe(true);
      }
    }
  });

  it('covers every key exactly once across the union of homes + allowlist', () => {
    const homed = categoryIds.flatMap((id) => categorySettingKeys(id));
    const seen = new Map<string, number>();
    for (const k of homed) seen.set(k, (seen.get(k) ?? 0) + 1);
    // No key homed twice anywhere.
    for (const [k, n] of seen) expect(n, `${k} homed ${n} times`).toBe(1);
    // Homed + excluded == the full settings surface, no gaps.
    const covered = new Set([...homed, ...EXCLUDED_SETTING_KEYS]);
    expect([...covered].sort()).toEqual([...ALL_SETTING_KEYS].sort());
  });
});

// ---------------------------------------------------------------------------
// Overview pins/mirrors: mirrors reference their HOME key, never a second home
// ---------------------------------------------------------------------------
describe('options_ia: Overview pins + quick actions', () => {
  it('contributes zero settings keys of its own (mirrors are not second homes)', () => {
    expect(categorySettingKeys('overview')).toEqual([]);
  });

  it('leads with the language pin (readable-language-first)', () => {
    // A player who cannot read the current language must reach the language
    // control before anything else on the Overview landing.
    expect(OVERVIEW_PINS[0]?.nonSettingsHome).toBe('language');
  });

  it('mirrors the spec pin set, each pointing at its real home', () => {
    const settingPins = OVERVIEW_PINS.filter((p) => p.key).map((p) => p.key);
    expect([...settingPins].sort()).toEqual(
      [
        'graphicsPreset',
        'uiScale',
        'musicVolume',
        'sfxVolume',
        'reduceMotion',
        'interfaceMode',
      ].sort(),
    );
    // Each settings-backed pin resolves to exactly one non-overview home category.
    for (const pin of OVERVIEW_PINS) {
      if (!pin.key) continue;
      const home = categoryOf(pin.key);
      expect(home, `${pin.key} pin home`).toBeDefined();
      expect(home, `${pin.key} home is not overview`).not.toBe('overview');
      expect(home, `${pin.key} homeCategory matches`).toBe(pin.homeCategory);
    }
    // Theme preset + language are non-settings homes, kept OUT of the key count.
    const nonSettings = OVERVIEW_PINS.filter((p) => p.nonSettingsHome).map(
      (p) => p.nonSettingsHome,
    );
    expect([...nonSettings].sort()).toEqual(['language', 'themePreset'].sort());
    expect(OVERVIEW_PINS.filter((p) => p.nonSettingsHome && p.key)).toEqual([]);
  });

  it('gates only Report a Bug online; logout stays reachable in both modes', () => {
    const byId = new Map(OVERVIEW_QUICK_ACTIONS.map((a) => [a.id, a]));
    // Report a Bug needs an authoritative server, so it is the one online-only action.
    expect(byId.get('reportBug')?.env?.onlineOnly, 'bug report online-only').toBe(true);
    // Log out is reachable OFFLINE too (it reloads to the title screen), so the IA
    // data must NOT mark it online-only: the painter renders it unconditionally and
    // the P5 mobile shell consumes this list, so the marker and behavior must agree.
    expect(byId.get('logout')?.env?.onlineOnly, 'logout reachable offline').toBeUndefined();
    // Resume + reset-all are always available (no online gate).
    expect(byId.get('resume')?.env?.onlineOnly).toBeUndefined();
    expect(byId.get('resetAll')?.env?.onlineOnly).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sprint tier flags (section 12a) -- every rendered row carries a tier
// ---------------------------------------------------------------------------
describe('options_ia: sprint implementation tiers (section 12a)', () => {
  // The section-12a REQUIRED settings surface (UI/HUD-relevant).
  const REQUIRED_KEYS = [
    // entire Interface category
    'uiScale',
    'tooltipScale',
    'hudOpacity',
    'frostedPanels',
    'playerFrameScale',
    'targetFrameScale',
    'aurasOnPlayerFrame',
    'showOwnNameplate',
    'showSecondaryActionBar',
    'chatFontScale',
    'chatOpacity',
    'compactChat',
    'fctScale',
    'showItemLevel',
    'showOverflowXp',
    'showWalletOnCharacterScreen',
    'showWalletOnPlayerCard',
    'showDevBadges',
    'showDailyRewardsChest',
    // entire Accessibility category
    'reduceMotion',
    'highContrastText',
    'landingHighContrast',
    'filterProfanity',
    // graphics tier gates + interfaceMode + the perf chip
    'graphicsPreset',
    'effectsQuality',
    'browserEffects',
    'interfaceMode',
    'showFps',
  ];
  // The section-12a NOT REQUIRED (mechanically migrated, dispatch-parity tested only).
  const MIGRATED_KEYS = [
    'renderScale',
    'shadowQuality',
    'terrainDetail',
    'foliageDensity',
    'weather',
    'brightness',
    'fullscreen',
    'cameraFov',
    'sfxVolume',
    'musicVolume',
    'voiceVolume',
    'voiceEnabled',
    'footstepSfx',
    'mouseCamera',
    'cameraSpeed',
    'invertLookY',
    'lockCursorOnRotate',
    'clickToMove',
    'clickToMoveButton',
    'attackMove',
    'startAttackOnAbilityUse',
    'groundReticle',
    'walkByAutoloot',
    'clickFeedback',
    'gamepadEnabled',
    'gamepadInvertY',
    'gamepadStickDeadzone',
    'gamepadCameraSpeed',
    'gamepadVibration',
    'joystickScale',
    'joystickDeadzone',
    'leftHandedTouch',
    'mobileCameraJoystick',
    'touchLookSpeed',
    'touchInvertLook',
    'actionButtonScale',
    'touchOpacity',
  ];

  it('every rendered row carries a sprint tier flag', () => {
    for (const row of allRows()) {
      expect(['required', 'migrated', 'conditional'], `row ${row.key ?? row.control}`).toContain(
        row.sprintTier,
      );
    }
  });

  it('flags the section-12a REQUIRED rows as required', () => {
    for (const key of REQUIRED_KEYS) {
      expect(settingRow(key)?.sprintTier, `${key} tier`).toBe('required');
    }
    // theme preset + language are REQUIRED non-settings rows.
    const themeRow = allRows().find((r) => r.control === 'themePreset');
    const langRow = allRows().find((r) => r.control === 'language');
    expect(themeRow?.sprintTier, 'theme preset tier').toBe('required');
    expect(langRow?.sprintTier, 'language tier').toBe('required');
  });

  it('flags the section-12a NOT REQUIRED rows as migrated', () => {
    for (const key of MIGRATED_KEYS) {
      expect(settingRow(key)?.sprintTier, `${key} tier`).toBe('migrated');
    }
  });

  it('partitions every settings key into exactly required|migrated (none stray)', () => {
    const required = new Set(REQUIRED_KEYS);
    const migrated = new Set(MIGRATED_KEYS);
    const excluded = new Set(EXCLUDED_SETTING_KEYS);
    for (const key of ALL_SETTING_KEYS) {
      if (excluded.has(key)) continue;
      const inReq = required.has(key);
      const inMig = migrated.has(key);
      expect(inReq !== inMig, `${key} must be exactly one of required/migrated`).toBe(true);
      expect(settingRow(key)?.sprintTier, `${key} tier matches list`).toBe(
        inReq ? 'required' : 'migrated',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Environment gating markers (data, not logic)
// ---------------------------------------------------------------------------
describe('options_ia: environment gating', () => {
  it('gates the Touch category (and its rows) to touch environments', () => {
    const touch = CATEGORIES.find((c) => c.id === 'touch');
    expect(touch?.env?.touchOnly, 'Touch category touch-only').toBe(true);
    // actionButtonScale lives in Touch, so it resolves touch-only.
    expect(rowEnv('actionButtonScale').touchOnly, 'actionButtonScale touch-only').toBe(true);
  });

  it('hides the Keybinds category and the mouse-specific Controls rows on touch', () => {
    const keybinds = CATEGORIES.find((c) => c.id === 'keybinds');
    expect(keybinds?.env?.desktopOnly, 'Keybinds category desktop-only').toBe(true);
    for (const key of [
      'mouseCamera',
      'cameraSpeed',
      'invertLookY',
      'lockCursorOnRotate',
      'clickToMove',
      'clickToMoveButton',
    ]) {
      expect(rowEnv(key).desktopOnly, `${key} desktop-only`).toBe(true);
    }
    // The Controller category STAYS on mobile (Bluetooth pads are real).
    const controller = CATEGORIES.find((c) => c.id === 'controller');
    expect(controller?.env?.desktopOnly).toBeUndefined();
    // Combat/feedback Controls rows stay on touch.
    expect(rowEnv('attackMove').desktopOnly).toBeUndefined();
    expect(rowEnv('clickFeedback').desktopOnly).toBeUndefined();
  });

  it('hides interfaceMode under the native app shell', () => {
    expect(
      settingRow('interfaceMode')?.env?.nativeShellHidden,
      'interfaceMode native-shell hidden',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structural search index + synonym overlay
// ---------------------------------------------------------------------------
describe('options_ia: structural search index', () => {
  it('indexes every rendered control row that carries a settings key', () => {
    const index = buildSearchIndex();
    const indexed = new Set(index.map((r) => r.settingKey));
    for (const row of allRows()) {
      if (!row.key) continue; // notes, music toggle, language, theme preset carry no settings key
      expect(indexed.has(row.key), `search index missing '${row.key}'`).toBe(true);
    }
    // Every index row names a real category + a non-empty section + a real settings key.
    const real = new Set(ALL_SETTING_KEYS);
    const categoryIds = new Set<CategoryId>(CATEGORIES.map((c) => c.id));
    for (const r of index) {
      expect(real.has(r.settingKey), `index key ${r.settingKey}`).toBe(true);
      expect(categoryIds.has(r.categoryId), `index category ${r.categoryId}`).toBe(true);
      expect((r.sectionId ?? '').length, `index section for ${r.settingKey}`).toBeGreaterThan(0);
      expect(typeof r.labelKey, `index label for ${r.settingKey}`).toBe('string');
    }
  });

  it('indexes each settings-key row exactly once (the index cannot drift or dupe)', () => {
    const index = buildSearchIndex();
    const rowKeys = allRows()
      .filter((r) => r.key)
      .map((r) => r.key as string);
    const seen = new Map<string, number>();
    for (const r of index) seen.set(r.settingKey, (seen.get(r.settingKey) ?? 0) + 1);
    for (const [k, n] of seen) expect(n, `${k} indexed ${n} times`).toBe(1);
    expect([...seen.keys()].sort()).toEqual([...new Set(rowKeys)].sort());
  });

  it('resolves the explicit synonym overlay examples to real indexed rows', () => {
    const index = buildSearchIndex();
    const indexed = new Set(index.map((r) => r.settingKey));
    expect(SEARCH_SYNONYMS.fps).toBe('showFps');
    expect(SEARCH_SYNONYMS.framerate).toBe('showFps');
    expect(SEARCH_SYNONYMS.motion).toBe('reduceMotion');
    for (const target of Object.values(SEARCH_SYNONYMS)) {
      expect(indexed.has(target), `synonym target '${target}' is indexed`).toBe(true);
    }
  });

  it('is deterministic (same shape every build)', () => {
    expect(buildSearchIndex()).toEqual(buildSearchIndex());
  });

  it('surfaces the bespoke Keybinds category through the category synonym overlay (P4)', () => {
    // The Keybinds bind table has no settings-key rows, so bind/binding/hotkey/
    // shortcut reach it via the CATEGORY overlay, not SEARCH_SYNONYMS.
    for (const term of ['bind', 'binding', 'keybind', 'hotkey', 'shortcut']) {
      expect(CATEGORY_SEARCH_SYNONYMS[term], `${term} -> keybinds`).toBe('keybinds');
    }
    // Every category synonym targets a real category id.
    const ids = new Set<CategoryId>(CATEGORIES.map((c) => c.id));
    for (const target of Object.values(CATEGORY_SEARCH_SYNONYMS)) {
      expect(ids.has(target), `synonym target '${target}' is a real category`).toBe(true);
    }
    // A query resolves to the Keybinds category (contains-match, like settings-key synonyms).
    expect(categoriesForSearch('bind')).toContain('keybinds');
    expect(categoriesForSearch('hotkey')).toContain('keybinds');
    expect(categoriesForSearch('short')).toContain('keybinds'); // 'shortcut' contains 'short'
    expect(categoriesForSearch('')).toEqual([]);
    expect(categoriesForSearch('brightness')).toEqual([]); // not a category synonym
  });
});
