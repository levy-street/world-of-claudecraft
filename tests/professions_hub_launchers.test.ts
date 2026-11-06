// Source-guard suite for the Professions hub's launch surface (menu
// consolidation step 1, 2026-11-04). The four professions windows read as one
// tabbed window behind ONE rail tile (#mm-professions, Shift+P); the
// Crafting, Perfecting and Harvest Journal tiles left the rail, T stays the
// direct Crafting opener, and the Perfecting and Harvest Journal actions stay
// rebindable with no default key. The recorded bug class this suite was born
// for still applies: an action wired at ONE of the two main.ts dispatch sites
// is dead at the other, so both sites stay pinned.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIND_ACTIONS, keyCapLabel } from '../src/game/keybinds';
import { SIDE_BUTTONS } from '../src/ui/hud/menu/side_buttons';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const hud = read('../src/ui/hud.ts');
const mainSrc = read('../src/main.ts');
const inputSrc = read('../src/game/input.ts');
const entries = [
  ['index.html', read('../index.html')],
  ['play.html', read('../play.html')],
] as const;

function column(html: string, col: 'a' | 'b'): string {
  const start = html.indexOf(`id="side-buttons-col-${col}"`);
  const end = html.indexOf('</div>', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}
const rail = (html: string): string => column(html, 'a') + column(html, 'b');

const action = (id: string) => BIND_ACTIONS.find((a) => a.id === id);

describe('one Professions launcher on the rail', () => {
  it('ships #mm-professions with its Shift+P keycap in BOTH entries', () => {
    for (const [name, html] of entries) {
      expect(rail(html), name).toMatch(
        /id="mm-professions"[^>]*data-i18n-title="hudChrome\.professions\.title"[^>]*><span class="keybind[^"]*">s-p<\/span>/,
      );
    }
    expect(keyCapLabel('Shift+P')).toBe('s-p');
  });

  it('drops the Crafting, Perfecting and Harvest Journal tiles from BOTH entries', () => {
    for (const [name, html] of entries) {
      for (const id of ['mm-crafting', 'mm-perfecting', 'mm-harvest-journal']) {
        expect(html.includes(`id="${id}"`), `${name} ${id}`).toBe(false);
      }
    }
    const selectors = SIDE_BUTTONS.map(([selector]) => selector);
    expect(selectors).toContain('#mm-professions');
    expect(selectors).not.toContain('#mm-crafting');
    expect(selectors).not.toContain('#mm-perfecting');
    expect(selectors).not.toContain('#mm-harvest-journal');
  });

  it('hud.ts wires no click for the removed tiles', () => {
    expect(hud).not.toContain("$('#mm-crafting')");
    expect(hud).not.toContain("$('#mm-perfecting')");
    expect(hud).not.toContain("$('#mm-harvest-journal')");
    expect(hud).toContain(
      "$('#mm-professions').addEventListener('click', () => this.toggleProfessions());",
    );
  });

  it('ships the consolidated thirteen-button rail, seven and six, within the height budget', () => {
    // Menu consolidation (2026-11-04): 24 visible launchers became 12, and
    // Rewards joined column A in step 7 (2026-11-06). Column A is the
    // character's own windows plus Rewards, column B the hubs and the system row.
    const UNCOMPACTED_MICRO_PLUS_GAP_PX = 34;
    const COMPACT_MICRO_PLUS_GAP_PX = 25;
    const BOTTOM_ANCHOR_PX = 74;
    const UNCOMPACTED_BUDGET_PX = 660;
    const COMPACT_BUDGET_PX = 600;
    const EXPECTED: Record<'a' | 'b', string[]> = {
      a: ['mm-char', 'mm-bag', 'mm-spell', 'mm-talents', 'mm-quest', 'mm-map', 'mm-rewards'],
      b: [
        'mm-deeds',
        'mm-professions',
        'expedition-bell',
        'mm-social',
        'daily-rewards-button',
        'mm-options',
      ],
    };
    for (const [name, html] of entries) {
      for (const col of ['a', 'b'] as const) {
        const buttons =
          column(html, col).match(/<button[^>]*class="[^"]*\bmicro-btn\b[^"]*"[^>]*>/g) ?? [];
        const visible = buttons.filter(
          (b) => !/display:\s*none/.test(b) && !/\shidden(?=[\s>=])/.test(b),
        );
        expect(
          visible.map((b) => /id="([^"]+)"/.exec(b)?.[1]),
          `${name} column ${col}`,
        ).toEqual(EXPECTED[col]);
        // Town Focus (column A) and the $WOC Exchange (column B) are hidden in
        // markup but revealed by state; budget for both.
        const count = buttons.length;
        expect(count * UNCOMPACTED_MICRO_PLUS_GAP_PX + BOTTOM_ANCHOR_PX, name).toBeLessThanOrEqual(
          UNCOMPACTED_BUDGET_PX,
        );
        expect(count * COMPACT_MICRO_PLUS_GAP_PX + BOTTOM_ANCHOR_PX, name).toBeLessThanOrEqual(
          COMPACT_BUDGET_PX,
        );
      }
    }
  });

  it('removes the folded launchers from the rail and wires no click for them', () => {
    const gone = [
      'mm-reliquary',
      'mm-loot-explorer',
      'mm-leaderboard',
      'mm-cosmetics',
      'mm-arena',
      'mm-dfinder',
      'mm-cardduel',
      'mm-emote',
      'mm-discord',
      'mm-wiki',
    ];
    for (const [name, html] of entries) {
      for (const id of gone) expect(html.includes(`id="${id}"`), `${name} ${id}`).toBe(false);
    }
    for (const id of gone) expect(hud, id).not.toContain(`$('#${id}')`);
  });
});

describe('the hub keybinds', () => {
  it('T stays Crafting and Shift+P stays Professions', () => {
    expect(action('crafting')?.defaults).toEqual(['KeyT']);
    expect(action('professions')?.defaults).toEqual(['Shift+KeyP']);
  });

  it('Perfecting and Harvest Journal stay rebindable Interface actions with no default', () => {
    for (const id of ['perfecting', 'harvestJournal']) {
      expect(action(id)?.kind, id).toBe('edge');
      expect(action(id)?.category, id).toBe('Interface');
      expect(action(id)?.defaults, id).toEqual([]);
    }
  });

  it('frees Shift+T and Shift+K: no action ships either chord', () => {
    for (const chord of ['Shift+KeyT', 'Shift+KeyK']) {
      expect(
        BIND_ACTIONS.filter((a) => a.defaults.includes(chord)).map((a) => a.id),
        chord,
      ).toEqual([]);
    }
  });

  it('routes both rebindable actions through the Input union and dispatchEdge', () => {
    for (const id of ['perfecting', 'harvestJournal']) {
      expect(inputSrc, id).toContain(`| '${id}'`);
      expect(inputSrc, id).toMatch(
        new RegExp(`case '${id}':\\s*this\\.cb\\.onUiKey\\('${id}'\\);\\s*return;`),
      );
    }
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
  });

  it('every professions opener on Hud lands on the hub at its tab', () => {
    // The plain press toggles the last tab; the More tray's Overview tile
    // passes its tab through the same opener.
    expect(hud).toMatch(
      /toggleProfessions\(tab\?: ProfessionsHubTab\): void \{\s*this\.professionsHub\.toggle\(tab\);/,
    );
    expect(hud).toMatch(
      /toggleCrafting\(\): void \{\s*this\.professionsHub\.toggle\('crafting'\);/,
    );
    expect(hud).toMatch(
      /togglePerfecting\(\): void \{\s*this\.professionsHub\.toggle\('perfecting'\);/,
    );
    expect(hud).toMatch(
      /openPerfecting\(\): void \{\s*this\.professionsHub\.open\('perfecting'\);/,
    );
    expect(hud).toMatch(
      /toggleHarvestJournal\(\): void \{\s*this\.professionsHub\.toggle\('harvest'\);/,
    );
    expect(hud).toContain("openHarvestJournal: () => this.professionsHub.open('harvest'),");
    // openCrafting(craftId) keeps its pre-selection and lands on the hub tab.
    const at = hud.indexOf('  openCrafting(craftId?: string): void {');
    expect(at).toBeGreaterThan(-1);
    expect(hud.slice(at, at + 700)).toContain("this.professionsHub.open('crafting');");
  });
});
