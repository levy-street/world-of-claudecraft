// The one shared tooltip line builder (src/ui/tooltip_line_core.ts) and the
// byte-identity proof for the collapse that created it.
//
// Four private `line()` copies had formed, one per item-card string builder
// (gather_tool_tooltip, tool_effect_tooltip, hud/professions/mobile_station_tooltip,
// hud/professions/recipe_pattern_tooltip_view), which is past the repo's rule of
// three. The extraction had to change no rendered byte on any of the four
// surfaces, so BEFORE_COLLAPSE below is the literal output of all four builders
// captured from the pre-extraction modules and pinned here verbatim: a helper
// that escapes differently, drops the wrapper, or reorders an attribute fails
// on the exact string rather than on a paraphrase of it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { gatherToolTooltipLines } from '../src/ui/gather_tool_tooltip';
import { stationNameText } from '../src/ui/hud/professions/crafting_window';
import { mobileStationTooltipLines } from '../src/ui/hud/professions/mobile_station_tooltip';
import {
  type RecipePatternViewerInput,
  recipePatternTooltipLines,
} from '../src/ui/hud/professions/recipe_pattern_tooltip_view';
import { toolEffectStandaloneTooltip, toolEffectTooltipLines } from '../src/ui/tool_effect_tooltip';
import { tooltipLine } from '../src/ui/tooltip_line_core';

/** Comment-stripped source (the mobile_station_tooltip.test.ts helper shape):
 *  a pin must not be satisfiable by a comment mentioning the token. */
const codeOnly = (source: string): string =>
  source.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sourceOf = (rel: string): string =>
  codeOnly(readFileSync(path.join(__dirname, '..', rel), 'utf8'));

/** The four consumers, with the import specifier each one must carry. */
const CONSUMERS: readonly (readonly [string, string])[] = [
  ['src/ui/gather_tool_tooltip.ts', "from './tooltip_line_core'"],
  ['src/ui/tool_effect_tooltip.ts', "from './tooltip_line_core'"],
  ['src/ui/hud/professions/mobile_station_tooltip.ts', "from '../../tooltip_line_core'"],
  ['src/ui/hud/professions/recipe_pattern_tooltip_view.ts', "from '../../tooltip_line_core'"],
];

const patternViewer = (
  overrides: Partial<RecipePatternViewerInput> = {},
): RecipePatternViewerInput => ({
  synced: true,
  knownRecipes: [],
  craftSkills: {},
  ...overrides,
});

/** Every case renders exactly the string the pre-extraction module produced. */
const BEFORE_COLLAPSE: readonly (readonly [string, string])[] = [
  [
    'gather:copper_mining_pick',
    '<div class="tt-sub">Mining tool (tier 1)</div><div class="tt-desc">Required to mine ore veins up to tier 1.</div><div class="tt-desc">Use: Mine a nearby ore vein.</div>',
  ],
  [
    'gather:iron_mining_pick',
    '<div class="tt-sub">Mining tool (tier 2)</div><div class="tt-desc">Required to mine ore veins up to tier 2.</div><div class="tt-desc">Use: Mine a nearby ore vein.</div><div class="tt-desc">Requires Mining 40</div><div class="tt-desc">Gathers faster at nodes below tier 2.</div>',
  ],
  [
    'gather:mithril_mining_pick',
    '<div class="tt-sub">Mining tool (tier 3)</div><div class="tt-desc">Required to mine ore veins up to tier 3.</div><div class="tt-desc">Use: Mine a nearby ore vein.</div><div class="tt-desc">Requires Mining 70</div><div class="tt-desc">Gathers faster at nodes below tier 3.</div>',
  ],
  [
    'gather:garden_hoe',
    '<div class="tt-sub">Farming tool (tier 1)</div><div class="tt-desc">Required to plant crops up to tier 1.</div><div class="tt-desc">Works from your bags when you plant a crop bed.</div>',
  ],
  [
    'gather:evergarden_hoe',
    '<div class="tt-sub">Farming tool (tier 5)</div><div class="tt-desc">Required to plant crops up to tier 5.</div><div class="tt-desc">Works from your bags when you plant a crop bed.</div><div class="tt-desc">Requires Farming 100</div><div class="tt-desc">Gathers faster at nodes below tier 5.</div>',
  ],
  [
    'gather:simple_fishing_pole',
    '<div class="tt-desc">Use: Fish in nearby waters.</div><div class="tt-desc">Required to fish.</div>',
  ],
  [
    'gather:ironreel_fishing_rod',
    '<div class="tt-sub">Fishing rod (tier 2)</div><div class="tt-desc">Use: Fish in nearby waters.</div><div class="tt-desc">Required to fish.</div><div class="tt-desc">Required to fish waters up to tier 2.</div><div class="tt-desc">Fish bite up to 1.5s sooner.</div><div class="tt-desc">Extends the reel window by 0.75s.</div><div class="tt-desc">Unlocks richer catch tables at fishing skill 100 and above.</div>',
  ],
  [
    'gather:stormreel_fishing_rod',
    '<div class="tt-sub">Fishing rod (tier 4)</div><div class="tt-desc">Use: Fish in nearby waters.</div><div class="tt-desc">Required to fish.</div><div class="tt-desc">Required to fish waters up to tier 4.</div><div class="tt-desc">Fish bite up to 4.5s sooner.</div><div class="tt-desc">Extends the reel window by 2.75s.</div><div class="tt-desc">Unlocks Raw Deepbarb Catfish at fishing skill 200 and above.</div>',
  ],
  [
    'gather:clockreel_fishing_rod',
    '<div class="tt-sub">Fishing rod (tier 6)</div><div class="tt-desc">Use: Fish in nearby waters.</div><div class="tt-desc">Required to fish.</div><div class="tt-desc">Required to fish waters up to tier 6.</div><div class="tt-desc">Fish bite up to 5s sooner.</div><div class="tt-desc">Extends the reel window by 4.5s.</div><div class="tt-desc">Unlocks Raw Stillmere Salmon at fishing skill 200 and above.</div>',
  ],
  ['gather:copper_ore', ''],
  [
    'effectLines:gatherers_cache',
    '<div class="tt-sub">Tool charm</div><div class="tt-green">+1 yield per harvest while charged.</div><div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div><div class="tt-desc">Starts with 20 charges on a common tool (+10 per rarity rung).</div><div class="tt-sub">Does not slot on fishing rods.</div>',
  ],
  [
    'effectLines:artisans_eye',
    '<div class="tt-sub">Tool charm</div><div class="tt-green">Raises the harvest grade by 1 tool tier while charged.</div><div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div><div class="tt-desc">Starts with 20 charges on a common tool (+10 per rarity rung).</div><div class="tt-sub">Does not slot on fishing rods.</div>',
  ],
  [
    'effectLines:makers_charm',
    '<div class="tt-sub">Tool charm</div><div class="tt-green">+2 yield per harvest while charged, or +1 on a farming tool.</div><div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div><div class="tt-desc">Starts with 20 charges on a common tool (+10 per rarity rung).</div><div class="tt-sub">Does not slot on fishing rods.</div>',
  ],
  [
    'effectStandalone:gatherers_cache',
    '<div class="tt-title" style="color:#0070dd">Gatherer&#39;s Cache</div><div class="tt-sub">Tool charm</div><div class="tt-green">+1 yield per harvest while charged.</div><div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div><div class="tt-desc">Starts with 20 charges on a common tool (+10 per rarity rung).</div><div class="tt-sub">Does not slot on fishing rods.</div>',
  ],
  [
    'effectStandalone:artisans_eye',
    '<div class="tt-title" style="color:#0070dd">Artisan&#39;s Eye</div><div class="tt-sub">Tool charm</div><div class="tt-green">Raises the harvest grade by 1 tool tier while charged.</div><div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div><div class="tt-desc">Starts with 20 charges on a common tool (+10 per rarity rung).</div><div class="tt-sub">Does not slot on fishing rods.</div>',
  ],
  [
    'effectStandalone:makers_charm',
    '<div class="tt-title" style="color:#a335ee">Maker&#39;s Charm</div><div class="tt-sub">Tool charm</div><div class="tt-green">+2 yield per harvest while charged, or +1 on a farming tool.</div><div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div><div class="tt-desc">Starts with 20 charges on a common tool (+10 per rarity rung).</div><div class="tt-sub">Does not slot on fishing rods.</div>',
  ],
  [
    'effectStandalone:quickening_charm',
    '<div class="tt-title" style="color:#0070dd">Springback Charm</div><div class="tt-sub">Tool charm</div><div class="tt-green">Shortens the node respawn timer it triggers.</div><div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div><div class="tt-desc">Starts with 20 charges on a common tool (+10 per rarity rung).</div><div class="tt-sub">Does not slot on fishing rods.</div>',
  ],
  [
    'station:masters_field_forge',
    '<div class="tt-sub">Field station</div><div class="tt-green">Places a party-shared Forge at your feet.</div><div class="tt-desc">You can craft at it from anywhere; party members must be within 20 yards.</div><div class="tt-desc">Lasts 10 minutes.</div><div class="tt-desc">Never consumed.</div><div class="tt-sub">Placing replaces your active field station, including a specialty-placed one.</div>',
  ],
  [
    'station:grand_cauldron',
    '<div class="tt-sub">Field station</div><div class="tt-green">Places a party-shared Apothecary at your feet.</div><div class="tt-desc">You can craft at it from anywhere; party members must be within 20 yards.</div><div class="tt-desc">Lasts 10 minutes.</div><div class="tt-desc">Never consumed.</div><div class="tt-sub">Placing replaces your active field station, including a specialty-placed one.</div>',
  ],
  [
    'station:laden_hearth',
    '<div class="tt-sub">Field station</div><div class="tt-green">Places a party-shared Kitchens at your feet.</div><div class="tt-desc">You can craft at it from anywhere; party members must be within 20 yards.</div><div class="tt-desc">Lasts 10 minutes.</div><div class="tt-desc">Never consumed.</div><div class="tt-sub">Placing replaces your active field station, including a specialty-placed one.</div>',
  ],
  [
    'pattern:unsynced',
    '<div class="tt-desc">Use: Teaches you how to craft Spiritweld Girdle.</div>',
  ],
  [
    'pattern:unmet',
    '<div class="tt-desc">Use: Teaches you how to craft Spiritweld Girdle.</div><div class="tt-red">Requires Armorcrafting 100</div>',
  ],
  [
    'pattern:met',
    '<div class="tt-desc">Use: Teaches you how to craft Spiritweld Girdle.</div><div class="tt-sub">Requires Armorcrafting 100</div>',
  ],
  [
    'pattern:known',
    '<div class="tt-desc">Use: Teaches you how to craft Spiritweld Girdle.</div><div class="tt-sub">Requires Armorcrafting 100</div><div class="tt-red">You already know that recipe.</div>',
  ],
  [
    'pattern:apostrophe',
    '<div class="tt-desc">Use: Teaches you how to craft Maker&#39;s Charm.</div><div class="tt-sub">Requires Engineering 100</div>',
  ],
];

/** Renders one captured case by its key, so the pin drives the REAL builders
 *  rather than a second copy of their composition. */
function render(key: string): string {
  const [kind, id] = key.split(':');
  if (kind === 'gather') return gatherToolTooltipLines(ITEMS[id]);
  if (kind === 'effectLines') return toolEffectTooltipLines(ITEMS[id]);
  if (kind === 'effectStandalone') return toolEffectStandaloneTooltip(id);
  if (kind === 'station') return mobileStationTooltipLines(ITEMS[id], stationNameText);
  const pattern = ITEMS.pattern_spiritweld_girdle;
  if (id === 'unsynced')
    return recipePatternTooltipLines(pattern, patternViewer({ synced: false }));
  if (id === 'unmet') {
    return recipePatternTooltipLines(pattern, patternViewer({ craftSkills: { armorcrafting: 1 } }));
  }
  if (id === 'met') {
    return recipePatternTooltipLines(
      pattern,
      patternViewer({ craftSkills: { armorcrafting: 200 } }),
    );
  }
  if (id === 'apostrophe') {
    // The escaping case: this pattern's result item name carries an
    // apostrophe, and the teaches line renders it THROUGH the shared builder,
    // so a builder that stopped escaping fails on the captured string.
    return recipePatternTooltipLines(
      ITEMS.pattern_makers_charm,
      patternViewer({ craftSkills: { engineering: 200 } }),
    );
  }
  return recipePatternTooltipLines(
    pattern,
    patternViewer({
      knownRecipes: ['recipe_spiritweld_girdle'],
      craftSkills: { armorcrafting: 200 },
    }),
  );
}

describe('tooltipLine: the one shared line builder', () => {
  it('wraps escaped text in the class div, for each of the family four roles', () => {
    expect(tooltipLine('tt-sub', 'Field station')).toBe('<div class="tt-sub">Field station</div>');
    expect(tooltipLine('tt-desc', 'Never consumed.')).toBe(
      '<div class="tt-desc">Never consumed.</div>',
    );
    expect(tooltipLine('tt-green', '+1 yield')).toBe('<div class="tt-green">+1 yield</div>');
    expect(tooltipLine('tt-red', 'Requires Armorcrafting 100')).toBe(
      '<div class="tt-red">Requires Armorcrafting 100</div>',
    );
  });

  it('escapes the text, never interpolates it raw', () => {
    // Every consumer reaches localized item and recipe names, so the escaping
    // is the contract, not a nicety.
    expect(tooltipLine('tt-desc', "Gatherer's <b>Cache</b> & co")).toBe(
      '<div class="tt-desc">Gatherer&#39;s &lt;b&gt;Cache&lt;/b&gt; &amp; co</div>',
    );
  });
});

describe('the four consumers import the shared builder and keep no private copy', () => {
  it.each(CONSUMERS)('%s imports tooltipLine', (rel, specifier) => {
    const source = sourceOf(rel);
    expect(source).toContain('tooltipLine');
    expect(source).toContain(specifier);
  });

  it.each(CONSUMERS)('%s declares no local line helper', (rel) => {
    const source = sourceOf(rel);
    // The exact shape the four copies had, plus the arrow form a re-fork would
    // reach for. A fifth private copy fails here rather than drifting quietly.
    expect(source).not.toMatch(/function\s+(?:tooltip)?[Ll]ine\s*\(/);
    expect(source).not.toMatch(/const\s+(?:tooltip)?[Ll]ine\s*=/);
    expect(source).not.toMatch(/<div class="\$\{cls\}">/);
  });
});

describe('byte identity across the extraction', () => {
  it('covers every line class the four builders emit, and a line that needs escaping', () => {
    const all = BEFORE_COLLAPSE.map(([, html]) => html).join('');
    for (const cls of ['tt-sub', 'tt-desc', 'tt-green', 'tt-red']) {
      expect(all, cls).toContain(`<div class="${cls}">`);
    }
    // Vacuity floor for the escaping half: without a captured line carrying an
    // escapable character, a builder that stopped escaping would pass every
    // case above (pattern:apostrophe is that line).
    expect(all).toContain('&#39;');
  });

  it.each(BEFORE_COLLAPSE)('%s renders the pre-extraction string exactly', (key, expected) => {
    expect(render(key)).toBe(expected);
  });
});
