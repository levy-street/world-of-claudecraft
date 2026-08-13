// Master's Field Forge tooltip lines: the pure string-builder composed inside
// Hud.itemTooltip. English copy asserted directly (the
// tool_effect_tooltip.test.ts idiom); the radius and duration numbers must
// mirror STATION_RADIUS and MOBILE_CRAFTING_STATION_DURATION_TICKS, never
// re-invented.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MOBILE_CRAFTING_STATION_DURATION_TICKS,
  STATION_RADIUS,
} from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { TICK_RATE } from '../src/sim/types';
import {
  isPlaceMobileStationItem,
  mobileStationTooltipLines,
} from '../src/ui/mobile_station_tooltip';

describe('mobileStationTooltipLines: the shipped field forge', () => {
  it('names the kind, what placing does, radius, duration, and the replace rule', () => {
    const html = mobileStationTooltipLines(ITEMS.masters_field_forge);
    expect(html).toContain('<div class="tt-sub">Field station</div>');
    expect(html).toContain(
      '<div class="tt-green">Places a party-shared field forge at your feet.</div>',
    );
    expect(html).toContain(
      `<div class="tt-desc">Party members within ${STATION_RADIUS} yards can craft at it.</div>`,
    );
    expect(html).toContain(
      `<div class="tt-desc">Lasts ${MOBILE_CRAFTING_STATION_DURATION_TICKS / TICK_RATE / 60} minutes.</div>`,
    );
    expect(html).toContain('<div class="tt-desc">Never consumed.</div>');
    expect(html).toContain('<div class="tt-sub">Placing replaces your active field station.</div>');
    // No title: Hud.itemTooltip already prints the item name.
    expect(html).not.toContain('tt-title');
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
});

describe('mobileStationTooltipLines: everything else', () => {
  it('the guard is narrow: a tool-effect charm and a plain tool render nothing', () => {
    expect(isPlaceMobileStationItem(ITEMS.masters_field_forge)).toBe(true);
    expect(isPlaceMobileStationItem(ITEMS.makers_charm)).toBe(false);
    expect(isPlaceMobileStationItem(ITEMS.copper_mining_pick)).toBe(false);
    expect(mobileStationTooltipLines(ITEMS.makers_charm)).toBe('');
    expect(mobileStationTooltipLines(ITEMS.copper_mining_pick)).toBe('');
    expect(mobileStationTooltipLines(ITEMS.copper_ore)).toBe('');
  });

  it('Hud.itemTooltip composes the module (one line, never inline logic)', () => {
    // Strip whole-line comments first so a comment merely naming the call
    // cannot satisfy the pin (the tool_effect_tooltip.test.ts idiom).
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    expect(hudSrc).toContain("from './mobile_station_tooltip'");
    expect(hudSrc).toContain('mobileStationTooltipLines(item)');
  });
});
