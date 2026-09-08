// @vitest-environment happy-dom
// Source-guard suite for the two professions-family side-rail tiles the
// Masterwrought Phase 18 sweep added (the reliquary_window.test.ts /
// crafting_launcher.test.ts pattern): the Perfecting tile plus its keybind
// (the full seven-piece rail-tile exemplar), and the Harvest Journal tile over
// its pre-existing Shift+K keybind. Every seam of the exemplar is pinned,
// because the recorded silent-drop bug class is a keybind wired at ONE of the
// two main.ts dispatch sites and dead at the other.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIND_ACTIONS, keyCapLabel } from '../src/game/keybinds';
import { hasChromeIconArt } from '../src/ui/chrome_icon_art';
import { SIDE_BUTTONS } from '../src/ui/hud/menu/side_buttons';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { hasUiIcon, hydrateIcons, svgIcon } from '../src/ui/ui_icons';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const hud = read('../src/ui/hud.ts');
const mainSrc = read('../src/main.ts');
const inputSrc = read('../src/game/input.ts');
const keybindsSrc = read('../src/game/keybinds.ts');
const optionsWindow = read('../src/ui/options_window.ts');
const entries = [
  ['index.html', read('../index.html')],
  ['play.html', read('../play.html')],
] as const;

function colA(html: string): string {
  const start = html.indexOf('id="side-buttons-col-a"');
  const end = html.indexOf('id="side-buttons-col-b"', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('the Perfecting rail tile and keybind (the seven-piece exemplar)', () => {
  it('ships the tile in col-a of BOTH game entries, under Crafting, with its title and aria keys', () => {
    for (const [name, html] of entries) {
      const col = colA(html);
      expect(col, name).toMatch(
        /id="mm-perfecting"[^>]*data-i18n-title="hudChrome\.perfecting\.title"[^>]*data-i18n-aria="hudChrome\.perfecting\.title"/,
      );
      expect(col, name).toMatch(/id="mm-perfecting"[^>]*data-icon="perfecting"/);
      // Crafting's own tile first, then Perfecting (the crafting family's
      // endgame surface sits under its parent), then the column ends.
      expect(col.indexOf('id="mm-perfecting"'), name).toBeGreaterThan(
        col.indexOf('id="mm-crafting"'),
      );
      // The static keycap matches the default binding's cap form.
      expect(col, name).toMatch(/id="mm-perfecting"[^>]*><span class="keybind">s-t<\/span>/);
    }
    expect(keyCapLabel('Shift+T')).toBe('s-t');
  });

  it('reuses the window title key for the tile (no new string), and the key exists in English', () => {
    expect(hudChromeStrings.perfecting.title).toBe('Perfecting');
  });

  it('hud.ts wires the click to the existing togglePerfecting and repaints the keycap', () => {
    expect(hud).toContain(
      "$('#mm-perfecting')?.addEventListener('click', () => this.togglePerfecting());",
    );
    expect(SIDE_BUTTONS).toContainEqual([
      '#mm-perfecting',
      'perfecting',
      'hudChrome.perfecting.title',
    ]);
    // The toggle it reaches is the pre-existing public surface, unchanged.
    expect(hud).toContain('togglePerfecting(): void {');
    expect(hud).toContain('this.perfectingWindow.toggle();');
  });

  it('registers the keybind on the shifted layer of KeyT with the collision rationale', () => {
    const action = BIND_ACTIONS.find((a) => a.id === 'perfecting');
    expect(action?.kind).toBe('edge');
    expect(action?.category).toBe('Interface');
    expect(action?.defaults).toEqual(['Shift+KeyT']);
    // The bare letter is Crafting's; that fact is written where the entry is.
    const at = keybindsSrc.indexOf("id: 'perfecting'");
    expect(at).toBeGreaterThan(-1);
    expect(keybindsSrc.slice(at - 600, at)).toMatch(/bare\s+(?:\/\/\s*)?KeyT is Crafting/);
    // No other action ships the same chord (the per-layer uniqueness rule).
    const owners = BIND_ACTIONS.filter((a) => a.defaults.includes('Shift+KeyT'));
    expect(owners.map((a) => a.id)).toEqual(['perfecting']);
  });

  it('routes through the Input union and dispatchEdge case', () => {
    expect(inputSrc).toContain("| 'perfecting'");
    expect(inputSrc).toMatch(/case 'perfecting':\s*this\.cb\.onUiKey\('perfecting'\);\s*return;/);
  });

  it('is dispatched at BOTH main.ts sites (keyboard onUiKey and dispatchGamepadAction)', () => {
    const keyboardStart = mainSrc.indexOf('onUiKey: (key) => {');
    const keyboardRoute = mainSrc.slice(
      keyboardStart,
      mainSrc.indexOf('onEmoteWheel:', keyboardStart),
    );
    const gamepadStart = mainSrc.indexOf('function dispatchGamepadAction(id: string): void {');
    const gamepadRoute = mainSrc.slice(
      gamepadStart,
      mainSrc.indexOf('const gamepad =', gamepadStart),
    );
    expect(keyboardStart).toBeGreaterThan(-1);
    expect(gamepadStart).toBeGreaterThan(-1);
    expect(keyboardRoute).toContain('dispatchCollectionAction(key, hud)');
    expect(gamepadRoute).toContain('dispatchCollectionAction(id, hud)');
    // collection_actions_core.test.ts verifies the original toggle for each action.
  });

  it('maps the keybind action through t() in Options (never the raw English label)', () => {
    // The label map lives in keybind_action_names_core.ts (the shared pure
    // core BIND_ACTION_LABEL_KEYS), not inline in options_window.ts; assert
    // the literal at its real owner and that Options delegates to it via
    // bindActionDisplayName, so the i18n guarantee still holds end to end.
    const keybindActionNamesCore = read('../src/ui/keybind_action_names_core.ts');
    expect(keybindActionNamesCore).toContain("perfecting: 'hudChrome.perfecting.title',");
    expect(optionsWindow).toContain(
      "import { BIND_CATEGORY_LABEL_KEYS, bindActionDisplayName } from './keybind_action_names_core';",
    );
    expect(optionsWindow).toMatch(
      /bindActionDisplayName\(actionId, fallback, this\.deps\.slotActionName\)/,
    );
  });

  it('data-icon="perfecting" is a registered glyph distinct from its neighbours', () => {
    expect(hasUiIcon('perfecting')).toBe(true);
    expect(svgIcon('perfecting')).not.toBe(svgIcon('crafting'));
    expect(svgIcon('perfecting')).not.toBe(svgIcon('enchant-rune'));
    expect(hasChromeIconArt('perfecting')).toBe(true);
  });
});

describe('the Harvest Journal rail tile (the tile half over the existing Shift+K keybind)', () => {
  it('ships the tile in col-a of BOTH game entries, beside Professions', () => {
    for (const [name, html] of entries) {
      const col = colA(html);
      expect(col, name).toMatch(
        /id="mm-harvest-journal"[^>]*data-i18n-title="hudChrome\.harvestJournal\.title"[^>]*data-i18n-aria="hudChrome\.harvestJournal\.title"/,
      );
      expect(col, name).toMatch(/id="mm-harvest-journal"[^>]*data-icon="harvest-journal"/);
      expect(col.indexOf('id="mm-harvest-journal"'), name).toBeGreaterThan(
        col.indexOf('id="mm-professions"'),
      );
      expect(col.indexOf('id="mm-harvest-journal"'), name).toBeLessThan(col.indexOf('id="mm-map"'));
      expect(col, name).toMatch(/id="mm-harvest-journal"[^>]*><span class="keybind">s-k<\/span>/);
    }
    const action = BIND_ACTIONS.find((a) => a.id === 'harvestJournal');
    expect(action?.defaults).toEqual(['Shift+KeyK']);
    expect(keyCapLabel('Shift+K')).toBe('s-k');
  });

  it('hud.ts wires the click to the existing toggleHarvestJournal and repaints the keycap', () => {
    expect(hud).toContain(
      "$('#mm-harvest-journal')?.addEventListener('click', () => this.toggleHarvestJournal());",
    );
    expect(SIDE_BUTTONS).toContainEqual([
      '#mm-harvest-journal',
      'harvestJournal',
      'hudChrome.harvestJournal.title',
    ]);
    expect(hud).toContain('this.harvestJournalWindow.toggle();');
  });

  it('data-icon="harvest-journal" is a registered glyph distinct from the deeds book and the mortar', () => {
    expect(hasUiIcon('harvest-journal')).toBe(true);
    expect(svgIcon('harvest-journal')).not.toBe(svgIcon('book'));
    expect(svgIcon('harvest-journal')).not.toBe(svgIcon('professions'));
    expect(hasChromeIconArt('harvest-journal')).toBe(true);
  });
});

describe('both tiles hydrate and stay under the rail height budget', () => {
  it('hydrateIcons materializes the painted launcher for each tile', () => {
    document.body.innerHTML =
      '<div id="side-buttons">' +
      '<button type="button" class="micro-btn" id="mm-harvest-journal" data-icon="harvest-journal"><span class="keybind">s-k</span></button>' +
      '<button type="button" class="micro-btn" id="mm-perfecting" data-icon="perfecting"><span class="keybind">s-t</span></button>' +
      '</div>';
    hydrateIcons(document.body);
    for (const [id, icon] of [
      ['mm-harvest-journal', 'harvest-journal'],
      ['mm-perfecting', 'perfecting'],
    ] as const) {
      const btn = document.getElementById(id) as HTMLButtonElement;
      expect(btn.querySelector('svg.ui-icon'), id).toBeNull();
      expect(btn.querySelector<HTMLImageElement>('img.ui-icon-art')?.src, id).toContain(
        `/ui/chrome/${icon}.webp`,
      );
    }
  });

  it('pins the professions column and fits the height budget with Town Focus visible', () => {
    // Cosmetics sits beside the shop in col-b. Town Focus is hidden in
    // markup but the HUD reveals it in town, so budget for that extra tile
    // alongside the default professions column. The authored pixel ceilings
    // remain those guarded against CSS in crafting_launcher.test.ts.
    const UNCOMPACTED_MICRO_PLUS_GAP_PX = 34;
    const COMPACT_MICRO_PLUS_GAP_PX = 25;
    const BOTTOM_ANCHOR_PX = 74;
    const UNCOMPACTED_BUDGET_PX = 660;
    const COMPACT_BUDGET_PX = 600;
    const EXPECTED_IDS = [
      'mm-char',
      'mm-spell',
      'mm-talents',
      'mm-quest',
      'mm-deeds',
      'mm-reliquary',
      'mm-loot-explorer',
      'mm-professions',
      'mm-harvest-journal',
      'mm-map',
      'mm-bag',
      'mm-crafting',
      'mm-perfecting',
    ];
    for (const [name, html] of entries) {
      const buttons = colA(html).match(/<button[^>]*class="micro-btn"[^>]*>/g) ?? [];
      const visible = buttons.filter(
        (b) => !/display:\s*none/.test(b) && !/\shidden(?=[\s>=])/.test(b),
      );
      const ids = visible.map((b) => /id="([^"]+)"/.exec(b)?.[1]);
      expect(ids, name).toEqual(EXPECTED_IDS);
      const colB = html.slice(html.indexOf('id="side-buttons-col-b"'));
      expect(colB.indexOf('id="mm-cosmetics"'), name).toBeGreaterThan(
        colB.indexOf('id="daily-rewards-button"'),
      );
      expect(colB.indexOf('id="mm-cosmetics"'), name).toBeLessThan(colB.indexOf('id="mm-arena"'));
      expect(html.match(/id="mm-cosmetics"/g), name).toHaveLength(1);
      const townFocus = buttons.filter((b) => /id="mm-town-focus"/.test(b));
      expect(townFocus, name).toHaveLength(1);
      const townVisibleCount = visible.length + townFocus.length;
      expect(
        townVisibleCount * UNCOMPACTED_MICRO_PLUS_GAP_PX + BOTTOM_ANCHOR_PX,
        name,
      ).toBeLessThanOrEqual(UNCOMPACTED_BUDGET_PX);
      expect(
        townVisibleCount * COMPACT_MICRO_PLUS_GAP_PX + BOTTOM_ANCHOR_PX,
        name,
      ).toBeLessThanOrEqual(COMPACT_BUDGET_PX);
    }
  });
});
