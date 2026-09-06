// Pure-core pins for the pinned-recipe HUD tracker (src/ui/recipe_tracker_view.ts):
// which recipes the strip shows and in what order, the have/need fold per
// reagent, the pin cap, the tolerant persistence codec, and the live-world
// input factory over a Sim-shaped stub. Plus the chrome pins the strip depends
// on outside this module: the container in BOTH game entries, the hud.ts
// wiring, the stylesheet floors, and the settings row.
//
// The painter's DOM contract lives in tests/recipe_tracker_painter.test.ts, the
// store in tests/recipe_pins_store.test.ts, the window-side pin chip in
// tests/crafting_window_pin_chip.test.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { InvSlot } from '../src/sim/types';
import {
  makeRecipeTrackerInput,
  parseRecipePins,
  RECIPE_TRACK_CAP,
  RECIPE_TRACKER_MAX_REAGENTS,
  type RecipeTrackerInput,
  recipeTrackerView,
  serializeRecipePins,
  toggleRecipePin,
} from '../src/ui/recipe_tracker_view';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const POTION = 'recipe_minor_healing_potion';
const potion = ALL_RECIPES.find((r) => r.id === POTION) as ProfessionRecipeRecord;

function recipe(id: string, reagents: { itemId: string; count: number }[]): ProfessionRecipeRecord {
  return {
    ...potion,
    id,
    resultItemId: `${id}_out`,
    resultCount: 1,
    reagents,
  };
}

/** A synthetic input: recipes by id, carried counts by item, need = listed count. */
function input(
  recipes: ProfessionRecipeRecord[],
  have: Record<string, number>,
  pinned: string[],
  collapsed = false,
): RecipeTrackerInput {
  return {
    pinned: new Set(pinned),
    collapsed,
    recipeById: (id) => recipes.find((r) => r.id === id) ?? null,
    have: (itemId) => have[itemId] ?? 0,
    need: (_recipe, reagent) => reagent.count,
  };
}

describe('recipeTrackerView: selection', () => {
  const a = recipe('a', [
    { itemId: 'ore', count: 4 },
    { itemId: 'flux', count: 1 },
  ]);
  const b = recipe('b', [{ itemId: 'herb', count: 2 }]);

  it('shows pinned recipes in pin order with each reagent have/need/done', () => {
    const view = recipeTrackerView(input([a, b], { ore: 2, flux: 1 }, ['b', 'a']));
    expect(view.visible).toBe(true);
    expect(view.count).toBe(2);
    expect(view.lines.map((l) => l.recipeId)).toEqual(['b', 'a']);
    expect(view.lines[1].reagents).toEqual([
      { itemId: 'ore', have: 2, need: 4, done: false },
      { itemId: 'flux', have: 1, need: 1, done: true },
    ]);
    expect(view.lines[1].ready).toBe(false);
    expect(view.lines[0].reagents[0]).toEqual({ itemId: 'herb', have: 0, need: 2, done: false });
  });

  it('marks a recipe ready only when every reagent is covered (surplus counts)', () => {
    const view = recipeTrackerView(input([a], { ore: 9, flux: 3 }, ['a']));
    expect(view.lines[0].ready).toBe(true);
    expect(view.lines[0].reagents.every((r) => r.done)).toBe(true);
  });

  it('skips a pinned id the content no longer knows, keeping the rest', () => {
    const view = recipeTrackerView(input([a], {}, ['gone', 'a']));
    expect(view.lines.map((l) => l.recipeId)).toEqual(['a']);
    expect(view.count).toBe(1);
  });

  it('hides itself entirely when nothing is pinned or nothing resolves', () => {
    expect(recipeTrackerView(input([a], {}, []))).toEqual({
      visible: false,
      collapsed: false,
      count: 0,
      lines: [],
    });
    expect(recipeTrackerView(input([a], {}, ['gone'])).visible).toBe(false);
  });

  it('collapsed renders the header only, keeping the count', () => {
    const view = recipeTrackerView(input([a, b], {}, ['a', 'b'], true));
    expect(view).toEqual({ visible: true, collapsed: true, count: 2, lines: [] });
  });

  it('caps the strip at RECIPE_TRACK_CAP even if the set is wider', () => {
    const many = Array.from({ length: RECIPE_TRACK_CAP + 2 }, (_, i) => recipe(`r${i}`, []));
    const view = recipeTrackerView(
      input(
        many,
        {},
        many.map((r) => r.id),
      ),
    );
    expect(view.count).toBe(RECIPE_TRACK_CAP);
  });

  it('carries result id and count for the painter', () => {
    const view = recipeTrackerView(input([{ ...a, resultCount: 5 }], {}, ['a']));
    expect(view.lines[0].resultItemId).toBe('a_out');
    expect(view.lines[0].resultCount).toBe(5);
  });
});

describe('tracker constants', () => {
  it('caps pins at five (the deed watchlist and Reliquary number)', () => {
    expect(RECIPE_TRACK_CAP).toBe(5);
  });

  it('sizes the reagent pool from the widest shipped recipe', () => {
    const widest = Math.max(...ALL_RECIPES.map((r) => r.reagents.length));
    expect(RECIPE_TRACKER_MAX_REAGENTS).toBe(widest);
    expect(widest).toBeGreaterThan(0);
  });
});

describe('toggleRecipePin', () => {
  it('adds, removes, and refuses at the cap without touching the set', () => {
    let pinned: ReadonlySet<string> = new Set();
    for (let i = 0; i < RECIPE_TRACK_CAP; i++) {
      const r = toggleRecipePin(pinned, `r${i}`);
      expect(r.changed).toBe(true);
      pinned = r.pinned;
    }
    const refused = toggleRecipePin(pinned, 'extra');
    expect(refused).toEqual({ pinned, full: true, changed: false });
    expect(refused.pinned).toBe(pinned);
    const removed = toggleRecipePin(pinned, 'r0');
    expect(removed.changed).toBe(true);
    expect(removed.full).toBe(false);
    expect([...removed.pinned]).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('the persistence codec', () => {
  it('round-trips pin order', () => {
    const set = new Set(['b', 'a']);
    expect([...parseRecipePins(serializeRecipePins(set), () => true)]).toEqual(['b', 'a']);
  });

  it('tolerates null, garbage, non-arrays, and non-string entries', () => {
    expect(parseRecipePins(null, () => true).size).toBe(0);
    expect(parseRecipePins('{not json', () => true).size).toBe(0);
    expect(parseRecipePins('{"a":1}', () => true).size).toBe(0);
    expect([...parseRecipePins('[1, null, "a"]', () => true)]).toEqual(['a']);
  });

  it('drops ids the content no longer knows and truncates past the cap', () => {
    const raw = JSON.stringify(['gone', 'a', 'b', 'c', 'd', 'e', 'f']);
    const parsed = parseRecipePins(raw, (id) => id !== 'gone');
    expect([...parsed]).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('makeRecipeTrackerInput over a Sim-shaped world', () => {
  function world(inventory: InvSlot[]) {
    return {
      inventory,
      craftSkills: {} as Readonly<Record<string, number>>,
      recipeList: ALL_RECIPES,
      player: { name: 'Tester' },
    };
  }

  it('resolves shipped recipes and counts carried reagents across unlocked slots', () => {
    const inv: InvSlot[] = [
      { itemId: 'silverleaf_herb', count: 1 },
      { itemId: 'silverleaf_herb', count: 1 },
      { itemId: 'linen_scrap', count: 3 },
    ];
    const live = makeRecipeTrackerInput(() => world(inv));
    live.pinned = new Set([POTION]);
    const view = recipeTrackerView(live);
    expect(view.lines[0].recipeId).toBe(POTION);
    const byId = Object.fromEntries(view.lines[0].reagents.map((r) => [r.itemId, r]));
    expect(byId.silverleaf_herb).toEqual({
      itemId: 'silverleaf_herb',
      have: 2,
      need: 2,
      done: true,
    });
    expect(byId.linen_scrap.have).toBe(3);
    expect(byId.spider_leg).toEqual({ itemId: 'spider_leg', have: 0, need: 1, done: false });
    expect(view.lines[0].ready).toBe(false);
  });

  it('returns null for an unknown recipe id and re-reads the world thunk live', () => {
    let inv: InvSlot[] = [];
    const live = makeRecipeTrackerInput(() => world(inv));
    expect(live.recipeById('nope')).toBeNull();
    expect(live.have('spider_leg')).toBe(0);
    inv = [{ itemId: 'spider_leg', count: 4 }];
    expect(live.have('spider_leg')).toBe(4);
  });

  it('gives the same view over a ClientWorld-shaped mirror (plain snapshot objects)', () => {
    // The online mirror hands the same four surfaces as frozen snapshot data
    // (an inventory array copied off the wire, a craftSkills record, the static
    // recipe table, the mirrored player name), so the core must read them
    // identically: same input, same output across the two hosts.
    const inv: InvSlot[] = [
      { itemId: 'silverleaf_herb', count: 2 },
      { itemId: 'spider_leg', count: 1 },
    ];
    const simShaped = makeRecipeTrackerInput(() => world(inv));
    const mirror = Object.freeze({
      inventory: Object.freeze(inv.map((s) => ({ ...s }))) as readonly InvSlot[],
      craftSkills: Object.freeze({ alchemy: 0 }) as Readonly<Record<string, number>>,
      recipeList: ALL_RECIPES,
      player: { name: 'Tester' },
    });
    const mirrorShaped = makeRecipeTrackerInput(() => mirror);
    simShaped.pinned = new Set([POTION]);
    mirrorShaped.pinned = new Set([POTION]);
    expect(recipeTrackerView(mirrorShaped)).toEqual(recipeTrackerView(simShaped));
  });

  it('charges the listed count with no perks (the sim formula, base skills)', () => {
    const live = makeRecipeTrackerInput(() => world([]));
    for (const reagent of potion.reagents) {
      expect(live.need(potion, reagent)).toBe(reagent.count);
    }
  });
});

describe('the chrome around the strip', () => {
  const hud = read('../src/ui/hud.ts');
  const hudCss = read('../src/styles/hud.css');
  const hudMobile = read('../src/styles/hud.mobile.css');

  it('mounts #recipe-tracker in the tracker stack of BOTH game entries', () => {
    for (const entry of ['../index.html', '../play.html']) {
      const html = read(entry);
      const stack = html.slice(html.indexOf('id="right-tracker-stack"'));
      expect(stack.indexOf('<div id="recipe-tracker"></div>'), entry).toBeGreaterThan(0);
      expect(stack.indexOf('<div id="recipe-tracker"></div>'), entry).toBeLessThan(
        stack.indexOf('id="delve-tracker"'),
      );
    }
  });

  it('drives the strip on the slow band, the language fan-out, and the header wiring', () => {
    expect(hud).toContain('if (slowHud) this.updateRecipeTracker();');
    expect(hud).toMatch(/this\.updateReliquaryTracker\(\);\s*this\.updateRecipeTracker\(\);/);
    expect(hud).toMatch(
      /wireTrackerHeader\(\$\('#recipe-tracker'\), \{\s*toggle: \(\) => this\.toggleRecipeTrackerCollapsed\(\),\s*\}\);/,
    );
    expect(hud).toContain(
      "settings.set('recipeTrackerCollapsed', !settings.get('recipeTrackerCollapsed'));",
    );
  });

  it('feeds the crafting window the pin state and the toggle off ONE store', () => {
    expect(hud).toContain('recipePinned: (recipeId) => this.recipePins.has(recipeId),');
    expect(hud).toMatch(
      /onToggleRecipePin: \(recipeId\) => \{\s*const result = this\.recipePins\.toggle\(recipeId\);\s*if \(result\.changed\) this\.updateRecipeTracker\(\);\s*return result;/,
    );
    expect(hud).toContain('input.pinned = this.recipePins.pinned;');
  });

  it('persists the collapse as its own settings row', () => {
    expect(read('../src/game/settings.ts')).toContain('recipeTrackerCollapsed: { def: false },');
  });

  it('keeps the header at fit-content width and paints the gold focus ring', () => {
    const rule = /#recipe-tracker \.dt-header \{([^}]*)\}/.exec(hudCss)?.[1] ?? '';
    expect(rule).toMatch(/width:\s*fit-content;/);
    expect(rule).toMatch(/pointer-events:\s*auto;/);
    expect(hudCss).toMatch(
      /#recipe-tracker \.dt-header:focus-visible \{\s*outline: 2px solid var\(--gold\);\s*outline-offset: 2px;\s*border-radius: 2px;\s*\}/,
    );
    expect(hudCss).toMatch(
      /@media \(pointer: coarse\) \{\s*#recipe-tracker \.dt-header \{\s*min-height: 40px;/,
    );
  });

  it('is hidden on the touch HUD with its pin chip (the Reliquary tracker rationale)', () => {
    expect(hudMobile).toMatch(/body\.mobile-touch #recipe-tracker \{\s*display: none;/);
    expect(hudMobile).toMatch(/body\.mobile-touch \.crafting-pin-chip \{\s*display: none;/);
  });
});
