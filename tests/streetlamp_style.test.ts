import { describe, expect, it } from 'vitest';
import { resolveStreetlampStyle, STREETLAMP_STYLE_BY_ZONE } from '../src/sim/streetlamp_style';

const EXPECTED_ZONE_STYLES = {
  eastbrook_vale: 'eastbrook_civic',
  mirefen_marsh: 'mirefen_witchflame',
  thornpeak_heights: 'thornpeak_beacon',
  veiled_hollow: 'veiled_crystal',
  drakelands: 'drakelands_brazier',
  frostveil: 'frostveil_icicle',
  amberfall: 'amberfall_crystal',
  willowfen: 'willowfen_reed',
  nightbloom: 'nightbloom_moonflower',
  wraithwood: 'wraithwood_ghost',
  palmreach: 'palmreach_totem',
  evergarden: 'evergarden_flower',
  galecrest: 'galecrest_mast',
  farshore_isle: 'farshore_coral',
} as const;

describe('streetlamp area styles', () => {
  it('pins one distinct model style for every built-in area', () => {
    expect(STREETLAMP_STYLE_BY_ZONE).toEqual(EXPECTED_ZONE_STYLES);
    expect(new Set(Object.values(STREETLAMP_STYLE_BY_ZONE)).size).toBe(14);
  });

  it('prefers exact area identity over the biome fallback', () => {
    expect(resolveStreetlampStyle('farshore_isle', 'vale')).toBe('farshore_coral');
    expect(resolveStreetlampStyle('eastbrook_vale', 'vale')).toBe('eastbrook_civic');
  });

  it('uses a themed biome fallback for custom areas and a total default', () => {
    expect(resolveStreetlampStyle('custom_ice_city', 'frost')).toBe('frostveil_icicle');
    expect(resolveStreetlampStyle('custom_volcano', 'ember')).toBe('drakelands_brazier');
    expect(resolveStreetlampStyle('custom_unknown', null)).toBe('eastbrook_civic');
    expect(resolveStreetlampStyle(null, null)).toBe('eastbrook_civic');
  });
});
