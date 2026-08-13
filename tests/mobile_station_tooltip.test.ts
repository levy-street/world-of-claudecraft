// Master's Field Forge tooltip lines: the pure string-builder composed inside
// Hud.itemTooltip. English copy asserted directly (the
// tool_effect_tooltip.test.ts idiom); the radius and duration numbers must
// mirror STATION_RADIUS and MOBILE_CRAFTING_STATION_DURATION_TICKS, never
// re-invented. The station noun derives from the def's own stationCraftId;
// the localized resolver is injected by the caller, so these tests pass the
// real stationNameText.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MOBILE_CRAFTING_STATION_DURATION_TICKS,
  STATION_RADIUS,
} from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { TICK_RATE } from '../src/sim/types';
import { stationNameText } from '../src/ui/crafting_window';
import {
  isPlaceMobileStationItem,
  mobileStationTooltipLines,
} from '../src/ui/mobile_station_tooltip';
import { toolEffectStandaloneTooltip } from '../src/ui/tool_effect_tooltip';

/** Comment-stripped source (the profession_identity_card.test.ts helper
 *  shape): block comments and trailing // comments cannot satisfy a pin. */
const codeOnly = (source: string): string =>
  source.replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('mobileStationTooltipLines: the shipped field forge', () => {
  it('renders the six lines in card order with the derived station noun', () => {
    const html = mobileStationTooltipLines(ITEMS.masters_field_forge, stationNameText);
    // Exact ordered composition: a reordering or a dropped line fails here,
    // where per-line toContain would stay green.
    expect(html).toBe(
      '<div class="tt-sub">Field station</div>' +
        '<div class="tt-green">Places a party-shared Forge at your feet.</div>' +
        `<div class="tt-desc">You can craft at it from anywhere; party members must be within ${STATION_RADIUS} yards.</div>` +
        `<div class="tt-desc">Lasts ${MOBILE_CRAFTING_STATION_DURATION_TICKS / TICK_RATE / 60} minutes.</div>` +
        '<div class="tt-desc">Never consumed.</div>' +
        '<div class="tt-sub">Placing replaces your active field station, including a specialty-placed one.</div>',
    );
  });

  it('emits no title, and the matcher can see one (positive control)', () => {
    // No title: Hud.itemTooltip already prints the item name. The positive
    // control proves the tt-title token is real and detectable, so the
    // negative pin cannot pass vacuously against a token that never exists.
    expect(toolEffectStandaloneTooltip('makers_charm')).toContain('tt-title');
    expect(mobileStationTooltipLines(ITEMS.masters_field_forge, stationNameText)).not.toContain(
      'tt-title',
    );
  });

  it('the prose numbers track the sim constants (both halves of the derivation)', () => {
    // The line assertions above interpolate the same constants the builder
    // reads (they track by construction), so pin the inputs to literals once
    // here: the share radius, and both halves of the ticks-to-minutes
    // derivation, so a retune moves the English in the same change.
    expect(STATION_RADIUS).toBe(20);
    expect(MOBILE_CRAFTING_STATION_DURATION_TICKS).toBe(20 * 60 * 10);
    expect(TICK_RATE).toBe(20);
    expect(MOBILE_CRAFTING_STATION_DURATION_TICKS / TICK_RATE / 60).toBe(10);
  });

  it('the station noun follows the def, not the forge copy', () => {
    // The finding this pins: the old English hardcoded "field forge" while
    // the predicate is generic over use.type. A synthetic second station
    // item with a different craft must name its own station kind.
    const fieldKitchen = {
      ...ITEMS.masters_field_forge,
      use: { type: 'placeMobileStation', stationCraftId: 'cooking' },
    } as typeof ITEMS.masters_field_forge;
    const html = mobileStationTooltipLines(fieldKitchen, stationNameText);
    expect(html).toContain('Places a party-shared Kitchens at your feet.');
    expect(html).not.toContain('Forge');
  });
});

describe('mobileStationTooltipLines: everything else', () => {
  it('the guard is narrow: a tool-effect charm and a plain tool render nothing', () => {
    expect(isPlaceMobileStationItem(ITEMS.masters_field_forge)).toBe(true);
    expect(isPlaceMobileStationItem(ITEMS.makers_charm)).toBe(false);
    expect(isPlaceMobileStationItem(ITEMS.copper_mining_pick)).toBe(false);
    expect(mobileStationTooltipLines(ITEMS.makers_charm, stationNameText)).toBe('');
    expect(mobileStationTooltipLines(ITEMS.copper_mining_pick, stationNameText)).toBe('');
    expect(mobileStationTooltipLines(ITEMS.copper_ore, stationNameText)).toBe('');
  });

  it('Hud.itemTooltip composes the module (one line, never inline logic)', () => {
    const hudSrc = codeOnly(readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8'));
    expect(hudSrc).toContain("from './mobile_station_tooltip'");
    expect(hudSrc).toContain('mobileStationTooltipLines(item, stationNameText)');
  });
});
