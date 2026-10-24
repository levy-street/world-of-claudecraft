import { describe, expect, it } from 'vitest';
import {
  TREASURE_DIG_RADIUS,
  TREASURE_SITES,
  TREASURE_SITES_BY_ID,
} from '../src/sim/content/treasure_maps';
import { ZONES } from '../src/sim/data';
import { VAULT_ZONE_IDS } from '../src/sim/rift/vault_seed';

describe('treasure dig site coverage', () => {
  it('offers multiple distinct sites in every adventuring zone', () => {
    expect(TREASURE_DIG_RADIUS).toBe(12);
    for (const zone of ZONES.filter((zone) => zone.id !== 'proving_shore')) {
      const sites = TREASURE_SITES.filter((site) => site.zoneId === zone.id);
      expect(sites.length, zone.id).toBeGreaterThanOrEqual(2);
      expect(VAULT_ZONE_IDS, zone.id).toContain(zone.id);
    }
    expect(TREASURE_SITES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(TREASURE_SITES.map((site) => site.id)).size).toBe(TREASURE_SITES.length);
    for (let i = 8; i < TREASURE_SITES.length; i++) {
      const site = TREASURE_SITES[i];
      for (const other of TREASURE_SITES.slice(0, i)) {
        expect(
          Math.hypot(site.x - other.x, site.z - other.z),
          `${site.id} overlaps ${other.id}`,
        ).toBeGreaterThan(2 * TREASURE_DIG_RADIUS);
      }
    }
    for (const site of TREASURE_SITES) expect(TREASURE_SITES_BY_ID[site.id]).toBe(site);
  });

  it('preserves the locations and order of saved map sites', () => {
    expect(TREASURE_SITES.slice(0, 8)).toEqual([
      { id: 'site_drakelands_ash_dunes', zoneId: 'drakelands', x: 350, z: 2085 },
      { id: 'site_frostveil_flat_snow', zoneId: 'frostveil', x: 118, z: 1790 },
      { id: 'site_amberfall_leaf_ring', zoneId: 'amberfall', x: -412, z: 2228 },
      { id: 'site_willowfen_dry_hummock', zoneId: 'willowfen', x: -266, z: 268 },
      { id: 'site_nightbloom_gloamfield', zoneId: 'nightbloom', x: -424, z: 1478 },
      { id: 'site_wraithwood_clearing', zoneId: 'wraithwood', x: 398, z: 1662 },
      { id: 'site_palmreach_heaped_sand', zoneId: 'palmreach', x: -402, z: 750 },
      { id: 'site_galecrest_cut_turf', zoneId: 'galecrest', x: 480, z: 326 },
    ]);
    expect(VAULT_ZONE_IDS.slice(0, 8)).toEqual([
      'drakelands',
      'frostveil',
      'amberfall',
      'willowfen',
      'nightbloom',
      'wraithwood',
      'palmreach',
      'galecrest',
    ]);
    expect(VAULT_ZONE_IDS.length).toBeLessThanOrEqual(16);
  });
});
