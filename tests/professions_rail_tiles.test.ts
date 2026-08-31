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
import { hasUiIcon, hydrateIcons, svgIcon } from '../src/ui/ui_icons';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const hud = read('../src/ui/hud.ts');
const mainSrc = read('../src/main.ts');
const inputSrc = read('../src/game/input.ts');
const keybindsSrc = read('../src/game/keybinds.ts');
const optionsWindow = read('../src/ui/options_window.ts');
const chrome = read('../src/ui/i18n.catalog/hud_chrome.ts');
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
    expect(chrome).toMatch(/perfecting:\s*\{[^}]*title:\s*'Perfecting'/);
  });

  it('hud.ts wires the click to the existing togglePerfecting and repaints the keycap', () => {
    expect(hud).toContain(
      "$('#mm-perfecting')?.addEventListener('click', () => this.togglePerfecting());",
    );
    expect(hud).toContain("['#mm-perfecting', 'perfecting', 'hudChrome.perfecting.title'],");
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
    const route = /case 'perfecting':\s*hud\.togglePerfecting\(\);\s*break;/g;
    expect(keyboardStart).toBeGreaterThan(-1);
    expect(gamepadStart).toBeGreaterThan(-1);
    expect(keyboardRoute.match(route)).toHaveLength(1);
    expect(gamepadRoute.match(route)).toHaveLength(1);
  });

  it('maps the keybind action through t() in Options (never the raw English label)', () => {
    expect(optionsWindow).toContain("perfecting: 'hudChrome.perfecting.title',");
  });

  it('data-icon="perfecting" is a registered glyph distinct from its neighbours', () => {
    expect(hasUiIcon('perfecting')).toBe(true);
    expect(svgIcon('perfecting')).not.toBe(svgIcon('crafting'));
    expect(svgIcon('perfecting')).not.toBe(svgIcon('enchant-rune'));
    // A glyph tile, not painted art: the rail's wiki tile is the precedent, and
    // guard A of tests/chrome_icons.test.ts would demand a committed webp.
    expect(hasChromeIconArt('perfecting')).toBe(false);
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
    expect(hud).toContain(
      "['#mm-harvest-journal', 'harvestJournal', 'hudChrome.harvestJournal.title'],",
    );
    expect(hud).toContain('this.harvestJournalWindow.toggle();');
  });

  it('data-icon="harvest-journal" is a registered glyph distinct from the deeds book and the mortar', () => {
    expect(hasUiIcon('harvest-journal')).toBe(true);
    expect(svgIcon('harvest-journal')).not.toBe(svgIcon('book'));
    expect(svgIcon('harvest-journal')).not.toBe(svgIcon('professions'));
    expect(hasChromeIconArt('harvest-journal')).toBe(false);
  });
});

describe('both tiles hydrate and stay under the rail height budget', () => {
  it('hydrateIcons materializes a glyph for each tile (a missing registration leaves no svg)', () => {
    document.body.innerHTML =
      '<div id="side-buttons">' +
      '<button type="button" class="micro-btn" id="mm-harvest-journal" data-icon="harvest-journal"><span class="keybind">s-k</span></button>' +
      '<button type="button" class="micro-btn" id="mm-perfecting" data-icon="perfecting"><span class="keybind">s-t</span></button>' +
      '</div>';
    hydrateIcons(document.body);
    for (const id of ['mm-harvest-journal', 'mm-perfecting']) {
      const btn = document.getElementById(id) as HTMLButtonElement;
      expect(btn.querySelector('svg.ui-icon'), id).not.toBeNull();
      expect(btn.querySelector('img'), id).toBeNull();
    }
  });

  it('col-a carries at most 12 visible tiles, the count the crafting_launcher budget was re-checked at', () => {
    // tests/crafting_launcher.test.ts derives the height budget from the live
    // markup; this pins the assumption the two additions were sized against
    // (12 x 34px + 74px anchor = 482px under the 660px laptop budget), so a
    // thirteenth tile re-opens the question deliberately.
    for (const [name, html] of entries) {
      const buttons = colA(html).match(/<button[^>]*class="micro-btn"[^>]*>/g) ?? [];
      const visible = buttons.filter(
        (b) => !/display:\s*none/.test(b) && !/\shidden(?=[\s>=])/.test(b),
      );
      expect(visible.length, name).toBeLessThanOrEqual(12);
      expect(visible.length, name).toBeGreaterThanOrEqual(12);
    }
  });
});
